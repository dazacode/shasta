// In-app Network panel (Settings -> Advanced -> Developer tools -> Network): the requests proxied pages make, what
// DevTools' Network tab would show, for people whose school blocks DevTools. Filled by the proxy plugin's fetch hooks
// (proxy/shastaPlugin.ts). Memory only, never sent anywhere, cleared when Shasta closes. Addresses without query strings,
// private tabs never.
import { create } from 'zustand'

export interface NetEntry {
  id: number
  at: number
  method: string
  url: string
  /** fetch destination: document, script, worker, image, '' (fetch/XHR)… */
  type: string
  status?: number
  /** bytes, from Content-Length when the server sent one */
  size?: number
  mime?: string
  ms?: number
  error?: string
  /** what Shasta did with it: blocked as an ad, converted, … */
  note?: string
  /** the tab's page host, to tell tabs apart */
  page?: string
}

const LIMIT = 1500
// like the Diagnostic log: no query strings (sign-in tokens and signed links live there), so a copied report is safe to share
const noQuery = (url: string) => {
  try {
    const u = new URL(url)
    return u.search ? `${u.origin}${u.pathname}?…` : `${u.origin}${u.pathname}`
  } catch {
    return url.split(/[?#]/)[0]
  }
}
// Private tabs are never recorded. tabsStore registers the check (importing it here would be an import cycle).
let isPrivate: (tabId: string) => boolean = () => false
export function setPrivateTabCheck(fn: (tabId: string) => boolean) {
  isPrivate = fn
}
/** whether requests of this tab may be recorded */
export const netRecords = (tabId: string) => !isPrivate(tabId)
let seq = 0
let dirty = false
let timer: ReturnType<typeof setTimeout> | undefined
const list: NetEntry[] = []
const byKey = new WeakMap<object, NetEntry>()

interface NetState {
  entries: NetEntry[]
  clear: () => void
}

export const useNetLog = create<NetState>()((set) => ({
  entries: [],
  clear: () => {
    list.length = 0
    set({ entries: [] })
  },
}))

// A game makes thousands of requests: when the list is full, drop the oldest ORDINARY one (answered, not failed, nothing
// Shasta changed), so the converted .wasm or the request that failed is still there when someone looks.
function trim() {
  while (list.length > LIMIT) {
    const i = list.findIndex((e) => !e.note && !e.error && e.status !== undefined && e.status < 400)
    list.splice(i < 0 ? 0 : i, 1)
  }
}

function flush() {
  timer ??= setTimeout(() => {
    timer = undefined
    if (!dirty) return
    dirty = false
    useNetLog.setState({ entries: list.slice() })
  }, 300)
}

/** A request started. `key` is any object that identifies it until it ends (the hook's request object). */
export function netStart(key: object, e: Omit<NetEntry, 'id' | 'at'>) {
  const entry: NetEntry = { id: ++seq, at: Date.now(), ...e, url: noQuery(e.url) }
  byKey.set(key, entry)
  list.push(entry)
  trim()
  dirty = true
  flush()
  return entry
}

/** The request answered, failed, or Shasta noted something about it. */
export function netUpdate(key: object, patch: Partial<NetEntry>) {
  const entry = byKey.get(key)
  if (!entry) return
  Object.assign(entry, patch)
  if (entry.ms === undefined && (patch.status !== undefined || patch.error !== undefined)) entry.ms = Date.now() - entry.at
  dirty = true
  flush()
}

/** a request Shasta answered itself (ad blocked) or that never had a start */
export function netNote(e: Omit<NetEntry, 'id' | 'at'>) {
  list.push({ id: ++seq, at: Date.now(), ...e, url: noQuery(e.url) })
  trim()
  dirty = true
  flush()
}

export function netText(entries: NetEntry[]): string {
  return entries
    .map((e) =>
      [
        new Date(e.at).toISOString(),
        e.method,
        e.status ?? (e.error ? 'ERR' : '…'),
        e.type || 'fetch',
        e.size !== undefined ? `${e.size}B` : '',
        e.ms !== undefined ? `${e.ms}ms` : '',
        e.url,
        e.error ? `error: ${e.error}` : '',
        e.note ? `(${e.note})` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join('\n')
}

/** test hook */
export function _flushNet() {
  if (timer) clearTimeout(timer)
  timer = undefined
  dirty = false
  useNetLog.setState({ entries: list.slice() })
}
