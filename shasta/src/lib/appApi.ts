// In the installed app (isolated-app://) Shasta's own server is not the page's origin, so `/api/...` and
// `/ai-models/...` would hit the bundle and 404. With VITE_APP_API_ORIGIN set at build time, those requests go to that
// server instead (it allows the app's origin, see APP_ORIGINS in .env.example), always without credentials: the app
// uses the anonymous API. Imported first in main.tsx, before anything can fetch. A normal tab is never touched.

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

/** The backend the installed app talks to, or '' (in a normal tab, or when the build names none). */
export const APP_API_ORIGIN = location.protocol === 'isolated-app:' ? origin(import.meta.env.VITE_APP_API_ORIGIN) : ''

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
  if (u.origin !== location.origin || !ROUTED.test(u.pathname)) return null
  return APP_API_ORIGIN + u.pathname + u.search
}

if (APP_API_ORIGIN) {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const target = routeToBackend(url)
    if (!target) return nativeFetch(input, init)
    if (input instanceof Request) return nativeFetch(new Request(target, input), { ...init, credentials: 'omit', mode: 'cors' })
    return nativeFetch(target, { ...init, credentials: 'omit', mode: 'cors' })
  }
  const NativeEventSource = window.EventSource
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(routeToBackend(String(url)) ?? url, { ...init, withCredentials: false })
    }
  }
}
