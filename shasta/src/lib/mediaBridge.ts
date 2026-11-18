// Hands the front media session to the operating system. A page inside a tab has its own Media Session, but the shell is
// the top-level page the OS talks to: mirroring the front session here is what lets a keyboard's media keys, a Chromebook's
// shelf, a phone's lock screen or a headset's button play, pause and skip it while Shasta (or Shasuta) is in the background.
// It only repeats what the page already said (title, artist, artwork, the actions it supports) and routes the buttons back
// through proxy/mediaWatch.ts, which calls the page's own handlers.
import { bridgeIdentity, pickFront, type MediaActions } from '@/lib/media'
import { useMedia } from '@/stores/mediaStore'
import { useTabs } from '@/stores/tabsStore'
import { tabTitle } from '@/lib/tabModel'
import { mediaAction } from '@/proxy/mediaWatch'

let started = false

const ACTIONS: { os: MediaSessionAction; run: (key: string, d: MediaSessionActionDetails) => void; needs?: keyof MediaActions }[] = [
  { os: 'play', run: (k) => mediaAction(k, 'play') },
  { os: 'pause', run: (k) => mediaAction(k, 'pause') },
  { os: 'previoustrack', run: (k) => mediaAction(k, 'previoustrack'), needs: 'previoustrack' },
  { os: 'nexttrack', run: (k) => mediaAction(k, 'nexttrack'), needs: 'nexttrack' },
  { os: 'seekbackward', run: (k, d) => mediaAction(k, 'seekbackward', d.seekOffset ?? 10) },
  { os: 'seekforward', run: (k, d) => mediaAction(k, 'seekforward', d.seekOffset ?? 10) },
  { os: 'seekto', run: (k, d) => d.seekTime != null && mediaAction(k, 'seekto', d.seekTime), needs: 'seekto' },
]

/** Starts mirroring. Safe to call twice; does nothing where there is no Media Session API. */
export function startMediaBridge() {
  if (started || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  started = true
  const ms = navigator.mediaSession
  let identity = ''
  let key = ''
  let state: MediaSessionPlaybackState = 'none'

  const sync = () => {
    const all = Object.values(useMedia.getState().byTab).flat()
    const front = pickFront(all, performance.now())
    const title = front ? front.title || tabTitleOf(front.tabId) : ''
    const id = bridgeIdentity(front, title)
    key = front?.key ?? ''
    const next: MediaSessionPlaybackState = !front ? 'none' : front.playing ? 'playing' : 'paused'
    if (next !== state) {
      state = next
      try {
        ms.playbackState = next
      } catch {
        /* ignore */
      }
    }
    if (id === identity) return
    identity = id
    try {
      if (!front) {
        ms.metadata = null
        for (const a of ACTIONS) ms.setActionHandler(a.os, null)
        return
      }
      ms.metadata = new MediaMetadata({ title, artist: front.artist, album: front.album, artwork: front.artwork ? [{ src: front.artwork }] : [] })
      for (const a of ACTIONS) {
        const on = !a.needs || front.actions[a.needs]
        ms.setActionHandler(a.os, on ? (d) => a.run(key, d) : null)
      }
    } catch {
      /* a browser that refuses some action names */
    }
  }
  useMedia.subscribe(sync)
  sync()
}

function tabTitleOf(tabId: string): string {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId)
  return tab ? tabTitle(tab) : ''
}
