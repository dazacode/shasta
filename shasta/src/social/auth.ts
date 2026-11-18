// The social session (docs/social-protocol.md "Basics"): one device = one Better Auth session, carried as a bearer
// token in the Authorization header and never as a cookie (Lite and app origins carry none, and no cookie means no
// CSRF). The token lives in IndexedDB `shasta-social` (kv.ts), not localStorage. Better Auth hands a new or refreshed
// token back in the `set-auth-token` response header; whoever sees one saves it.
import { createAuthClient } from 'better-auth/client'
import { anonymousClient, deviceAuthorizationClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'
import { kvGet, kvSet } from './kv'
import { apiBase } from './origin'

const KEY = 'session'
/** undefined = not read yet */
let cached: string | null | undefined
const listeners = new Set<(token: string | null) => void>()

export async function loadToken(): Promise<string | null> {
  if (cached === undefined) cached = await kvGet<string>(KEY)
  return cached
}

/** null signs this device out locally (the server session is revoked separately, by DELETE devices/:id). */
export async function saveToken(token: string | null): Promise<void> {
  if (token === cached) return
  cached = token
  await kvSet(KEY, token)
  // the resume point belongs to the session that read it
  if (!token) await kvSet('seq', null)
  listeners.forEach((fn) => fn(token))
}

/** Called with the new token (or null) whenever it changes; returns the unsubscribe. */
export function onTokenChange(fn: (token: string | null) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function signedIn(): Promise<boolean> {
  return !!(await loadToken())
}

/** Saves the token a response carries in `set-auth-token`, if any (Better Auth's bearer plugin and our own routes). */
export function takeTokenFrom(res: Response): void {
  const t = res.headers.get('set-auth-token')
  if (t) void saveToken(t)
}

export const authClient = createAuthClient({
  baseURL: `${apiBase()}/api/social/auth`,
  fetchOptions: {
    credentials: 'omit',
    auth: { type: 'Bearer', token: async () => (await loadToken()) ?? '' },
    onSuccess: (ctx) => takeTokenFrom(ctx.response),
  },
  plugins: [anonymousClient(), passkeyClient(), deviceAuthorizationClient()],
})

/** "Shasta on iPhone": the name a device gets until someone renames it. Never the browser's full user agent. */
export function defaultDeviceName(kind: 'phone' | 'desktop'): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (kind === 'desktop') return /CrOS/.test(ua) ? 'Chromebook' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : 'Computer'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  return 'Phone'
}
