// Links to Shasta's own Store pages that work for someone else: shasta://store#/app/<slug> and game://<slug> only mean
// something inside Shasta, so they are shared as https://<site>/?app=<slug> (or ?storefront=<slug>). Opening that
// link starts Shasta and opens the listing (`openSharedLink`, run once at start). The query, not a path, so every host
// (Pages, the bun server, the offline shell, which serves "/" for any query) answers it with the app itself.
import { appKeyOf, parseAppAddress } from './url'
import { inInstalledApp } from './shastaApp'

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/

/** The public web address of this Shasta: this page's origin, or VITE_SHARE_ORIGIN inside the installed app. */
function siteOrigin(): string | null {
  const configured = import.meta.env.VITE_SHARE_ORIGIN as string | undefined
  if (configured?.startsWith('https://')) return configured.replace(/\/+$/, '')
  if (inInstalledApp() || !/^https?:$/.test(location.protocol)) return null
  return location.origin
}

/** What a Shasta URL is about, if it can be shared: a Store listing, a storefront, or a running Store app. */
function shareTarget(url: string): { kind: 'app' | 'storefront'; slug: string } | null {
  const store = /^shasta:\/\/store#\/(app|storefront)\/([^/?#]+)/.exec(url)
  if (store) {
    const slug = decodeURIComponent(store[2]).toLowerCase()
    return SLUG.test(slug) ? { kind: store[1] as 'app' | 'storefront', slug } : null
  }
  // a running app (game://click-quest) is shared as its listing: the friend may not have it installed
  if (parseAppAddress(url)) {
    const slug = appKeyOf(url).toLowerCase()
    return SLUG.test(slug) ? { kind: 'app', slug } : null
  }
  return null
}

/** The https link for a Shasta page, or null when it has none (an ordinary site shares its own URL). */
export function shareLinkFor(url: string): string | null {
  const t = shareTarget(url)
  const origin = siteOrigin()
  return t && origin ? `${origin}/?${t.kind}=${encodeURIComponent(t.slug)}` : null
}

export const appShareLink = (slug: string) => shareLinkFor(`shasta://store#/app/${encodeURIComponent(slug)}`)

/** Shares (phone/ChromeOS share sheet) or copies the link. Returns false when it could do neither. */
export async function shareLink(link: string, title: string, notify: (msg: string) => void): Promise<boolean> {
  try {
    if (navigator.share && navigator.canShare?.({ url: link }) !== false && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ url: link, title })
      return true
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return true
  }
  try {
    await navigator.clipboard.writeText(link)
    notify('Link copied. Anyone you send it to lands on this page in Shasta.')
    return true
  } catch {
    return false
  }
}

/** The Store page a shared link points at (`?app=` / `?storefront=`), as a Store hash path; null when none. */
export function sharedStorePath(search = location.search): string | null {
  const q = new URLSearchParams(search)
  for (const kind of ['app', 'storefront'] as const) {
    const slug = q.get(kind)?.trim().toLowerCase()
    if (slug && SLUG.test(slug)) return `/${kind}/${slug}`
  }
  return null
}

/** Run once at start: opens the shared page and takes the parameter out of the address bar (a reload does not reopen it). */
export function openSharedLink(open: (storePath: string) => void) {
  const path = sharedStorePath()
  if (!path) return
  const url = new URL(location.href)
  url.searchParams.delete('app')
  url.searchParams.delete('storefront')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  open(path)
}
