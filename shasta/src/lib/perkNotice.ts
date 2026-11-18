// Runs lib/perkNoticeCore.ts: reads the supporter store and settings, and shows each notice once per device.
import { getSettings } from '@/stores/settingsStore'
import { useSupporterStore } from '@/stores/supporterStore'
import { keptThings, noticeBody, noticeFor, noticeTitle, type PerkFacts } from '@/lib/perkNoticeCore'

export { keptThings, noticeBody, noticeTitle } from '@/lib/perkNoticeCore'

// ---- running it ----------------------------------------------------------------------------------------------------------
const SEEN = 'shasta-perk-notices'

function seen(key: string): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[]
    if (list.includes(key)) return true
    localStorage.setItem(SEEN, JSON.stringify([...list, key].slice(-20)))
    return false
  } catch {
    return true // no storage: never nag on every start
  }
}

/** The facts from the supporter store and settings. */
export function currentFacts(): PerkFacts {
  const s = useSupporterStore.getState()
  const settings = getSettings()
  const pass = s.status === 'trial' || s.status === 'supporter'
  return {
    code: !!settings.supporter,
    pass,
    kind: pass ? (s.status as 'trial' | 'supporter') : null,
    until: s.until,
    codeEnded: s.note === 'ended',
    tourExp: settings.tourPass?.exp ?? 0,
  }
}

/** The notice to show in Settings right now (null when there is nothing to say). */
export const currentNotice = () => (useSupporterStore.getState().checked ? noticeFor(currentFacts()) : null)

let started = false
/**
 * Shows each notice once: a toast with "What happens" (opens Settings -> Supporter), and the same line as a window event
 * (`shasta-perk-notice`) that Shasuta turns into one of its notifications. `show` is the toast (injected: lib/ has no UI).
 */
export function startPerkNotices(show: (title: string) => void) {
  if (started) return
  started = true
  const check = () => {
    const n = currentNotice()
    if (!n || seen(n.key)) return
    const title = noticeTitle(n)
    show(title)
    dispatchEvent(new CustomEvent('shasta-perk-notice', { detail: { title, body: noticeBody(n, keptThings(getSettings())) } }))
  }
  useSupporterStore.subscribe((s, prev) => {
    if (s.checked && (s.status !== prev.status || s.tourUntil !== prev.tourUntil || s.note !== prev.note || s.checked !== prev.checked)) check()
  })
  setInterval(check, 5 * 60_000)
  check()
}
