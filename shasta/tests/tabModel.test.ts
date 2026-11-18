import { describe, expect, it } from 'vitest'
import { activateTab, applyFrameUrl, makeTab, normalizeOrder, pickNeighbour, pushEntry, releaseFrame, setEntryTitle, tabUrl, wakeFrame, type Tab } from '@/lib/tabModel'

const page = (url: string, extra: Partial<Tab> = {}) => makeTab(url, extra)

describe('applyFrameUrl', () => {
  it('ignores duplicate reports', () => {
    const t = page('https://a.test/')
    expect(applyFrameUrl(t, 'https://a.test/', 'a').entries).toHaveLength(1)
  })

  it('replaces the entry when the server redirected a user navigation', () => {
    const t = pushEntry(page('shasta://newtab'), 'https://a.test/redirect', 'a')
    const next = applyFrameUrl(t, 'https://a.test/final', 'final')
    expect(next.entries.map((e) => e.url)).toEqual(['shasta://newtab', 'https://a.test/final'])
    expect(next.expectReplace).toBe(false)
  })

  it('appends a new entry for page-initiated navigations and drops forward entries', () => {
    let t = page('https://a.test/')
    t = applyFrameUrl(t, 'https://a.test/2', '2')
    t = applyFrameUrl(t, 'https://a.test/3', '3')
    t = applyFrameUrl(t, 'https://a.test/2', '2') // native back
    expect(t.index).toBe(1)
    t = applyFrameUrl(t, 'https://a.test/other', 'o')
    expect(t.entries.map((e) => e.url)).toEqual(['https://a.test/', 'https://a.test/2', 'https://a.test/other'])
  })

  it('follows native back and forward', () => {
    let t = page('https://a.test/')
    t = applyFrameUrl(t, 'https://a.test/2', '2')
    t = applyFrameUrl(t, 'https://a.test/', 'a')
    expect(t.index).toBe(0)
    t = applyFrameUrl(t, 'https://a.test/2', '2')
    expect(t.index).toBe(1)
  })
})

describe('histories are independent per tab', () => {
  it('does not share entries between tabs', () => {
    const a = pushEntry(page('https://a.test/'), 'https://a.test/x', 'x')
    const b = page('https://b.test/')
    expect(a.entries).toHaveLength(2)
    expect(b.entries).toHaveLength(1)
  })

  it('updates only the requested entry title', () => {
    const t = pushEntry(page('https://a.test/'), 'https://a.test/x', 'x')
    expect(setEntryTitle(t, 'New').entries.map((e) => e.title)).toEqual(['a.test', 'New'])
    expect(setEntryTitle(t, 'Old', 'https://a.test/').entries[0].title).toBe('Old')
    expect(setEntryTitle(t, 'x')).toBe(t)
  })
})

describe('normalizeOrder', () => {
  it('puts pinned tabs first and keeps group members together', () => {
    const a = page('https://a.test/')
    const b = page('https://b.test/', { groupId: 'g' })
    const c = page('https://c.test/')
    const d = page('https://d.test/', { groupId: 'g' })
    const p = page('https://p.test/', { pinned: true })
    expect(normalizeOrder([a, b, c, d, p]).map((t) => tabUrl(t))).toEqual(['https://p.test/', 'https://a.test/', 'https://b.test/', 'https://d.test/', 'https://c.test/'])
  })
})

describe('pickNeighbour', () => {
  it('prefers the tab on the right, then the left', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((n) => page(`https://${n}.test/`))
    expect(pickNeighbour([a, b, c], b.id)).toBe(c.id)
    expect(pickNeighbour([a, b, c], c.id)).toBe(b.id)
    expect(pickNeighbour([a], a.id)).toBeNull()
  })

  it('stays inside the group when possible', () => {
    const a = page('https://a.test/', { groupId: 'g' })
    const b = page('https://b.test/', { groupId: 'g' })
    const c = page('https://c.test/')
    expect(pickNeighbour([a, b, c], b.id)).toBe(a.id)
  })
})

describe('frame lifecycle (wakeFrame / activateTab / releaseFrame)', () => {
  const live = (url: string) => page(url, { frame: true, frameUrl: url })

  it('releasing a background site suspends it, and selecting it again reloads it in a fresh frame', () => {
    const t = releaseFrame(live('https://a.test/'))
    expect(t).toMatchObject({ frame: false, suspended: true, frameUrl: '' })
    const back = activateTab(t, 5)
    expect(back).toMatchObject({ frame: true, suspended: false, loading: true, pendingCommit: true, expectReplace: true, frameKey: t.frameKey + 1, lastActiveAt: 5 })
  })

  it('a Shasta page with a site kept behind it loses only that frame; selecting it shows the page without a spinner', () => {
    // a site, then the new tab page: the site's frame is kept for Back
    const t = pushEntry(live('https://a.test/'), 'shasta://newtab', 'New Tab')
    expect(t.frame).toBe(true)
    const released = releaseFrame(t)
    expect(released).toMatchObject({ frame: false, suspended: false })
    const shown = activateTab(released, 7)
    expect(shown).toMatchObject({ frame: false, suspended: false, loading: false, pendingCommit: false, lastActiveAt: 7 })
  })

  it('a Shasta page marked suspended (older state) is cleared instead of loading forever', () => {
    const t = page('shasta://settings', { suspended: true })
    expect(activateTab(t)).toMatchObject({ suspended: false, loading: false })
  })

  it('a live tab is only stamped when selected', () => {
    const t = live('https://a.test/')
    const next = activateTab(t, 9)
    expect(next).toMatchObject({ frame: true, loading: false, frameKey: t.frameKey, lastActiveAt: 9 })
    expect(wakeFrame(t)).toBe(t)
  })

  it('every combination the functions produce is one of the documented states', () => {
    const ok = (t: Tab) => !(t.frame && t.suspended) && !(t.suspended && !/^https?:/.test(tabUrl(t)))
    const starts = [page('https://a.test/'), live('https://a.test/'), page('shasta://newtab'), pushEntry(live('https://a.test/'), 'shasta://newtab', 'New Tab')]
    for (const s of starts) for (const t of [releaseFrame(s), activateTab(s), wakeFrame(s), activateTab(releaseFrame(s)), releaseFrame(activateTab(s))]) expect(ok(t)).toBe(true)
  })
})
