// Shasta Lite: the build hosted on a plain static host with no Shasta server of its own (Base44, `bun run deploy:base44`).
// Browsing uses the full site's Wisp relay (VITE_WISP_URL) and the Store, chat and the other /api features go to the
// full site's backend across origins (lib/appApi.ts, allowed there by APP_ORIGINS, always anonymous). What cannot work
// on such a host stays off: on-device AI (its runtime is left out to fit) and the offline shell (the host rewrites
// index.html). Cross-origin isolation comes from the service worker instead of headers (below, public/sw.js).
// A normal build (VITE_EDITION unset) is never touched.

export const LITE = import.meta.env.VITE_EDITION === 'lite'

/** Where the whole of Shasta lives, and the backend Shasta Lite talks to. */
export const FULL_SITE = 'https://shasta-dtg.pages.dev/'

// The first Lite build (2026-10-29, a few hours) had no backend and saved "Trending now", search predictions and
// usage counters as OFF; they work in Lite now, so a browser saved by that build gets them back, once. Runs before the
// settings store reads localStorage (appApi.ts imports this module first). Anything changed after that is left alone.
const RESTORED = 'shasta-lite-restored-v1'

if (LITE && typeof localStorage !== 'undefined') {
  try {
    if (!localStorage.getItem(RESTORED)) {
      const raw = localStorage.getItem('shasta-settings')
      const saved = raw ? (JSON.parse(raw) as { state?: { settings?: Record<string, unknown> } }) : null
      const settings = saved?.state?.settings
      if (settings) {
        Object.assign(settings, { newTabLive: true, searchSuggestions: true, usageStats: true })
        localStorage.setItem('shasta-settings', JSON.stringify(saved))
      }
      localStorage.setItem(RESTORED, '1')
    }
  } catch {
    /* storage blocked or unreadable: the defaults apply */
  }
}

// Isolation comes from the service worker in Lite (public/sw.js), so the very first page load, before the worker runs,
// is not isolated: reload once when the worker takes over. The flag stops a loop where it cannot work (an old browser,
// a hard reload that skips the worker) and is cleared once a load is isolated, so a later worker update may reload again.
const RELOADED = 'shasta-lite-isolation-reload'

function reloadForIsolation() {
  try {
    if (sessionStorage.getItem(RELOADED)) return
    sessionStorage.setItem(RELOADED, '1')
  } catch {
    return
  }
  location.reload()
}

if (LITE && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (window.crossOriginIsolated) {
    try {
      sessionStorage.removeItem(RELOADED)
    } catch {
      /* storage blocked: nothing to clear */
    }
  } else {
    navigator.serviceWorker.addEventListener('controllerchange', reloadForIsolation)
    if (navigator.serviceWorker.controller) reloadForIsolation()
  }
}
