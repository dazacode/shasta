import { describe, expect, it, vi } from 'vitest'
import { menuItems, type ContextInfo, type MenuActions, type TabContext } from '@/lib/contextMenu'
import { isDevtoolsShortcut } from '@/lib/devtoolsGuard'

const info = (over: Partial<ContextInfo> = {}): ContextInfo => ({ x: 0, y: 0, linkUrl: null, imageUrl: null, selection: '', editable: false, win: null, element: null, inPage: true, ...over })
const tab: TabContext = { tabId: 't', url: 'https://example.com/a', external: true, canBack: true, canForward: false, bookmarked: false, engine: 'google' }
const acts = (): MenuActions => ({ back: vi.fn(), forward: vi.fn(), reload: vi.fn(), print: vi.fn(), toggleBookmark: vi.fn(), openTab: vi.fn(), copyText: vi.fn(), search: vi.fn(), clipboard: vi.fn() })
const labels = (items: ReturnType<typeof menuItems>) => items.filter((i) => i.type === 'item').map((i) => (i as { label: string }).label)

describe('context menu entries', () => {
  it('offers page navigation on plain page content, and never Inspect or View source', () => {
    const l = labels(menuItems(info(), tab, acts()))
    expect(l).toEqual(['Back', 'Forward', 'Reload', 'Bookmark this page', 'Copy page address', 'Print…'])
    expect(l.join()).not.toMatch(/inspect|source/i)
  })
  it('disables back/forward when there is no history, and reload on Shasta pages', () => {
    const items = menuItems(info(), { ...tab, canBack: false, external: false }, acts())
    const dis = (id: string) => (items.find((i) => i.type === 'item' && i.id === id) as { disabled?: boolean }).disabled
    expect(dis('back')).toBe(true)
    expect(dis('forward')).toBe(true)
    expect(dis('reload')).toBe(true)
    expect(labels(items)).not.toContain('Bookmark this page')
  })
  it('puts link actions first and only for web links', () => {
    const a = acts()
    const items = menuItems(info({ linkUrl: 'https://x.test/p' }), tab, a)
    expect(labels(items).slice(0, 3)).toEqual(['Open link in new tab', 'Open link in background tab', 'Copy link address'])
    ;(items[0] as { run: () => void }).run()
    expect(a.openTab).toHaveBeenCalledWith('https://x.test/p', false)
    expect(labels(menuItems(info({ linkUrl: 'javascript:alert(1)' }), tab, acts()))[0]).toBe('Back')
  })
  it('searches the selection with the chosen engine', () => {
    const a = acts()
    const items = menuItems(info({ selection: 'hello world' }), tab, a)
    const search = items.find((i) => i.type === 'item' && i.id === 'search-selection') as { label: string; run: () => void }
    expect(search.label).toBe('Search Google for “hello world”')
    search.run()
    expect(a.search).toHaveBeenCalledWith('https://www.google.com/search?q=hello%20world')
  })
  it('gives text fields cut / copy / paste / select all, with cut and copy off without a selection', () => {
    const items = menuItems(info({ editable: true }), tab, acts())
    expect(labels(items)).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
    expect((items[0] as { disabled?: boolean }).disabled).toBe(true)
    expect((menuItems(info({ editable: true, selection: 'x' }), tab, acts())[0] as { disabled?: boolean }).disabled).toBe(false)
  })
  it('shows nothing page-level for clicks on Shasta chrome', () => {
    expect(menuItems(info({ inPage: false }), tab, acts())).toEqual([])
    expect(labels(menuItems(info({ inPage: false, selection: 'abc' }), tab, acts()))).toContain('Copy')
  })
})

describe('AI entries', () => {
  const ai = () => ({ explain: vi.fn(), summarizePage: vi.fn(), describeImage: vi.fn() })
  it('are absent unless the AI actions are provided, so turning AI off removes them', () => {
    const all = [info({ selection: 'x y' }), info({ imageUrl: 'https://x.test/a.png', imageElement: {} as Element }), info()].flatMap((i) => labels(menuItems(i, tab, acts())))
    expect(all.join()).not.toMatch(/Shasta AI/)
  })
  it('offers explain for a selection, describe for an image and summarize for a page', () => {
    const a = { ...acts(), ai: ai() }
    expect(labels(menuItems(info({ selection: 'mitosis' }), tab, a))).toContain('Explain with Shasta AI')
    expect(labels(menuItems(info({ imageUrl: 'https://x.test/a.png', imageElement: {} as Element }), tab, a))).toContain('Describe image with Shasta AI')
    const page = menuItems(info(), tab, a)
    const sum = page.find((i) => i.type === 'item' && i.id === 'ai-summarize') as { run: () => void }
    sum.run()
    expect(a.ai.summarizePage).toHaveBeenCalled()
    expect(labels(menuItems(info(), { ...tab, external: false }, a))).not.toContain('Summarize this page with Shasta AI')
  })
  it('is not offered inside text fields', () => {
    expect(labels(menuItems(info({ editable: true, selection: 'x' }), tab, { ...acts(), ai: ai() }))).not.toContain('Explain with Shasta AI')
  })
})

describe('devtools shortcuts', () => {
  const k = (over: Partial<Parameters<typeof isDevtoolsShortcut>[0]>) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over })
  it('matches the ways of opening devtools and view-source', () => {
    expect(isDevtoolsShortcut(k({ key: 'F12', code: 'F12' }))).toBe(true)
    expect(isDevtoolsShortcut(k({ code: 'KeyI', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isDevtoolsShortcut(k({ code: 'KeyJ', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isDevtoolsShortcut(k({ code: 'KeyC', metaKey: true, shiftKey: true }))).toBe(true)
    expect(isDevtoolsShortcut(k({ code: 'KeyI', metaKey: true, altKey: true, key: 'ˆ' }))).toBe(true)
    expect(isDevtoolsShortcut(k({ code: 'KeyU', ctrlKey: true }))).toBe(true)
    expect(isDevtoolsShortcut(k({ code: 'KeyU', metaKey: true, altKey: true }))).toBe(true)
  })
  it('leaves ordinary shortcuts alone', () => {
    expect(isDevtoolsShortcut(k({ code: 'KeyI', ctrlKey: true }))).toBe(false) // italics
    expect(isDevtoolsShortcut(k({ code: 'KeyC', ctrlKey: true }))).toBe(false) // copy
    expect(isDevtoolsShortcut(k({ code: 'KeyU' }))).toBe(false)
    expect(isDevtoolsShortcut(k({ key: 'F11', code: 'F11' }))).toBe(false)
    expect(isDevtoolsShortcut(k({ code: 'KeyT', ctrlKey: true }))).toBe(false)
  })
})
