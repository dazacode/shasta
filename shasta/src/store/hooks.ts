import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { api, errorMessage, ApiError } from './api'
import { useStore } from './storeStore'
import type { AppCard, SearchResult } from './types'

// ---- prefetch ---------------------------------------------------------------------------------------

const PREFETCH_MS = 30_000
const prefetched = new Map<string, { at: number; version: number; promise: Promise<unknown> }>()

/** Starts a GET early (hovering a tile) so the page that needs it opens with the answer already there. */
export function prefetchApi(path: string) {
  const version = useStore.getState().catalogVersion
  const hit = prefetched.get(path)
  if (hit && hit.version === version && Date.now() - hit.at < PREFETCH_MS) return
  const promise = api.get(path)
  promise.catch(() => prefetched.delete(path))
  prefetched.set(path, { at: Date.now(), version, promise })
  if (prefetched.size > 40) prefetched.delete(prefetched.keys().next().value!)
}

/** A prefetched answer is used once, only while fresh and only if the catalog has not changed since. */
function take<T>(path: string, signal: AbortSignal): Promise<T> {
  const hit = prefetched.get(path)
  prefetched.delete(path)
  if (hit && hit.version === useStore.getState().catalogVersion && Date.now() - hit.at < PREFETCH_MS) return hit.promise as Promise<T>
  return api.get<T>(path, signal)
}

export interface Loaded<T> {
  data: T | null
  loading: boolean
  error: string | null
  offline: boolean
  reload: () => void
}

/**
 * Loads a GET endpoint. Reloads when `path` changes and whenever the server announces a catalog change, keeping the old
 * data on screen while the refresh runs so lists do not flash.
 */
export function useApi<T>(path: string | null, { live = true }: { live?: boolean } = {}): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; offline: boolean; loading: boolean; for: string | null }>({ data: null, error: null, offline: false, loading: !!path, for: null })
  const version = useStore((s) => (live ? s.catalogVersion : 0))
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const seq = useRef(0)

  useEffect(() => {
    if (!path) return
    const mine = ++seq.current
    const ctl = new AbortController()
    setState((s) => ({ ...s, loading: true, ...(s.for !== path ? { data: null } : {}) }))
    take<T>(path, ctl.signal)
      .then((data) => mine === seq.current && setState({ data, error: null, offline: false, loading: false, for: path }))
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (mine === seq.current) setState((s) => ({ data: s.for === path ? s.data : null, error: errorMessage(e), offline: e instanceof ApiError && e.offline, loading: false, for: path }))
      })
    return () => ctl.abort()
  }, [path, version, nonce])

  return { data: state.for === path ? state.data : null, loading: state.loading, error: state.error, offline: state.offline, reload }
}

// ---- paged app lists (infinite scroll) ---------------------------------------------------------------

export const PAGE_SIZE = 24
/** the server clamps `limit` to this */
const MAX_LIMIT = 60

export interface PagedApps {
  items: AppCard[]
  total: number | null
  /** the first page is not here yet (nothing to show) */
  initial: boolean
  /** a page (first or next) is on its way */
  loading: boolean
  error: string | null
  offline: boolean
  hasMore: boolean
  loadMore: () => void
  reload: () => void
}

interface PagedState {
  key: string | null
  items: AppCard[]
  total: number | null
  loading: boolean
  error: string | null
  offline: boolean
}

// what each list had loaded, so coming back to a list (back button, Discover <-> Explore) shows it at once
const pagedCache = new Map<string, { items: AppCard[]; total: number }>()
const remember = (key: string, items: AppCard[], total: number) => {
  pagedCache.delete(key)
  pagedCache.set(key, { items, total })
  if (pagedCache.size > 12) pagedCache.delete(pagedCache.keys().next().value!)
}

const merge = (a: AppCard[], b: AppCard[]) => {
  const seen = new Set(a.map((x) => x.id))
  return a.concat(b.filter((x) => !seen.has(x.id)))
}

/**
 * `/api/catalog/apps` loaded a page at a time with `offset`. `query` is everything but limit/offset (null = load nothing).
 * A live catalog change refetches what is already loaded in place (same length, one swap), so nothing flashes and the
 * scroll position stays where it was.
 */
export function usePagedApps(query: string | null, pageSize = PAGE_SIZE): PagedApps {
  const fresh = (key: string | null): PagedState => {
    const hit = key ? pagedCache.get(key) : undefined
    return { key, items: hit?.items ?? [], total: hit?.total ?? null, loading: !!key, error: null, offline: false }
  }
  const [state, setState] = useState<PagedState>(() => fresh(query))
  const version = useStore((s) => s.catalogVersion)
  const [nonce, setNonce] = useState(0)
  const gen = useRef(0)
  const ctl = useRef<AbortController | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const fetchRange = useCallback(async (q: string, offset: number, count: number, signal: AbortSignal) => {
    const parts: Promise<SearchResult>[] = []
    for (let o = offset; o < offset + count; o += MAX_LIMIT)
      parts.push(api.get<SearchResult>(`/api/catalog/apps?${q}${q ? '&' : ''}limit=${Math.min(MAX_LIMIT, offset + count - o)}&offset=${o}`, signal))
    const pages = await Promise.all(parts)
    return { items: pages.reduce<AppCard[]>((all, p) => merge(all, p.items), []), total: pages[0]?.total ?? 0 }
  }, [])

  // first page, a refresh after a live change, or a retry: (re)load everything that is meant to be on screen
  useEffect(() => {
    if (!query) {
      setState(fresh(null))
      return
    }
    const mine = ++gen.current
    ctl.current?.abort()
    const c = (ctl.current = new AbortController())
    const prev = stateRef.current.key === query ? stateRef.current : fresh(query)
    const count = Math.max(pageSize, prev.items.length)
    setState({ ...prev, key: query, loading: true, error: null })
    fetchRange(query, 0, count, c.signal)
      .then(({ items, total }) => {
        if (mine !== gen.current) return
        remember(query, items, total)
        setState({ key: query, items, total, loading: false, error: null, offline: false })
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (mine === gen.current) setState((s) => ({ ...s, loading: false, error: errorMessage(e), offline: e instanceof ApiError && e.offline }))
      })
    return () => c.abort()
  }, [query, version, nonce, pageSize, fetchRange]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    const s = stateRef.current
    if (!s.key || s.loading || s.error || s.total === null || s.items.length >= s.total) return
    const mine = ++gen.current
    const key = s.key
    const c = (ctl.current = new AbortController())
    setState({ ...s, loading: true })
    fetchRange(key, s.items.length, pageSize, c.signal)
      .then(({ items, total }) => {
        if (mine !== gen.current) return
        setState((cur) => {
          const all = merge(cur.items, items)
          remember(key, all, total)
          return { ...cur, items: all, total, loading: false }
        })
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (mine === gen.current) setState((cur) => ({ ...cur, loading: false, error: errorMessage(e), offline: e instanceof ApiError && e.offline }))
      })
  }, [pageSize, fetchRange])

  useEffect(() => {
    return () => ctl.current?.abort()
  }, [])

  const mineNow = state.key === query
  const items = mineNow ? state.items : []
  const total = mineNow ? state.total : null
  return {
    items,
    total,
    initial: items.length === 0 && (!mineNow || state.loading) && !state.error,
    loading: !mineNow || state.loading,
    error: mineNow ? state.error : null,
    offline: mineNow && state.offline,
    hasMore: total !== null && items.length < total,
    loadMore,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  }
}

/** Builds the query string for `usePagedApps` / `/api/catalog/apps`, leaving out empty values. */
export function appsQuery(params: Record<string, string | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  return p.toString()
}

// ---- viewport ----------------------------------------------------------------------------------------

/**
 * True while the element is within `margin` of the viewport. With `once`, it stays true after the first time
 * (lazy-mounting a rail). Without IntersectionObserver everything counts as visible.
 */
export function useNearViewport(ref: RefObject<Element | null>, { margin = '600px', once = false }: { margin?: string; once?: boolean } = {}): boolean {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting)
        setNear(hit)
        if (hit && once) io.disconnect()
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin, once])
  return near
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

/** Runs once per page load: starts the account check and the live catalog stream. */
export function useStoreBoot() {
  const boot = useStore((s) => s.boot)
  useEffect(() => {
    void boot()
  }, [boot])
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const timeAgo = (ms: number | null): string => {
  if (!ms) return ''
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export const formatDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
