// The desktop's "what I'm playing" reporter (docs/social-plan.md "Desktop", docs/social-protocol.md "Live socket").
// Only ever a Store app id: the active tab's `tab.app.id` while that tab is inside the app (never a URL, title, domain
// or a site that is not a Store app), and only while this computer is signed in AND the person turned "what I'm
// playing" on. Debounced (a quick tab flick sends nothing), and null once the window has been hidden for 2 minutes
// or no Store app is in front. A private tab never counts. The server checks the id is published and fans it out to
// friends only; nothing is stored.
import type { Tab } from '@/lib/tabModel'
import { inAppScope, tabUrl } from '@/lib/tabModel'

const APP_ID = /^[A-Za-z0-9_-]{1,80}$/

/** The Store app a tab is showing right now, or null (no app, out of the app's scope, a private tab). Pure. */
export function storeAppIdOf(tab: Tab | null | undefined): string | null {
  if (!tab?.app || tab.private) return null
  if (!inAppScope(tab.app, tabUrl(tab))) return null
  return APP_ID.test(tab.app.id) ? tab.app.id : null
}

/** The most recently used tab that shows a Store app (for the link bundle's "the game you're playing"), or null. */
export function recentStoreAppId(tabs: readonly Tab[]): string | null {
  let best: { id: string; at: number } | null = null
  for (const t of tabs) {
    const id = storeAppIdOf(t)
    if (id && (!best || t.lastActiveAt > best.at)) best = { id, at: t.lastActiveAt }
  }
  return best?.id ?? null
}

/** What the reporter reads and where it sends; the real wiring is startPresenceReporter, tests pass fakes. */
export interface PresenceSources {
  /** the Store app id in the foreground, or null */
  foreground(): string | null
  /** signed in and "what I'm playing" is on */
  enabled(): boolean
  hidden(): boolean
  /** called with a function to run whenever any of the above may have changed; returns the unsubscribe */
  watch(changed: () => void): () => void
  /** the live socket (re)opened: what was sent before may be gone, so the current value goes again */
  onReconnect(fn: () => void): () => void
  report(appId: string | null): void
}

export interface PresenceTiming {
  /** wait this long after the last change before reporting (default 5 s) */
  debounceMs?: number
  /** hidden this long = not playing (default 2 min) */
  hiddenMs?: number
}

/** Starts reporting; returns the stop function. */
export function createPresenceReporter(src: PresenceSources, { debounceMs = 5000, hiddenMs = 120_000 }: PresenceTiming = {}): () => void {
  // undefined = nothing sent yet (or the socket came back): the next value always goes
  let sent: string | null | undefined
  let pending: { value: string | null; timer: ReturnType<typeof setTimeout> } | null = null
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined
  let hiddenLong = false
  let wasHidden = src.hidden()

  const cancel = () => {
    if (pending) clearTimeout(pending.timer)
    pending = null
  }
  const desired = () => (hiddenLong ? null : src.foreground())

  const changed = () => {
    // the window going away (or coming back) starts or stops the 2-minute clock
    const hidden = src.hidden()
    if (hidden !== wasHidden) {
      wasHidden = hidden
      clearTimeout(hiddenTimer)
      if (hidden)
        hiddenTimer = setTimeout(() => {
          hiddenLong = true
          changed()
        }, hiddenMs)
      else hiddenLong = false
    }
    if (!src.enabled()) {
      // off or signed out: say nothing at all; turning it back on reports afresh
      cancel()
      sent = undefined
      return
    }
    const value = desired()
    if (pending?.value === value) return // already on its way
    cancel()
    if (value === sent) return // back to what friends already see (a quick flick away and back)
    pending = {
      value,
      timer: setTimeout(() => {
        pending = null
        if (!src.enabled()) return
        const now = desired()
        if (now !== value) return changed()
        sent = value
        src.report(value)
      }, debounceMs),
    }
  }

  const unwatch = src.watch(changed)
  const unreconnect = src.onReconnect(() => {
    sent = undefined
    changed()
  })
  changed()

  return () => {
    unwatch()
    unreconnect()
    cancel()
    clearTimeout(hiddenTimer)
  }
}

let stopReal: (() => void) | null = null

/** The real thing: the tabs store, the social store and the page's visibility. Once per window; idempotent. */
export async function startPresenceReporter(): Promise<() => void> {
  if (stopReal) return stopReal
  const [{ useTabs }, { useSocial }] = await Promise.all([import('@/stores/tabsStore'), import('./store')])
  const activeTab = () => {
    const s = useTabs.getState()
    return s.tabs.find((t) => t.id === s.activeId)
  }
  const stop = createPresenceReporter({
    foreground: () => storeAppIdOf(activeTab()),
    enabled: () => {
      const s = useSocial.getState()
      return s.status === 'ready' && !!s.me?.settings.presence
    },
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    watch(changed) {
      const offTabs = useTabs.subscribe(changed)
      const offSocial = useSocial.subscribe((s, p) => {
        if (s.status !== p.status || s.me?.settings.presence !== p.me?.settings.presence) changed()
      })
      document.addEventListener('visibilitychange', changed)
      return () => {
        offTabs()
        offSocial()
        document.removeEventListener('visibilitychange', changed)
      }
    },
    onReconnect: (fn) =>
      useSocial.subscribe((s, p) => {
        if (s.live === 'open' && p.live !== 'open') fn()
      }),
    report: (appId) => useSocial.getState().reportPresence(appId),
  })
  stopReal = () => {
    stop()
    stopReal = null
  }
  return stopReal
}
