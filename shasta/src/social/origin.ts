// Where social lives (docs/social-protocol.md "Client modules"). The phone app is on ONE fixed domain, never a mirror,
// so a parent can block it in Screen Time or Family Link; the API is wherever this page's backend is.
import { APP_API_ORIGIN } from '@/lib/appApi'
import { BASE, SHARED_ORIGIN } from '@/lib/edition'
import { inInstalledApp } from '@/lib/shastaApp'

const httpsOrigin = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim()) return ''
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : ''
  } catch {
    return ''
  }
}

/**
 * The address the phone app is served from, without a trailing slash (`<this>/me` is the app). VITE_SOCIAL_ORIGIN,
 * else the same rule as `siteAddress()` in lib/saveShasta.ts (not imported: that module pulls in the whole settings
 * store, and the phone bundle stays small), else the installed app's backend. '' when there is none.
 */
export function socialOrigin(): string {
  const configured = httpsOrigin(import.meta.env.VITE_SOCIAL_ORIGIN) || httpsOrigin(import.meta.env.VITE_SHARE_ORIGIN)
  if (configured) return configured
  if (typeof location !== 'undefined' && !inInstalledApp() && /^https?:$/.test(location.protocol)) return `${location.origin}${BASE}`.replace(/\/+$/, '')
  return APP_API_ORIGIN
}

/** Where `/api/social/...` lives: the installed app's or Lite's backend, else this page's own server. */
export function apiBase(): string {
  return APP_API_ORIGIN || (typeof location !== 'undefined' ? location.origin : '')
}

/** Social is off on an origin other people's pages share (jsDelivr): a token kept there would be theirs to read. */
export const SOCIAL_AVAILABLE = !SHARED_ORIGIN

/** The `ws(s)://` form of an API path. */
export function socketUrl(path: string): string {
  const u = new URL(path, apiBase() || 'http://localhost')
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}
