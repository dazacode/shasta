// The installed Shasta app (an Isolated Web App, built by `bun run build:iwa`): where to get it and when to suggest it.
// The app browses with no relay server and runs every site (docs/on-device-wisp.md). Chrome only.

const httpsUrl = (v: unknown) => (typeof v === 'string' && /^https:\/\/\S+$/i.test(v.trim()) ? v.trim() : '')

/** The signed bundle (.swbn) people download; empty = the build has none to offer yet. */
export const APP_BUNDLE_URL = httpsUrl(import.meta.env.VITE_APP_BUNDLE_URL)
/** The update manifest an administrator gives Chrome policy (IsolatedWebAppInstallForceList); empty = not published. */
export const APP_UPDATE_MANIFEST_URL = httpsUrl(import.meta.env.VITE_APP_UPDATE_MANIFEST_URL)

/** This page is the installed app. */
export const inInstalledApp = (): boolean => location.protocol === 'isolated-app:'

/** A Chromium-based browser (Chrome, Edge, Brave...): the only ones that can run the app. */
export function isChromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands
  return !!brands?.some((b) => /Chromium/i.test(b.brand))
}

/** Worth mentioning the app: not already in it, and in a browser that can run it. */
export const shouldSuggestApp = (): boolean => !inInstalledApp() && isChromium()
