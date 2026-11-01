/** Bump when shasta://whats-new changes enough that everybody should see it again on their next start. */
export const WHATS_NEW_VERSION = '2026-11-01-cloud'
const KEY = 'shasta-whats-new'

/** True when this browser had never seen What's new before this start: it then opens with a Welcome slide. */
export let firstVisit = false

/** Opens the welcome/beta page once per WHATS_NEW_VERSION. Skipped under automation so e2e tests start on a plain new tab. */
export function showWhatsNewOnce(open: () => void) {
  if (import.meta.env.MODE === 'test' || navigator.webdriver) return
  try {
    const seen = localStorage.getItem(KEY)
    if (seen === WHATS_NEW_VERSION) return
    firstVisit = seen === null
    localStorage.setItem(KEY, WHATS_NEW_VERSION)
  } catch {
    return // no storage: showing it on every start would be worse than not at all
  }
  open()
}
