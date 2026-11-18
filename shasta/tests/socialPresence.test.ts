// The desktop presence reporter (src/social/presenceReporter.ts): only Store app ids, debounced, silent when off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTab, type Tab, type TabApp } from '@/lib/tabModel'
import { createPresenceReporter, recentStoreAppId, storeAppIdOf, type PresenceSources } from '@/social/presenceReporter'

const app = (id: string, slug: string, kind: TabApp['kind'] = 'package', home = ''): TabApp => ({ id, slug, scheme: 'game', name: slug, iconUrl: null, kind, home })

describe('storeAppIdOf', () => {
  it('is the Store app id while the tab is inside the app', () => {
    expect(storeAppIdOf(makeTab('game://hextris', { app: app('app_hex1', 'hextris') }))).toBe('app_hex1')
    const linked = app('app_disc', 'discord', 'linked', 'https://discord.com/app')
    expect(storeAppIdOf(makeTab('https://discord.com/channels/1', { app: linked }))).toBe('app_disc')
  })
  it('is null for plain sites, Shasta pages, out-of-scope pages and private tabs', () => {
    expect(storeAppIdOf(makeTab('https://example.com/'))).toBeNull()
    expect(storeAppIdOf(makeTab('shasta://social'))).toBeNull()
    expect(storeAppIdOf(undefined)).toBeNull()
    const linked = app('app_disc', 'discord', 'linked', 'https://discord.com/app')
    expect(storeAppIdOf(makeTab('https://evil.example/', { app: linked }))).toBeNull()
    expect(storeAppIdOf(makeTab('game://hextris', { app: app('app_hex1', 'hextris'), private: true }))).toBeNull()
  })
  it('never passes on something that is not an id', () => {
    expect(storeAppIdOf(makeTab('game://hextris', { app: app('https://x.y/z', 'hextris') }))).toBeNull()
  })
})

describe('recentStoreAppId', () => {
  it('picks the most recently used Store app tab', () => {
    const tabs: Tab[] = [
      makeTab('game://a', { app: app('app_a', 'a'), lastActiveAt: 10 }),
      makeTab('shasta://social', { lastActiveAt: 30 }),
      makeTab('game://b', { app: app('app_b', 'b'), lastActiveAt: 20 }),
    ]
    expect(recentStoreAppId(tabs)).toBe('app_b')
    expect(recentStoreAppId([makeTab('https://example.com/')])).toBeNull()
  })
})

function fake(init: { fg?: string | null; on?: boolean; hidden?: boolean } = {}) {
  const st = { fg: init.fg ?? null, on: init.on ?? true, hidden: init.hidden ?? false }
  let changed = () => {}
  let reconnect = () => {}
  const reports: (string | null)[] = []
  const src: PresenceSources = {
    foreground: () => st.fg,
    enabled: () => st.on,
    hidden: () => st.hidden,
    watch: (fn) => ((changed = fn), () => {}),
    onReconnect: (fn) => ((reconnect = fn), () => {}),
    report: (id) => reports.push(id),
  }
  const set = (patch: Partial<typeof st>) => {
    Object.assign(st, patch)
    changed()
  }
  return { src, set, reports, reconnect: () => reconnect() }
}

describe('createPresenceReporter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports the foreground Store app after the debounce', () => {
    const f = fake({ fg: 'app_a' })
    const stop = createPresenceReporter(f.src)
    vi.advanceTimersByTime(4999)
    expect(f.reports).toEqual([])
    vi.advanceTimersByTime(1)
    expect(f.reports).toEqual(['app_a'])
    stop()
  })

  it('sends nothing for a quick flick away and back, and only the last of quick changes', () => {
    const f = fake({ fg: 'app_a' })
    createPresenceReporter(f.src)
    vi.advanceTimersByTime(5000)
    f.set({ fg: null })
    vi.advanceTimersByTime(2000)
    f.set({ fg: 'app_a' })
    vi.advanceTimersByTime(10_000)
    expect(f.reports).toEqual(['app_a'])
    f.set({ fg: 'app_b' })
    vi.advanceTimersByTime(1000)
    f.set({ fg: 'app_c' })
    vi.advanceTimersByTime(5000)
    expect(f.reports).toEqual(['app_a', 'app_c'])
  })

  it('does not restart the wait when unrelated store changes repeat the same value', () => {
    const f = fake({ fg: null })
    createPresenceReporter(f.src)
    vi.advanceTimersByTime(5000)
    f.set({ fg: 'app_a' })
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(600)
      f.set({}) // a tab title or loading flag changed
    }
    expect(f.reports).toEqual([null, 'app_a'])
  })

  it('says nothing at all while presence is off or signed out, and reports afresh when turned on', () => {
    const f = fake({ fg: 'app_a', on: false })
    createPresenceReporter(f.src)
    vi.advanceTimersByTime(60_000)
    f.set({ fg: 'app_b' })
    vi.advanceTimersByTime(60_000)
    expect(f.reports).toEqual([])
    f.set({ on: true })
    vi.advanceTimersByTime(5000)
    expect(f.reports).toEqual(['app_b'])
    // turned off while a change is on its way: it never goes
    f.set({ fg: 'app_c' })
    vi.advanceTimersByTime(1000)
    f.set({ on: false })
    vi.advanceTimersByTime(60_000)
    expect(f.reports).toEqual(['app_b'])
  })

  it('goes to null after the window is hidden for 2 minutes, and back when it returns', () => {
    const f = fake({ fg: 'app_a' })
    createPresenceReporter(f.src)
    vi.advanceTimersByTime(5000)
    f.set({ hidden: true })
    vi.advanceTimersByTime(119_000)
    expect(f.reports).toEqual(['app_a'])
    vi.advanceTimersByTime(1000 + 5000)
    expect(f.reports).toEqual(['app_a', null])
    f.set({ hidden: false })
    vi.advanceTimersByTime(5000)
    expect(f.reports).toEqual(['app_a', null, 'app_a'])
  })

  it('a short hide changes nothing', () => {
    const f = fake({ fg: 'app_a' })
    createPresenceReporter(f.src)
    vi.advanceTimersByTime(5000)
    f.set({ hidden: true })
    vi.advanceTimersByTime(60_000)
    f.set({ hidden: false })
    vi.advanceTimersByTime(180_000)
    expect(f.reports).toEqual(['app_a'])
  })

  it('re-sends the current value after the socket reconnects', () => {
    const f = fake({ fg: 'app_a' })
    createPresenceReporter(f.src)
    vi.advanceTimersByTime(5000)
    f.reconnect()
    vi.advanceTimersByTime(5000)
    expect(f.reports).toEqual(['app_a', 'app_a'])
  })

  it('stops for good', () => {
    const f = fake({ fg: 'app_a' })
    const stop = createPresenceReporter(f.src)
    stop()
    vi.advanceTimersByTime(60_000)
    expect(f.reports).toEqual([])
  })
})
