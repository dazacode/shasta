// Adverts on Shasta's OWN shell — the new tab, the Store, Watch and an optional bottom bar. Never inside the sites a
// person opens: those frames belong to the site being proxied, and Shasta's own ad blocker (lib/adBlock.ts) already
// strips theirs, so Shasta earns nothing there without injecting into them (it does not).
//
// Two providers, each off unless this build names it at build time:
//  - Google AdSense (VITE_ADSENSE_CLIENT): display units placed by <AdSlot>. Best revenue per visitor, and its hosts
//    (pagead2.googlesyndication.com, doubleclick.net) are the ones school filters least often block — see
//    docs/unblocking.md. Needs a real domain + an approved account + ads.txt (seo.ts emits it).
//  - Monetag (VITE_MONETAG_TAG, or VITE_MONETAG_ZONE): one script that runs passive formats on its own
//    (pop-under, in-page push, vignette). No markup; it appends what it wants. This is the "money while sleeping"
//    layer and has no approval gate. Monetag hands out TWO tag shapes — a per-account delivery URL
//    (`//<your-tag-domain>/5/<zone>`, VITE_MONETAG_TAG) or the shared libtl SDK (`data-zone`/`data-sdk`,
//    VITE_MONETAG_ZONE) — paste whichever the dashboard shows; the tag is DOMAIN-LESS either way, so the same zone
//    runs on every hostname (an ads-front domain can sit in front of other hosts, see CLAUDE.md).
//
// Gated exactly like lib/stats.ts: off in tests and in the installed app (the IWA CSP allows no remote script), off
// when the person turns Settings -> Privacy -> "Show ads" off, and off until the build names a provider. Ad networks
// DO see the visitor's IP and set their own cookies, unlike Shasta's own Umami: the Settings copy and the privacy
// policy say so.
import { getSettings, useSettings } from '@/stores/settingsStore'
import { inInstalledApp } from './shastaApp'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')

/** AdSense publisher id, e.g. `ca-pub-1234567890123456` (`VITE_ADSENSE_CLIENT`). */
export const ADSENSE_CLIENT = str(import.meta.env.VITE_ADSENSE_CLIENT)
/** Default AdSense ad-unit id (`VITE_ADSENSE_SLOT`); a placement may override it. Units may be reused across slots. */
export const ADSENSE_SLOT = str(import.meta.env.VITE_ADSENSE_SLOT)
/** Monetag Multitag zone id (`VITE_MONETAG_ZONE`), its SDK file name and host (overridable for a custom tag). */
const MONETAG_ZONE = str(import.meta.env.VITE_MONETAG_ZONE)
const MONETAG_SDK = str(import.meta.env.VITE_MONETAG_SDK) || `show_${MONETAG_ZONE}`
const MONETAG_SRC = str(import.meta.env.VITE_MONETAG_SRC) || 'https://libtl.com/sdk.js'
/** The exact tag URL from the dashboard (`VITE_MONETAG_TAG`): the classic delivery URL (`//<their-domain>/5/<zone>`,
 *  self-contained) or the Multitag (`https://<their-domain>/88/tag.min.js` + `data-zone`, give VITE_MONETAG_ZONE too). */
const MONETAG_TAG = str(import.meta.env.VITE_MONETAG_TAG)
/** One tag per format (`VITE_MONETAG_SCRIPTS` = `url|zone,url|zone`), each with its own zone: the way to run the
 *  in-page formats without Monetag's Push, which needs their worker at /sw.js (Shasta's own) and so is never used.
 *  Not `#`: an unquoted `#` starts a comment in .env and silently cut the list after its first URL. */
const MONETAG_SCRIPTS = str(import.meta.env.VITE_MONETAG_SCRIPTS)
  .split(',')
  .map((t) => t.trim().split('|'))
  .filter(([src, zone]) => /^https:\/\//.test(src ?? '') && /^\d+$/.test(zone ?? ''))

/** A provider is configured at all. */
export const HAS_ADS = !!ADSENSE_CLIENT || !!MONETAG_TAG || !!MONETAG_ZONE || MONETAG_SCRIPTS.length > 0
/** Display (inline) units are possible — only AdSense does those; Monetag works through side effects alone. */
export const HAS_DISPLAY_ADS = !!ADSENSE_CLIENT

const AVAILABLE = HAS_ADS && import.meta.env.MODE !== 'test' && typeof document !== 'undefined' && !inInstalledApp()

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
  // data-cfasync="false" is Monetag's own instruction: Cloudflare Rocket Loader must leave their tag alone. Harmless
  // where Rocket Loader is off.
  if (MONETAG_TAG) addScript(MONETAG_TAG, { ...(MONETAG_ZONE && { 'data-zone': MONETAG_ZONE }), 'data-cfasync': 'false' })
  else if (MONETAG_ZONE) addScript(MONETAG_SRC, { 'data-zone': MONETAG_ZONE, 'data-sdk': MONETAG_SDK, 'data-cfasync': 'false' })
  for (const [src, zone] of MONETAG_SCRIPTS) addScript(src, { 'data-zone': zone, 'data-cfasync': 'false' })
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
