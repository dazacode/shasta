// Adverts on Shasta's OWN shell — the new tab, the Store, Watch and an optional bottom bar. Never inside the sites a
// person opens: those frames belong to the site being proxied, and Shasta's own ad blocker (lib/adBlock.ts) already
// strips theirs, so Shasta earns nothing there without injecting into them (it does not).
//
// Providers, each off unless this build names it at build time:
//  - Google AdSense (VITE_ADSENSE_CLIENT): display units placed by <AdSlot>. Needs a real domain + an approved
//    account + ads.txt (seo.ts emits it). Not in use: Watch and the proxy make approval unlikely.
//  - Adsterra banners (VITE_ADSTERRA_HOST + VITE_ADSTERRA_BANNERS, VITE_ADSTERRA_NATIVE): fixed-size units placed by
//    <AdSlot>, each inside a data: URL frame (components/ads/AdsterraFrame.tsx), so the ad
//    code gets an opaque origin and can read neither Shasta nor the proxied sites' cookie jar.
//  - Page-level tags (VITE_AD_SCRIPTS): formats that must run in the page itself (Adsterra's popunder and Social
//    Bar). These DO run with Shasta's origin, like any third-party script tag; keep the list to what is needed.
//
// Monetag was tried and removed (2026-10-30): its Push format and Multitag need their service worker at /sw.js, which
// is Shasta's own (Scramjet + offline shell). Never install an ad network's service worker.
//
// Gated exactly like lib/stats.ts: off in tests and in the installed app (the IWA CSP allows no remote script), off
// when the person turns Settings -> Privacy -> "Show ads" off, and off until the build names a provider.
import { getSettings, useSettings } from '@/stores/settingsStore'
import { inInstalledApp } from './shastaApp'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
const list = (v: unknown) =>
  str(v)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

/** AdSense publisher id, e.g. `ca-pub-1234567890123456` (`VITE_ADSENSE_CLIENT`). */
export const ADSENSE_CLIENT = str(import.meta.env.VITE_ADSENSE_CLIENT)
/** Default AdSense ad-unit id (`VITE_ADSENSE_SLOT`); a placement may override it. Units may be reused across slots. */
export const ADSENSE_SLOT = str(import.meta.env.VITE_ADSENSE_SLOT)

/** Adsterra's delivery host for this account, e.g. `https://bellnewyork.org` (`VITE_ADSTERRA_HOST`). */
export const ADSTERRA_HOST = /^https:\/\/[^/]+$/.test(str(import.meta.env.VITE_ADSTERRA_HOST).replace(/\/$/, ''))
  ? str(import.meta.env.VITE_ADSTERRA_HOST).replace(/\/$/, '')
  : ''

export type Banner = { width: number; height: number; key: string }
/** Adsterra iframe banners (`VITE_ADSTERRA_BANNERS` = `728x90:<key>,300x250:<key>,...`). Not `#`: .env reads it as
 *  a comment. */
export const ADSTERRA_BANNERS: Banner[] = ADSTERRA_HOST
  ? list(import.meta.env.VITE_ADSTERRA_BANNERS).flatMap((t) => {
      const m = /^(\d+)x(\d+):([0-9a-f]{32})$/i.exec(t)
      return m ? [{ width: +m[1], height: +m[2], key: m[3] }] : []
    })
  : []
/** Adsterra native banner key (`VITE_ADSTERRA_NATIVE`). */
export const ADSTERRA_NATIVE = ADSTERRA_HOST && /^[0-9a-f]{32}$/i.test(str(import.meta.env.VITE_ADSTERRA_NATIVE))
  ? str(import.meta.env.VITE_ADSTERRA_NATIVE)
  : ''

/** Page-level tags (`VITE_AD_SCRIPTS` = `url,url`, or `url|zone` for a tag that wants `data-zone`). */
const AD_SCRIPTS = list(import.meta.env.VITE_AD_SCRIPTS)
  .map((t) => t.split('|'))
  .filter(([src, zone]) => /^https:\/\//.test(src ?? '') && (zone === undefined || /^\d+$/.test(zone)))

/** Display (inline) units are possible: AdSense, or Adsterra banners. */
export const HAS_DISPLAY_ADS = !!ADSENSE_CLIENT || ADSTERRA_BANNERS.length > 0 || !!ADSTERRA_NATIVE
/** A provider is configured at all. */
export const HAS_ADS = HAS_DISPLAY_ADS || AD_SCRIPTS.length > 0

const AVAILABLE = HAS_ADS && import.meta.env.MODE !== 'test' && typeof document !== 'undefined' && !inInstalledApp()

/** The banner for a placement: the first of `prefer` (sizes, best first) that this build has and that fits `width`. */
export function pickBanner(prefer: string[], width: number): Banner | null {
  for (const size of prefer) {
    const b = ADSTERRA_BANNERS.find((x) => `${x.width}x${x.height}` === size)
    if (b && b.width <= width) return b
  }
  return null
}

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>
  }
}

let started = false
let loaded = false

/** Loads a script once, off the critical path. `extra` sets the attributes the provider's tag needs. */
function addScript(src: string, extra: Record<string, string> = {}) {
  const s = document.createElement('script')
  s.async = true
  s.src = src
  for (const [k, v] of Object.entries(extra)) s.setAttribute(k, v)
  document.head.appendChild(s)
}

function loadProviders() {
  if (loaded) return
  loaded = true
  // crossorigin keeps the request in the credentialed/CORS path, which survives Shasta's `Cross-Origin-Embedder-Policy:
  // credentialless` without becoming an opaque credential-less load (better ad fill).
  if (ADSENSE_CLIENT) addScript(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`, { crossorigin: 'anonymous' })
  // data-cfasync="false" is the networks' own instruction: Cloudflare Rocket Loader must leave their tags alone.
  for (const [src, zone] of AD_SCRIPTS) addScript(src, { ...(zone && { 'data-zone': zone }), 'data-cfasync': 'false' })
}

/** True when a provider is configured, this build can run it, and the person has not turned ads off. */
export function adsEnabled(): boolean {
  return AVAILABLE && getSettings().ads
}

/** Fills one AdSense unit. Safe to call before the script arrives (it queues) and more than once per element. */
export function pushAdSense() {
  if (!ADSENSE_CLIENT) return
  try {
    ;(window.adsbygoogle = window.adsbygoogle || []).push({})
  } catch {
    /* the queue rejects a second push into an already-filled unit; harmless */
  }
}

/** Once at startup: loads the providers when allowed, follows the setting from then on. */
export function startAds() {
  if (!AVAILABLE) return
  started = true
  const go = () => {
    if (adsEnabled()) loadProviders()
  }
  // after first paint, and after the offline shell has had a chance to come up
  if (document.readyState === 'complete') setTimeout(go, 1200)
  else addEventListener('load', () => setTimeout(go, 1200), { once: true })
  // turning ads back on later loads the scripts then (never unloading them: harmless either way)
  useSettings.subscribe((s, prev) => {
    if (s.settings.ads !== prev.settings.ads && s.settings.ads) loadProviders()
  })
}

/** True while startAds has run for this build (used only to keep the hook honest in tests). */
export const adsStarted = () => started
/** Banners render only where scripts may run at all (not in tests or the installed app). */
export const adsAvailable = () => AVAILABLE
