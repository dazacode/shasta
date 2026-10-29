import { create } from 'zustand'
import * as db from '@/lib/db'
import { hostOf, isInternalUrl, originOf } from '@/lib/url'

export interface Bookmark {
  id: string
  type: 'bookmark'
  url: string
  title: string
  parentId: string | null
  createdAt: number
}

export interface Folder {
  id: string
  type: 'folder'
  title: string
  parentId: string | null
  createdAt: number
}

export type BookmarkNode = Bookmark | Folder

export interface HistoryEntry {
  id: string
  url: string
  title: string
  origin: string
  visitedAt: number
}

export type ClearRange = 'hour' | 'day' | 'week' | 'all'

const HISTORY_LIMIT = 5000
/** Visits to the same URL closer together than this (reloads, redirects) count once. */
const VISIT_COALESCE_MS = 30_000

interface LibraryState {
  loaded: boolean
  bookmarks: BookmarkNode[]
  history: HistoryEntry[]
  favicons: Record<string, string>

  load: () => Promise<void>

  recordVisit: (url: string, title: string) => void
  updateVisitTitle: (url: string, title: string) => void
  deleteHistory: (ids: string[]) => void
  clearHistory: (range: ClearRange) => Promise<void>

  addBookmark: (input: { url: string; title: string; parentId?: string | null }) => Bookmark
  addFolder: (title: string, parentId?: string | null) => Folder
  updateNode: (id: string, patch: Partial<Pick<BookmarkNode, 'title' | 'parentId'> & { url: string }>) => void
  removeNode: (id: string) => void
  toggleBookmark: (url: string, title: string) => boolean
  clearBookmarks: () => Promise<void>
  /** profile import: `replace` swaps everything, `merge` adds nodes (and folders) the device does not already have */
  setBookmarks: (nodes: BookmarkNode[], mode: 'merge' | 'replace') => number
  importBookmarks: (html: string) => number

  /** `persist: false` keeps it in memory only (private tabs) */
  setFavicon: (origin: string, dataUrl: string, opts?: { persist?: boolean }) => void
  clearFavicons: () => Promise<void>
  /** drops icons for sites that are no longer in history, bookmarks or `keep`; returns how many went */
  pruneFavicons: (keep: Set<string>) => number
  /** drops history older than `maxAgeMs`; returns how many entries went */
  pruneHistory: (maxAgeMs: number) => number
}

const uid = () => crypto.randomUUID()

const persist = (label: string, task: Promise<unknown>) =>
  task.catch((e) => console.warn(`[shasta] could not save ${label}:`, e))

export const useLibrary = create<LibraryState>()((set, get) => ({
  loaded: false,
  bookmarks: [],
  history: [],
  favicons: {},

  load: async () => {
    if (get().loaded) return
    try {
      const [bookmarks, history, favicons] = await Promise.all([
        db.getAll<BookmarkNode>('bookmarks'),
        db.getAll<HistoryEntry>('history'),
        db.getAll<{ origin: string; dataUrl: string }>('favicons'),
      ])
      history.sort((a, b) => b.visitedAt - a.visitedAt)
      set({
        loaded: true,
        bookmarks,
        history,
        favicons: Object.fromEntries(favicons.map((f) => [f.origin, f.dataUrl])),
      })
      migrateLegacyBookmarks(get)
    } catch (e) {
      console.warn('[shasta] storage unavailable, library will not persist:', e)
      set({ loaded: true })
    }
  },

  recordVisit: (url, title) => {
    if (!/^https?:/i.test(url)) return
    const now = Date.now()
    const { history } = get()
    const last = history.find((h) => h.url === url)
    if (last && now - last.visitedAt < VISIT_COALESCE_MS) {
      const updated = { ...last, visitedAt: now, title: title || last.title }
      set({ history: [updated, ...history.filter((h) => h.id !== last.id)] })
      void persist('history', db.put('history', updated))
      return
    }
    const entry: HistoryEntry = { id: uid(), url, title: title || hostOf(url), origin: originOf(url), visitedAt: now }
    let next = [entry, ...history]
    if (next.length > HISTORY_LIMIT) {
      const dropped = next.slice(HISTORY_LIMIT)
      next = next.slice(0, HISTORY_LIMIT)
      void persist('history', db.remove('history', ...dropped.map((d) => d.id)))
    }
    set({ history: next })
    void persist('history', db.put('history', entry))
  },

  updateVisitTitle: (url, title) => {
    if (!title) return
    const entry = get().history.find((h) => h.url === url)
    if (!entry || entry.title === title) return
    const updated = { ...entry, title }
    set((s) => ({ history: s.history.map((h) => (h.id === entry.id ? updated : h)) }))
    void persist('history', db.put('history', updated))
  },

  deleteHistory: (ids) => {
    const drop = new Set(ids)
    set((s) => ({ history: s.history.filter((h) => !drop.has(h.id)) }))
    void persist('history', db.remove('history', ...ids))
  },

  clearHistory: async (range) => {
    if (range === 'all') {
      set({ history: [] })
      await persist('history', db.clear('history'))
      return
    }
    const span = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3 }[range]
    const cutoff = Date.now() - span
    const doomed = get().history.filter((h) => h.visitedAt >= cutoff).map((h) => h.id)
    set((s) => ({ history: s.history.filter((h) => h.visitedAt < cutoff) }))
    await persist('history', db.remove('history', ...doomed))
  },

  addBookmark: ({ url, title, parentId = null }) => {
    const node: Bookmark = { id: uid(), type: 'bookmark', url, title: title || hostOf(url), parentId, createdAt: Date.now() }
    set((s) => ({ bookmarks: [...s.bookmarks, node] }))
    void persist('bookmarks', db.put('bookmarks', node))
    return node
  },

  addFolder: (title, parentId = null) => {
    const node: Folder = { id: uid(), type: 'folder', title: title.trim() || 'New folder', parentId, createdAt: Date.now() }
    set((s) => ({ bookmarks: [...s.bookmarks, node] }))
    void persist('bookmarks', db.put('bookmarks', node))
    return node
  },

  updateNode: (id, patch) => {
    const node = get().bookmarks.find((b) => b.id === id)
    if (!node) return
    // a folder can't be moved into itself or one of its own descendants
    if (patch.parentId && node.type === 'folder' && isDescendant(get().bookmarks, patch.parentId, id)) return
    const { url, ...folderPatch } = patch
    const updated: BookmarkNode = node.type === 'folder' ? { ...node, ...folderPatch } : { ...node, ...patch, ...(url ? { url } : {}) }
    set((s) => ({ bookmarks: s.bookmarks.map((b) => (b.id === id ? updated : b)) }))
    void persist('bookmarks', db.put('bookmarks', updated))
  },

  removeNode: (id) => {
    const all = get().bookmarks
    const doomed = new Set<string>([id])
    // collect descendants of removed folders
    let grew = true
    while (grew) {
      grew = false
      for (const n of all) {
        if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
          doomed.add(n.id)
          grew = true
        }
      }
    }
    set({ bookmarks: all.filter((b) => !doomed.has(b.id)) })
    void persist('bookmarks', db.remove('bookmarks', ...doomed))
  },

  toggleBookmark: (url, title) => {
    const existing = get().bookmarks.filter((b): b is Bookmark => b.type === 'bookmark' && b.url === url)
    if (existing.length) {
      existing.forEach((b) => get().removeNode(b.id))
      return false
    }
    get().addBookmark({ url, title })
    return true
  },

  clearBookmarks: async () => {
    set({ bookmarks: [] })
    await persist('bookmarks', db.clear('bookmarks'))
  },

  setBookmarks: (incoming, mode) => {
    if (mode === 'replace') {
      set({ bookmarks: incoming })
      void persist('bookmarks', db.clear('bookmarks').then(() => db.putMany('bookmarks', incoming)))
      return incoming.length
    }
    const have = new Set(get().bookmarks.filter((b): b is Bookmark => b.type === 'bookmark').map((b) => `${b.parentId}|${b.url}`))
    const ids = new Set(get().bookmarks.map((b) => b.id))
    const fresh = incoming.filter((n) => !ids.has(n.id) && (n.type === 'folder' || !have.has(`${n.parentId}|${n.url}`)))
    set({ bookmarks: [...get().bookmarks, ...fresh] })
    void persist('bookmarks', db.putMany('bookmarks', fresh))
    return fresh.length
  },

  importBookmarks: (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const created: BookmarkNode[] = []
    const walk = (dl: Element, parentId: string | null) => {
      for (const child of Array.from(dl.children)) {
        // Netscape format: <DT><H3>Folder</H3><DL>…</DL> and <DT><A HREF>
        const dt = child.tagName === 'DT' ? child : null
        if (!dt) continue
        const h3 = dt.querySelector(':scope > h3')
        const a = dt.querySelector(':scope > a')
        if (h3) {
          const folder: Folder = { id: uid(), type: 'folder', title: h3.textContent?.trim() || 'Folder', parentId, createdAt: Date.now() }
          created.push(folder)
          const sub = dt.querySelector(':scope > dl') ?? (dt.nextElementSibling?.tagName === 'DL' ? dt.nextElementSibling : null)
          if (sub) walk(sub, folder.id)
        } else if (a) {
          const href = a.getAttribute('href') ?? ''
          if (/^https?:\/\//i.test(href)) {
            created.push({ id: uid(), type: 'bookmark', url: href, title: a.textContent?.trim() || hostOf(href), parentId, createdAt: Date.now() })
          }
        }
      }
    }
    const root = doc.querySelector('dl')
    if (root) walk(root, null)
    // flatten the "Bookmarks bar"/"Other bookmarks" wrappers other browsers add around everything
    const existing = new Set(get().bookmarks.filter((b): b is Bookmark => b.type === 'bookmark').map((b) => `${b.parentId}|${b.url}`))
    const fresh = created.filter((n) => n.type === 'folder' || !existing.has(`${n.parentId}|${n.url}`))
    set((s) => ({ bookmarks: [...s.bookmarks, ...fresh] }))
    void persist('bookmarks', db.putMany('bookmarks', fresh))
    return fresh.filter((n) => n.type === 'bookmark').length
  },

  setFavicon: (origin, dataUrl, { persist: keep = true } = {}) => {
    if (!origin || get().favicons[origin] === dataUrl) return
    set((s) => ({ favicons: { ...s.favicons, [origin]: dataUrl } }))
    if (keep) void persist('favicons', db.put('favicons', { origin, dataUrl }))
  },

  pruneFavicons: (keep) => {
    const { favicons, history, bookmarks } = get()
    const used = new Set(keep)
    for (const h of history) used.add(h.origin)
    for (const b of bookmarks) if (b.type === 'bookmark') used.add(originOf(b.url))
    const doomed = Object.keys(favicons).filter((o) => !used.has(o))
    if (!doomed.length) return 0
    set({ favicons: Object.fromEntries(Object.entries(favicons).filter(([o]) => used.has(o))) })
    void persist('favicons', db.remove('favicons', ...doomed))
    return doomed.length
  },

  pruneHistory: (maxAgeMs) => {
    const cutoff = Date.now() - maxAgeMs
    const doomed = get().history.filter((h) => h.visitedAt < cutoff).map((h) => h.id)
    if (doomed.length) get().deleteHistory(doomed)
    return doomed.length
  },

  clearFavicons: async () => {
    set({ favicons: {} })
    await persist('favicons', db.clear('favicons'))
  },
}))

function isDescendant(nodes: BookmarkNode[], candidateId: string, ancestorId: string): boolean {
  let cur: string | null = candidateId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true
    seen.add(cur)
    cur = nodes.find((n) => n.id === cur)?.parentId ?? null
  }
  return false
}

/** The first prototype kept a flat {url,title}[] in localStorage; move it into IndexedDB once. */
function migrateLegacyBookmarks(get: () => LibraryState) {
  try {
    const raw = localStorage.getItem('shasta-state')
    if (!raw) return
    const legacy = JSON.parse(raw)?.state?.bookmarks as { url: string; title: string }[] | undefined
    for (const b of legacy ?? []) {
      if (b?.url && !get().bookmarks.some((n) => n.type === 'bookmark' && n.url === b.url)) get().addBookmark(b)
    }
    localStorage.removeItem('shasta-state')
  } catch {
    /* nothing to migrate */
  }
}

// ---- derived helpers --------------------------------------------------------------------

export function childrenOf(nodes: BookmarkNode[], parentId: string | null): BookmarkNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => (a.type === b.type ? a.createdAt - b.createdAt : a.type === 'folder' ? -1 : 1))
}

export function exportBookmarksHtml(nodes: BookmarkNode[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const render = (parentId: string | null, depth: number): string =>
    childrenOf(nodes, parentId)
      .map((n) => {
        const pad = '    '.repeat(depth)
        const added = Math.floor(n.createdAt / 1000)
        if (n.type === 'folder') {
          return `${pad}<DT><H3 ADD_DATE="${added}">${esc(n.title)}</H3>\n${pad}<DL><p>\n${render(n.id, depth + 1)}${pad}</DL><p>\n`
        }
        return `${pad}<DT><A HREF="${esc(n.url)}" ADD_DATE="${added}">${esc(n.title)}</A>\n`
      })
      .join('')
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${render(null, 1)}</DL><p>\n`
}

export interface Suggestion {
  kind: 'bookmark' | 'history'
  url: string
  title: string
  score: number
}

/** Ranks bookmarks and history against omnibox input. Host-prefix matches win, then URL/title substrings. */
export function suggest(query: string, bookmarks: BookmarkNode[], history: HistoryEntry[], limit = 6): Suggestion[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = q.split(/\s+/)
  const visits = new Map<string, { title: string; count: number; last: number }>()
  for (const h of history) {
    const v = visits.get(h.url)
    if (v) v.count++
    else visits.set(h.url, { title: h.title, count: 1, last: h.visitedAt })
  }
  const out = new Map<string, Suggestion>()
  const consider = (kind: Suggestion['kind'], url: string, title: string, bonus: number) => {
    if (isInternalUrl(url)) return
    const hay = `${url.replace(/^https?:\/\/(www\.)?/, '')} ${title}`.toLowerCase()
    if (!terms.every((t) => hay.includes(t))) return
    const bare = url.replace(/^https?:\/\/(www\.)?/i, '').toLowerCase()
    let score = bonus
    if (bare.startsWith(q)) score += 60
    else if (hostOf(url).startsWith(q)) score += 45
    else if (title.toLowerCase().startsWith(q)) score += 25
    else score += 8
    const v = visits.get(url)
    if (v) score += Math.min(v.count, 10) * 2 + Math.max(0, 10 - (Date.now() - v.last) / 864e5)
    const prev = out.get(url)
    if (!prev || prev.score < score) out.set(url, { kind: prev?.kind === 'bookmark' ? 'bookmark' : kind, url, title, score })
  }
  for (const n of bookmarks) if (n.type === 'bookmark') consider('bookmark', n.url, n.title, 20)
  for (const [url, v] of visits) consider('history', url, v.title, 0)
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}
