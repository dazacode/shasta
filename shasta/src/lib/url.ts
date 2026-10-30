export const SEARCH_ENGINES = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  ecosia: { label: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
} as const

export type SearchEngine = keyof typeof SEARCH_ENGINES

/** Shasta's own pages, rendered by the shell rather than by the proxy. */
export const INTERNAL_SCHEME = 'shasta://'
export const INTERNAL_PAGES = ['newtab', 'history', 'bookmarks', 'downloads', 'settings', 'store', 'library', 'watch', 'app', 'support', 'get-app', 'chat', 'discord', 'whats-new', 'privacy'] as const
export type InternalPage = (typeof INTERNAL_PAGES)[number]
export const NEW_TAB_URL = `${INTERNAL_SCHEME}newtab`

/**
 * Installed Store apps have their own addresses, like an installed web app (PWA) but resolved by Shasta itself:
 * game://click-quest for games, app://discord for everything else. The browser launches the installed app, always at
 * the newest published version, inside Shasta's own runtime instead of loading some address from the open web.
 */
export const APP_SCHEMES = ['app', 'game'] as const
export type AppScheme = (typeof APP_SCHEMES)[number]

export interface AppAddress {
  scheme: AppScheme
  slug: string
  /** anything after the name ("/channels/1"), only meaningful for web apps */
  path: string
}

const APP_ADDRESS = /^(app|game):\/\/([a-z0-9][a-z0-9-]{0,62})(\/[^\s]*)?$/i

export function parseAppAddress(url: string): AppAddress | null {
  const m = APP_ADDRESS.exec(url.trim())
  return m ? { scheme: m[1].toLowerCase() as AppScheme, slug: m[2].toLowerCase(), path: m[3] ?? '' } : null
}

export const appAddress = (scheme: AppScheme, slug: string) => `${scheme}://${slug}`

/** The app a Shasta page is about: from app://name, game://name, or the older shasta://app#id form. */
export function appKeyOf(url: string): string {
  return parseAppAddress(url)?.slug ?? (url.startsWith(`${INTERNAL_SCHEME}app`) ? (url.split('#')[1] ?? '') : '')
}

/** Shasta's own pages and installed-app addresses are rendered by the shell, never fetched through the proxy. */
export const isInternalUrl = (url: string) => url.startsWith(INTERNAL_SCHEME) || parseAppAddress(url) !== null

export function internalPage(url: string): InternalPage | null {
  if (parseAppAddress(url)) return 'app'
  if (!url.startsWith(INTERNAL_SCHEME)) return null
  const name = url.slice(INTERNAL_SCHEME.length).replace(/[/?#].*$/, '')
  return (INTERNAL_PAGES as readonly string[]).includes(name) ? (name as InternalPage) : null
}

export const internalUrl = (page: InternalPage, section = '') => `${INTERNAL_SCHEME}${page}${section ? `#${section}` : ''}`

/** The `#section` part of a Shasta page address (used by Settings), without the `#`. */
export const internalSection = (url: string) => (isInternalUrl(url) ? (url.split('#')[1] ?? '') : '')

export type Resolved =
  | { kind: 'empty' }
  | { kind: 'internal'; url: string }
  | { kind: 'app'; url: string; scheme: AppScheme; slug: string; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string; query: string }
  | { kind: 'invalid'; reason: string }

const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const HAS_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i
// host[:port][/path] where host is localhost, an IPv4 address, or a dotted name with a letter TLD
const LOOKS_LIKE_HOST = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d{1,5})?(?:[/?#]|$)/i
const LOOKS_LIKE_HOST_PORT = /^[^\s/?#:@]+:\d{1,5}([/?#]|$)/
const PROXYABLE = new Set(['http:', 'https:'])

export function searchUrl(query: string, engine: SearchEngine): string {
  return SEARCH_ENGINES[engine].url.replace('%s', encodeURIComponent(query))
}

/**
 * Turns omnibox input into an internal page, an http(s) URL, or a search.
 * Anything that is not a page the proxy can fetch (javascript:, data:, file:, ...) is rejected.
 */
export function resolveInput(input: string, engine: SearchEngine): Resolved {
  const text = input.trim()
  if (!text) return { kind: 'empty' }

  const app = parseAppAddress(text)
  if (app) return { kind: 'app', url: appAddress(app.scheme, app.slug) + app.path, ...app }

  if (isInternalUrl(text.toLowerCase())) {
    const page = internalPage(text.toLowerCase())
    return page ? { kind: 'internal', url: internalUrl(page, internalSection(text.toLowerCase())) } : { kind: 'invalid', reason: `Unknown Shasta page: ${text}` }
  }

  const hasSpace = /\s/.test(text)
  if (!hasSpace && HAS_AUTHORITY.test(text)) {
    try {
      const u = new URL(text)
      if (!PROXYABLE.has(u.protocol)) return { kind: 'invalid', reason: `Shasta cannot open ${u.protocol} addresses.` }
      if (!u.hostname) return { kind: 'invalid', reason: 'That address has no host name.' }
      return { kind: 'url', url: u.href }
    } catch {
      return { kind: 'invalid', reason: 'That address is not a valid URL.' }
    }
  }

  // "javascript:alert(1)", "data:...", "file:..." and friends: never navigate or search for them silently
  const scheme = SCHEME.exec(text)
  if (scheme && !LOOKS_LIKE_HOST_PORT.test(text) && !hasSpace) {
    const s = scheme[1].toLowerCase()
    if (['javascript', 'data', 'file', 'blob', 'about', 'chrome', 'view-source', 'ftp', 'mailto', 'tel', 'ws', 'wss'].includes(s)) {
      return { kind: 'invalid', reason: `Shasta cannot open ${s}: addresses.` }
    }
  }

  if (!hasSpace && (LOOKS_LIKE_HOST.test(text) || LOOKS_LIKE_HOST_PORT.test(text))) {
    try {
      const u = new URL(`${/^(localhost|\d+\.\d+\.\d+\.\d+)(:|\/|$)/i.test(text) ? 'http' : 'https'}://${text}`)
      return { kind: 'url', url: u.href }
    } catch {
      /* fall through to search */
    }
  }
  return { kind: 'search', url: searchUrl(text, engine), query: text }
}

export function hostOf(url: string): string {
  if (isInternalUrl(url)) return url
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** URL for display in the address bar: no scheme for https, no trailing slash on bare origins. */
export function displayUrl(url: string): string {
  if (!url || isInternalUrl(url)) return url
  try {
    const u = new URL(url)
    const rest = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash
    return (u.protocol === 'https:' ? '' : u.protocol + '//') + u.host + rest
  } catch {
    return url
  }
}

/** Strips query string and hash so diagnostics never record search terms or tokens. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return ''
  }
}

export function titleFor(url: string): string {
  const app = parseAppAddress(url)
  if (app) return app.slug
  const page = internalPage(url)
  if (page === 'newtab') return 'New Tab'
  if (page === 'store') return 'Shasta Store'
  if (page === 'watch') return 'Watch'
  if (page === 'support') return 'Support Shasta'
  if (page === 'privacy') return 'Privacy'
  if (page === 'get-app') return 'Get the Shasta app'
  if (page === 'chat') return 'Chat'
  if (page === 'discord') return 'Discord'
  if (page === 'whats-new') return "What's new"
  if (page) return page.charAt(0).toUpperCase() + page.slice(1)
  return hostOf(url)
}
