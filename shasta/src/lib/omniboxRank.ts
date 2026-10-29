// What the address bar offers while typing, and the inline completion ("roblox" -> "roblox.com"). Pure functions so the
// ordering can be tested: the best guess first, then installed apps, sites you know, predictions, and more of your own.
import type { BookmarkNode, HistoryEntry } from '@/stores/libraryStore'
import { suggest } from '@/stores/libraryStore'
import type { Prediction } from './searchSuggest'
import { SEARCH_ENGINES, displayUrl, hostOf, resolveInput, type SearchEngine } from './url'

export interface Row {
  id: string
  kind: 'go' | 'search' | 'bookmark' | 'history' | 'app' | 'nav'
  url: string
  iconUrl?: string | null
  primary: string
  secondary?: string
  /** the part of `primary` to render as already typed; the rest is emphasised, like a completion */
  typedPrefix?: string
}

export interface InstalledLike {
  available: boolean
  address: string
  app: { id: string; name: string; slug: string; iconUrl: string | null }
}

export const MAX_ROWS = 9

const bareHost = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

export interface Inline {
  suffix: string
  url: string
}

/** A site the typed text is the start of: from bookmarks, then history, then the engine's site suggestions. */
export function inlineCompletion(query: string, bookmarks: BookmarkNode[], history: HistoryEntry[], predictions: Prediction[]): Inline | null {
  const q = query.trim()
  if (!q || q !== query || !/^[a-z0-9][a-z0-9.-]*$/i.test(q)) return null
  const lower = q.toLowerCase()
  const urls = [
    ...bookmarks.flatMap((b) => (b.type === 'bookmark' ? [b.url] : [])),
    ...history.map((h) => h.url),
    ...predictions.filter((p) => p.kind === 'nav').map((p) => p.text),
  ]
  for (const url of urls) {
    if (!/^https?:/i.test(url)) continue
    const host = bareHost(url)
    if (host.length > q.length && host.toLowerCase().startsWith(lower)) {
      const origin = new URL(url).origin + '/'
      return { suffix: host.slice(q.length), url: origin }
    }
  }
  return null
}

export function buildRows(input: {
  query: string
  engine: SearchEngine
  suggestionsOn: boolean
  bookmarks: BookmarkNode[]
  history: HistoryEntry[]
  installed: InstalledLike[] | undefined
  predictions: Prediction[]
  inline: Inline | null
}): Row[] {
  const { query, engine, suggestionsOn, bookmarks, history, installed, predictions, inline } = input
  const out: Row[] = []

  if (!query) {
    if (!suggestionsOn) return out
    const seen = new Set<string>()
    for (const h of history) {
      if (seen.has(h.url)) continue
      seen.add(h.url)
      out.push({ id: h.url, kind: 'history', url: h.url, primary: h.title, secondary: displayUrl(h.url) })
      if (out.length >= 6) break
    }
    return out
  }

  const r = resolveInput(query, engine)
  if (inline) out.push({ id: 'inline', kind: 'nav', url: inline.url, primary: query + inline.suffix, secondary: 'Go to this site' })
  else if (r.kind === 'search') out.push({ id: 'primary', kind: 'search', url: r.url, primary: query, secondary: `Search ${SEARCH_ENGINES[engine].label}` })
  else if (r.kind === 'url' || r.kind === 'internal') out.push({ id: 'primary', kind: 'go', url: r.url, primary: r.url, secondary: 'Go to this address' })
  else if (r.kind === 'app') out.push({ id: 'primary', kind: 'app', url: r.url, primary: r.url, secondary: 'Open installed app' })
  if (inline && r.kind === 'search') out.push({ id: 'primary', kind: 'search', url: r.url, primary: query, secondary: `Search ${SEARCH_ENGINES[engine].label}` })

  // installed apps match by name, so "disc" offers Discord before any web search
  const q = query.toLowerCase()
  for (const i of (installed ?? []).filter((x) => x.available && (x.app.name.toLowerCase().includes(q) || x.app.slug.includes(q))).slice(0, 3)) {
    if (r.kind !== 'app' || i.address !== r.url) out.push({ id: `app-${i.app.id}`, kind: 'app', url: i.address, iconUrl: i.app.iconUrl, primary: i.app.name, secondary: `${i.address} · installed` })
  }
  if (!suggestionsOn) return out.slice(0, MAX_ROWS)

  const mine = suggest(query, bookmarks, history, 6).map<Row>((s) => ({ id: s.url, kind: s.kind, url: s.url, primary: s.title || hostOf(s.url), secondary: displayUrl(s.url) }))
  const known = new Set(out.map((x) => x.url))
  const seenSites = new Set(mine.map((m) => bareHost(m.url) + new URL(m.url, 'https://x').pathname))
  const take = (rows: Row[], n: number) => {
    for (const row of rows) {
      if (n <= 0) break
      if (known.has(row.url)) continue
      known.add(row.url)
      out.push(row)
      n--
    }
  }

  take(mine, 3)
  const preds: Row[] = []
  for (const p of predictions) {
    if (p.kind === 'nav') {
      const key = bareHost(p.text) + new URL(p.text).pathname
      if (seenSites.has(key) || (inline && p.text === inline.url)) continue
      preds.push({ id: `nav-${p.text}`, kind: 'nav', url: p.text, primary: p.description || bareHost(p.text), secondary: displayUrl(p.text) })
    } else {
      if (p.text.toLowerCase() === q) continue
      const s = resolveInput(p.text, engine)
      if (s.kind !== 'search') continue
      preds.push({ id: `pred-${p.text}`, kind: 'search', url: s.url, primary: p.text, secondary: p.description, typedPrefix: p.text.toLowerCase().startsWith(q) ? p.text.slice(0, query.length) : undefined })
    }
  }
  take(preds, MAX_ROWS - out.length - 1)
  take(mine, MAX_ROWS - out.length)
  return out.slice(0, MAX_ROWS)
}
