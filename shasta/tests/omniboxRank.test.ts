import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8080' })
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })
vi.stubGlobal('document', { addEventListener: () => undefined })

const { buildRows, inlineCompletion } = await import('@/lib/omniboxRank')

const visit = (id: string, url: string, title: string) => ({ id, url, title, origin: new URL(url).origin, visitedAt: Date.now() })
const preds = [
  { text: 'roblox redeem', kind: 'query' as const },
  { text: 'https://www.roblox.com/', kind: 'nav' as const, description: 'Roblox' },
  { text: 'roblox studio', kind: 'query' as const },
]
const base = { engine: 'google' as const, suggestionsOn: true, bookmarks: [], installed: [], predictions: preds }

describe('inline completion', () => {
  it('completes a typed word to a site from the engine, history or bookmarks', () => {
    expect(inlineCompletion('roblox', [], [], preds)).toEqual({ suffix: '.com', url: 'https://www.roblox.com/' })
    expect(inlineCompletion('git', [], [visit('1', 'https://github.com/a/b', 'x')], [])).toEqual({ suffix: 'hub.com', url: 'https://github.com/' })
  })
  it('does nothing for searches with spaces, full addresses, or when already complete', () => {
    expect(inlineCompletion('roblox studio', [], [], preds)).toBeNull()
    expect(inlineCompletion('https://roblox', [], [], preds)).toBeNull()
    expect(inlineCompletion('roblox.com', [], [], preds)).toBeNull()
    expect(inlineCompletion('zzz', [], [], preds)).toBeNull()
  })
})

describe('row order', () => {
  it('best guess first, then your sites, then predictions, without duplicates', () => {
    const history = [visit('1', 'https://www.roblox.com/home', 'Home - Roblox')]
    const inline = inlineCompletion('roblox', [], history, preds)
    const rows = buildRows({ ...base, query: 'roblox', history, inline })
    expect(rows[0]).toMatchObject({ kind: 'nav', primary: 'roblox.com' })
    expect(rows.map((r) => r.kind)).toEqual(['nav', 'search', 'history', 'search', 'search'])
    expect(rows.filter((r) => r.kind === 'search' && r.id === 'primary')).toHaveLength(1)
    expect(new Set(rows.map((r) => r.url)).size).toBe(rows.length)
  })
  it('emphasises what the prediction adds to what was typed', () => {
    const rows = buildRows({ ...base, query: 'roblox', history: [], inline: null })
    expect(rows.find((r) => r.primary === 'roblox redeem')?.typedPrefix).toBe('roblox')
  })
  it('predictions are skipped when suggestions are off', () => {
    const rows = buildRows({ ...base, suggestionsOn: false, query: 'roblox', history: [], inline: null })
    expect(rows).toHaveLength(1)
  })
})
