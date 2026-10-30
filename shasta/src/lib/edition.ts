// Shasta Lite: the build hosted on a plain static host with no Shasta server of its own (Base44, `bun run deploy:base44`).
// Browsing uses the full site's Wisp relay (VITE_WISP_URL) and the Store, chat and the other /api features go to the
// full site's backend across origins (lib/appApi.ts, allowed there by APP_ORIGINS, always anonymous). What cannot work
// on such a host stays off: on-device AI (its runtime is left out to fit) and the offline shell (the host rewrites
// index.html). A normal build (VITE_EDITION unset) is never touched.

export const LITE = import.meta.env.VITE_EDITION === 'lite'

/** Where the whole of Shasta lives, and the backend Shasta Lite talks to. */
export const FULL_SITE = 'https://shasta-dtg.pages.dev/'
