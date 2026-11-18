// How the phone app was opened: by a scanned link (`#l=` to link a computer, `#f=` to add a friend) or plainly.
// The part after `#` never reaches the server, and it is taken out of the address bar AT ONCE, before anything else
// runs: a link code must not survive in history, a screenshot of the address bar, or a shared tab.
import { parseFriendCode, parseInvite, type LinkInvite } from '@/social/link'

export type Arrival = { kind: 'link'; invite: LinkInvite; via: 'camera' | 'scanner' } | { kind: 'friend'; token: string; via: 'camera' | 'scanner' } | null

/** Reads a hash (or a whole scanned URL's hash). */
export function arrivalFrom(hash: string, via: 'camera' | 'scanner'): Arrival {
  const invite = parseInvite(hash)
  if (invite) return { kind: 'link', invite, via }
  const token = parseFriendCode(hash)
  if (token) return { kind: 'friend', token, via }
  return null
}

/** Called once at start: reads the address's hash and strips it. */
export function takeArrival(): Arrival {
  const hash = location.hash
  if (!hash) return null
  history.replaceState(history.state, '', location.pathname + location.search)
  return arrivalFrom(hash, 'camera')
}

/**
 * A code the in-app scanner read: only Shasta's own phone links count (the same origin as this page), so a QR
 * code that only looks like one can't send someone elsewhere.
 */
export function scannedArrival(raw: string): Arrival | 'foreign' {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'foreign'
  }
  if (u.origin !== location.origin || !/\/me(\.html|\/)?$/.test(u.pathname)) return 'foreign'
  return arrivalFrom(u.hash, 'scanner')
}

// ---- later arrivals: a link handed to the open app (launchQueue) or a hash change in this tab ----------------------

type Listener = (a: NonNullable<Arrival>) => void
const listeners = new Set<Listener>()
export function onArrival(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function announceArrival(a: Arrival) {
  if (a) listeners.forEach((fn) => fn(a))
}
