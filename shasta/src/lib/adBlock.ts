// Ad and pop-up blocking for proxied pages, on @ghostery/adblocker (the engine behind Ghostery) with EasyList,
// EasyPrivacy, Peter Lowe's list and the uBlock Origin filters. scripts/build-adblock.ts parses the lists at build time
// into /adblock/engine.bin; the browser loads that one file once. What a page gets (proxy/adCosmetics.ts applies it):
// blocked requests answered inside the proxy (never reach the network), the lists' element hiding for the site AND the
// generic rules for the classes/ids/links actually in the page, procedural selectors (:has-text, :upward...), and the
// uBlock Origin scriptlets (+js rules) that defuse ad and anti-adblock code before the page's own scripts run.
// The proxy layer reads the policy from here and never imports the stores.
// the library is imported when the engine loads (it is large, and touches the DOM at import time)
import type { FiltersEngine, RequestType } from '@ghostery/adblocker'
import type { IMessageFromBackground } from '@ghostery/adblocker-content'

type Lib = typeof import('@ghostery/adblocker')

export const ENGINE_URL = '/adblock/engine.bin'

let engine: FiltersEngine | null = null
let lib: Lib | null = null
let loading: Promise<FiltersEngine | null> | null = null

/** Loads the filter engine once. Resolves to null when it is unavailable (a build without it, offline): pages still load. */
export function loadAdBlocker(): Promise<FiltersEngine | null> {
  loading ??= Promise.all([import('@ghostery/adblocker'), fetch(ENGINE_URL).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))])
    .then(([l, buf]) => {
      lib = l
      return (engine = l.FiltersEngine.deserialize(new Uint8Array(buf)))
    })
    .catch((e) => {
      console.warn('[shasta] ad blocker unavailable:', e instanceof Error ? e.message : e)
      loading = null // try again on a later page
      return null
    })
  return loading
}

export const adBlockerReady = () => engine !== null

/** Fetch `destination` (what Scramjet reports) to the engine's webRequest-style type. */
export function requestType(destination: string): RequestType {
  switch (destination) {
    case 'document': return 'main_frame'
    case 'iframe': case 'frame': return 'sub_frame'
    case 'script': case 'worker': case 'sharedworker': case 'serviceworker': case 'audioworklet': case 'paintworklet': return 'script'
    case 'style': return 'stylesheet'
    case 'image': return 'image'
    case 'font': return 'font'
    case 'audio': case 'video': case 'track': return 'media'
    case 'object': case 'embed': return 'object'
    case '': return 'xmlhttprequest'
    default: return 'other'
  }
}

export interface AdMatch {
  /** a filter-list "redirect" rule: a harmless stand-in (an empty script, a 1x1 gif) the page expects instead */
  redirect?: { body: string | ArrayBuffer; contentType: string }
}

/** Filter-list resources come as text, or as base64 when the type says so (`image/gif;base64`). */
function resourceBody(body: string, contentType: string): { body: string | ArrayBuffer; contentType: string } {
  if (!/;\s*base64/i.test(contentType)) return { body, contentType }
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { body: bytes.buffer, contentType: contentType.replace(/;\s*base64/i, '') }
}

/** The filter verdict for a request made by the page at `pageUrl`, or null to let it through. Needs loadAdBlocker() first. */
export function matchAd(url: URL, destination: string, pageUrl?: string): AdMatch | null {
  if (!engine || !lib || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null
  const result = engine.match(lib.Request.fromRawDetails({ url: url.href, sourceUrl: pageUrl ?? '', type: requestType(destination) }))
  if (!result.match && !result.redirect) return null
  return result.redirect ? { redirect: resourceBody(result.redirect.body, result.redirect.contentType) } : {}
}

export type Cosmetics = Pick<IMessageFromBackground, 'styles' | 'scripts' | 'extended'>

const httpUrl = (pageUrl: string): URL | null => {
  try {
    const u = new URL(pageUrl)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null
  } catch {
    return null
  }
}

/** What a page gets when it starts: the plain element hiding, the rules for its site, procedural selectors and scriptlets. */
export function pageCosmetics(pageUrl: string): Cosmetics | null {
  const u = engine && lib && httpUrl(pageUrl)
  if (!u || !engine || !lib) return null
  try {
    const { domain } = lib.Request.fromRawDetails({ url: u.href })
    const r = engine.getCosmeticsFilters({ url: u.href, hostname: u.hostname, domain, getBaseRules: true, getInjectionRules: true, getExtendedRules: true, getRulesFromHostname: true, getRulesFromDOM: false })
    return r.active === false ? null : { styles: r.styles, scripts: r.scripts, extended: r.extended }
  } catch {
    return null
  }
}

/** Generic hiding rules for classes, ids and links seen in the page (`##.ad-banner`): the lists hold far too many to send them all. */
export function domCosmetics(pageUrl: string, features: { classes: string[]; ids: string[]; hrefs: string[] }): string {
  const u = engine && lib && httpUrl(pageUrl)
  if (!u || !engine || !lib) return ''
  try {
    const { domain } = lib.Request.fromRawDetails({ url: u.href })
    return engine.getCosmeticsFilters({ url: u.href, hostname: u.hostname, domain, ...features, getBaseRules: false, getInjectionRules: false, getExtendedRules: false, getRulesFromHostname: false, getRulesFromDOM: true }).styles
  } catch {
    return ''
  }
}

/** A page may open a new tab this long after the person clicked or pressed a key in it (browsers allow ~5 s too). */
export const POPUP_GESTURE_MS = 5000

export interface BlockPolicy {
  ads: boolean
  popups: boolean
}

let policy: BlockPolicy = { ads: true, popups: true }

export const blockPolicy = (): BlockPolicy => policy
export const setBlockPolicy = (next: BlockPolicy) => {
  policy = { ...next }
}

/** A new tab to an address the filter lists block as a page (ad and pop-under networks). */
export const isAdPopup = (url: URL, pageUrl?: string) => policy.ads && matchAd(url, 'document', pageUrl) !== null

/** Whether a page's request to open `url` in a new tab should be refused. `lastGesture` is a Date.now() time, 0 = never. */
export function shouldBlockPopup(url: URL, lastGesture: number, pageUrl?: string, now = Date.now(), p: BlockPolicy = policy): boolean {
  if (p.ads && matchAd(url, 'document', pageUrl)) return true
  if (!p.popups) return false
  return now - lastGesture > POPUP_GESTURE_MS
}

/** What a blocked request gets instead: empty, of a harmless type, and embeddable in a cross-origin isolated shell. */
export function blockedResponseHeaders(destination: string, contentType?: string): [string, string][] {
  const type = contentType ?? (destination === 'script' ? 'text/javascript' : destination === 'style' ? 'text/css' : destination === 'iframe' || destination === 'frame' || destination === 'document' ? 'text/html; charset=utf-8' : 'text/plain')
  return [
    ['content-type', type],
    ['cache-control', 'no-store'],
    ['cross-origin-embedder-policy', 'credentialless'],
    ['cross-origin-resource-policy', 'cross-origin'],
  ]
}
