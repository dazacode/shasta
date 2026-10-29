// Recognises sign-in pages from the address alone. It never looks at the page, its forms or anything typed into it.
// The wording is deliberately hedged: nobody can promise that a particular login works through a proxy.

export interface KnownIssue {
  title: string
  body: string
}
export interface SignInInfo {
  isSignIn: boolean
  host: string
  known?: KnownIssue
}

const PATH_HINT = /(^|\/)(log-?in|sign-?in|signin|sign_in|accounts?|auth|oauth2?|sso|authorize|session)(\/|$|\.)/i

const BIG_IDENTITY: KnownIssue = {
  title: 'This sign-in may not work through a proxy',
  body: 'Large account providers often refuse sign-ins that come from proxies or embedded browsers, or ask for extra checks. If it fails, that is the site declining, not something you did wrong.',
}

const IDENTITY_HOSTS: Record<string, KnownIssue> = {
  'accounts.google.com': BIG_IDENTITY,
  'login.microsoftonline.com': BIG_IDENTITY,
  'login.live.com': BIG_IDENTITY,
  'appleid.apple.com': BIG_IDENTITY,
  'idmsa.apple.com': BIG_IDENTITY,
}

const GENERAL: KnownIssue = {
  title: 'Some sign-in methods may not work here',
  body: 'Passkeys and security keys (WebAuthn) generally cannot work, because the site sees a different address than the one your key was registered for. "Sign in with Google/Apple/…" pop-ups, CAPTCHAs and anti-bot checks may also fail.',
}

export const SIGN_IN_WARNING = "You're signing in through the Shasta proxy. The proxy can see which sites you connect to, and whoever runs this Shasta server controls the code your browser runs. Only continue if you trust this Shasta server."

export function classifySignIn(url: string): SignInInfo {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { isSignIn: false, host: '' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { isSignIn: false, host: '' }
  const host = u.hostname.toLowerCase()
  const known = IDENTITY_HOSTS[host]
  if (known) return { isSignIn: true, host, known }
  const isSignIn = PATH_HINT.test(u.pathname) || /^(login|signin|sso|auth|accounts?|id)\./.test(host)
  return isSignIn ? { isSignIn, host, known: GENERAL } : { isSignIn: false, host }
}

/** The real website address to open in the host browser. Tab addresses are already the real URL (never a proxy URL). */
export function directOpenUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** Opens the real site outside Shasta: no opener link, no referrer. */
export function openInHostBrowser(url: string) {
  const target = directOpenUrl(url)
  if (target) window.open(target, '_blank', 'noopener,noreferrer')
}

const ACK_KEY = 'shasta-proxy-disclosure-ack'
export function hasAcknowledgedDisclosure(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === '1'
  } catch {
    return false
  }
}
export function acknowledgeDisclosure() {
  try {
    localStorage.setItem(ACK_KEY, '1')
  } catch {
    /* storage blocked: it will ask again next time */
  }
}
