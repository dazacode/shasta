// Shasta social on the desktop, started once per window from App.tsx (lazily: none of it is needed for the first
// paint). It signs this computer back in if it was linked, keeps the toolbar's Friends badge current, runs the
// "what I'm playing" reporter (social/presenceReporter.ts: Store app ids only, and only when the person turned it on)
// and opens games sent from the phone ("Play on Chromebook") through the same path the Store uses.
import { SOCIAL_AVAILABLE } from '@/social/origin'
import { onLaunch, useSocial } from '@/social/store'
import { startPresenceReporter } from '@/social/presenceReporter'
import type { ShowcaseApp } from '@/social/types'
import { useSocialBadge } from './socialBadge'
import { useStore } from '@/store/storeStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'

const APP_ID = /^[A-Za-z0-9_-]{1,80}$/
/** two launches closer than this are one tap (or someone hammering the button): the second is ignored */
const LAUNCH_GAP_MS = 2500

let started = false
let lastLaunch = { id: '', at: 0 }

/** "Play on Chromebook": the phone picked a game; open it here and say where it came from. Exported for tests. */
export async function receiveLaunch(app: ShowcaseApp, now = Date.now()): Promise<void> {
  if (!app || typeof app.appId !== 'string' || !APP_ID.test(app.appId)) return
  if (app.appId === lastLaunch.id && now - lastLaunch.at < LAUNCH_GAP_MS) return
  lastLaunch = { id: app.appId, at: now }
  const name = typeof app.name === 'string' && app.name.trim() ? app.name.trim().slice(0, 60) : 'a game'
  // the Store's own launch (storeStore.launch): the newest published version, its controls, a toast on failure
  await useStore.getState().launch(app.appId)
  const s = useTabs.getState()
  const front = s.tabs.find((t) => t.id === s.activeId)
  if (front?.app?.id === app.appId) useUi.getState().toast(`Opened from your phone: ${name}`, { tone: 'success' })
}

export function startSocialDesktop(): void {
  if (started || !SOCIAL_AVAILABLE) return
  started = true
  const mirror = () => {
    const s = useSocial.getState()
    const signedIn = s.status === 'ready'
    const next = { signedIn, unread: signedIn ? s.unread : 0, requests: signedIn ? s.requests.length : 0 }
    const cur = useSocialBadge.getState()
    if (cur.signedIn !== next.signedIn || cur.unread !== next.unread || cur.requests !== next.requests) useSocialBadge.setState(next)
  }
  useSocial.subscribe(mirror)
  mirror()
  onLaunch((app) => void receiveLaunch(app))
  void startPresenceReporter()
  void useSocial.getState().start()
}
