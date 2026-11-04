// In the installed app (isolated-app://) Shasta's own server is not the page's origin, so `/api/...` and
// `/ai-models/...` would hit the bundle and 404. With VITE_APP_API_ORIGIN set at build time, those requests go to that
// server instead (it allows the app's origin, see APP_ORIGINS in .env.example), always without credentials: the app
// uses the anonymous API. Imported first in main.tsx, before anything can fetch. A normal tab is never touched.

import { FULL_SITE, LITE } from './edition'

const origin = (v: unknown): string => {
  if (typeof v !== 'string') return ''
  try {
    const u = new URL(v.trim())
    // https only: the app's CSP (connect-src 'self' https: wss:) would block anything else anyway
    return u.protocol === 'https:' ? u.origin : ''
  } catch {
    return ''
  }
}

/**
 * Backends to try, in order. Lite (lib/edition.ts) gets several on different domains (VITE_API_ORIGINS, set by
 * scripts/lib/liteBuild.ts: the full site, edushasta.lol, the bunny.net relay), so a filter that blocks one domain
 * does not take the Store, chat and live updates down with it. The installed app has exactly one.
 */
export const API_ORIGINS: readonly string[] =
  location.protocol === 'isolated-app:'
    ? [origin(import.meta.env.VITE_APP_API_ORIGIN)].filter(Boolean)
    : LITE
      ? [...new Set([...String(import.meta.env.VITE_API_ORIGINS ?? '').split(/[\s,]+/), FULL_SITE].map(origin).filter(Boolean))]
      : []

/**
 * The backend the installed app (or Shasta Lite on a host without one) talks to right now, or '' (in a normal tab,
 * or when the build names none). A LIVE binding: it moves to the next of API_ORIGINS when this one cannot be reached
 * (a network error, which is what a filter block or an unknown host looks like), and every importer sees the new value.
 */
export let APP_API_ORIGIN = API_ORIGINS[0] ?? ''

/** Moves on from `failed` after it stopped answering; false when there is no other backend left. Only the first
 *  caller for a given origin moves it, so parallel failures do not skip a backend. */
export function nextApiOrigin(failed: string): boolean {
  if (failed !== APP_API_ORIGIN) return true // someone already moved on
  const i = API_ORIGINS.indexOf(failed)
  if (i < 0 || i + 1 >= API_ORIGINS.length) return false
  APP_API_ORIGIN = API_ORIGINS[i + 1]
  return true
}

/**
 * `crossOrigin` for Store artwork: in the app it comes from the backend, and only a CORS-mode image load passes the
 * app's cross-origin isolation (the backend allows the app's origin). Undefined (a plain <img>) everywhere else.
 */
export const MEDIA_CORS: 'anonymous' | undefined = APP_API_ORIGIN ? 'anonymous' : undefined

const ROUTED = /^\/(api|ai-models)\//

/** The backend address for a same-origin `/api` or `/ai-models` URL, or null to leave the request alone. */
export function routeToBackend(url: string): string | null {
  if (!APP_API_ORIGIN) return null
  let u: URL
  try {
    u = new URL(url, location.href)
  } catch {
    return null
  }
  // same-origin /api, or a URL a caller already built on one of the backends (watch/api.ts, chat media): both go to
  // the backend in use now
  if ((u.origin !== location.origin && !API_ORIGINS.includes(u.origin)) || !ROUTED.test(u.pathname)) return null
  return APP_API_ORIGIN + u.pathname + u.search
}

if (APP_API_ORIGIN) {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!routeToBackend(url)) return nativeFetch(input, init)
    // a Request body can be read once: keep a copy for a retry on the next backend
    const base = input instanceof Request ? input.clone() : null
    const attempt = async (left: number): Promise<Response> => {
      const used = APP_API_ORIGIN
      const target = routeToBackend(url)!
      try {
        return await nativeFetch(base ? new Request(target, base.clone()) : target, { ...init, credentials: 'omit', mode: 'cors' })
      } catch (e) {
        // aborted by the caller: not the backend's fault
        if ((e as Error)?.name === 'AbortError' || left <= 0 || !nextApiOrigin(used)) throw e
        return attempt(left - 1)
      }
    }
    return attempt(API_ORIGINS.length - 1)
  }
  const NativeEventSource = window.EventSource
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(routeToBackend(String(url)) ?? url, { ...init, withCredentials: false })
    }
  }
}
