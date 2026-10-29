// Query predictions while typing in the address bar. Free, no API key: Shasta's server asks the chosen search engine's
// public suggestion endpoint (GET /api/suggest), so the engine sees the server rather than this device.
// What you type goes to the Shasta server and then to that engine, which is why the setting says so and can be turned off.
import { useEffect, useState } from 'react'
import type { SearchEngine } from './url'

export interface Prediction {
  text: string
  kind: 'query' | 'nav' | 'entity'
  description?: string
}

// same-origin (not 'omit'): behind Cloudflare Access (private development) the sign-in cookie must travel or Access redirects the call. The server ignores cookies here.
const cache = new Map<string, Prediction[]>()

export async function fetchSuggestions(query: string, engine: SearchEngine, signal?: AbortSignal): Promise<Prediction[]> {
  const q = query.trim().slice(0, 100)
  if (!q) return []
  const key = `${engine}\0${q.toLowerCase()}`
  const hit = cache.get(key)
  if (hit) return hit
  const res = await fetch(`/api/suggest?engine=${engine}&q=${encodeURIComponent(q)}`, { signal, credentials: 'same-origin' })
  if (!res.ok) return []
  const body = (await res.json()) as { suggestions?: unknown }
  const list = (Array.isArray(body.suggestions) ? (body.suggestions as Prediction[]) : []).filter((s) => typeof s?.text === 'string' && ['query', 'nav', 'entity'].includes(s.kind)).slice(0, 8)
  if (cache.size > 300) cache.delete(cache.keys().next().value!)
  cache.set(key, list)
  return list
}

/** Predictions for `query`, debounced. Empty while off, empty input, offline, or while the first answer is in flight. */
export function useQuerySuggestions(query: string, engine: SearchEngine, enabled: boolean): Prediction[] {
  const [state, setState] = useState<{ q: string; list: Prediction[] }>({ q: '', list: [] })
  useEffect(() => {
    const q = query.trim()
    // addresses are not searches: don't send them anywhere
    if (!enabled || !q || /^[a-z][a-z0-9+.-]*:\/\//i.test(q)) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      fetchSuggestions(q, engine, ctl.signal)
        .then((list) => setState({ q, list }))
        .catch(() => undefined)
    }, 120)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [query, engine, enabled])
  return enabled && state.q === query.trim() ? state.list : []
}
