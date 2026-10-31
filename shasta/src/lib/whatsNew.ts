/** Bump when shasta://whats-new changes enough that everybody should see it again on their next start. */
export const WHATS_NEW_VERSION = '2026-10-31-supporters'
const KEY = 'shasta-whats-new'

/** Opens the welcome/beta page once per WHATS_NEW_VERSION. Skipped under automation so e2e tests start on a plain new tab. */
export function showWhatsNewOnce(open: () => void) {
  if (import.meta.env.MODE === 'test' || navigator.webdriver) return
  try {
    if (localStorage.getItem(KEY) === WHATS_NEW_VERSION) return
    localStorage.setItem(KEY, WHATS_NEW_VERSION)
  } catch {
    return // no storage: showing it on every start would be worse than not at all
  }
  open()
}
