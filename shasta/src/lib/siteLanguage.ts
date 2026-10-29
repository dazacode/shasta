// The visitor's language for proxied pages. Sites see the relay's address, so without help they answer in the
// relay's language (a relay in Germany gave German pages).
//
// Accept-Language: browsers add it in the network stack, after the service worker, so the requests Scramjet sends
// through Wisp have none. Built like Chrome's: "en-US,en;q=0.9,de;q=0.8".
export function acceptLanguage(languages: readonly string[]): string {
  const unique = [...new Set(languages.map((l) => l.trim()).filter((l) => /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(l)))]
  if (!unique.length) return 'en-US,en;q=0.9'
  return unique
    .slice(0, 10)
    .map((l, i) => (i === 0 ? l : `${l};q=${Math.max(0.1, 1 - i / 10).toFixed(1)}`))
    .join(',')
}

type RawHeaders = [string, string][]

/** Adds Accept-Language unless the page set one itself. */
export function withAcceptLanguage(headers: RawHeaders, languages: readonly string[]): void {
  if (headers.some(([k]) => k.toLowerCase() === 'accept-language')) return
  headers.push(['Accept-Language', acceptLanguage(languages)])
}

// Google ignores Accept-Language on its own pages and goes by the address's country; it does follow its `hl`
// (language) and `gl` (country) parameters. Only page loads of the home/search pages, only when the URL sets neither.
const GOOGLE_HOST = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/
const GOOGLE_PAGES = new Set(['/', '/search', '/webhp', '/imghp'])

/** The URL to request instead, or null to leave it alone. */
export function googleLocale(url: URL, languages: readonly string[]): URL | null {
  if (!GOOGLE_HOST.test(url.hostname) || !GOOGLE_PAGES.has(url.pathname)) return null
  if (url.searchParams.has('hl') || url.searchParams.has('gl')) return null
  const [lang, region] = (languages[0] ?? '').split('-')
  if (!/^[A-Za-z]{2,3}$/.test(lang ?? '')) return null
  const next = new URL(url)
  next.searchParams.set('hl', lang.toLowerCase())
  if (region && /^[A-Za-z]{2}$/.test(region)) next.searchParams.set('gl', region.toLowerCase())
  return next
}
