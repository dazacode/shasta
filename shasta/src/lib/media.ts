// Pure model of the media hub (components/browser/MediaHub.tsx): what is playing in each tab, which one to show,
// and where its playhead is right now. No DOM, so it is unit-testable (tests/media.test.ts).

/** The actions a page registered with navigator.mediaSession (or that Shasta can do on the element itself). */
export interface MediaActions {
  previoustrack: boolean
  nexttrack: boolean
  seekbackward: boolean
  seekforward: boolean
  seekto: boolean
}

export interface MediaInfo {
  tabId: string
  /** one per media element; stable while the element lives */
  key: string
  kind: 'video' | 'audio'
  /** from navigator.mediaSession.metadata when the page sets it, else '' (the UI falls back to the tab) */
  title: string
  artist: string
  album: string
  /** a URL the shell can load (already sent through the proxy), or null */
  artwork: string | null
  playing: boolean
  /** seconds, as of `at` */
  position: number
  /** seconds; Infinity for a live stream, 0 when unknown */
  duration: number
  rate: number
  /** performance.now() when `position` was read */
  at: number
  muted: boolean
  volume: number
  actions: MediaActions
  /** performance.now() of the last play; the newest playing session is the one in front */
  lastPlayed: number
}

export const NO_ACTIONS: MediaActions = { previoustrack: false, nexttrack: false, seekbackward: false, seekforward: false, seekto: false }

/** Where the playhead is at `now`, moving with the clock while playing (no polling needed for a smooth bar). */
export function positionAt(m: Pick<MediaInfo, 'position' | 'duration' | 'rate' | 'at' | 'playing'>, now: number): number {
  if (!m.playing || !Number.isFinite(m.duration)) return m.position
  const p = m.position + ((now - m.at) / 1000) * (m.rate || 1)
  return m.duration > 0 ? Math.min(Math.max(p, 0), m.duration) : Math.max(p, 0)
}

export const isLive = (m: Pick<MediaInfo, 'duration'>) => m.duration === Infinity

/** 0:07, 3:25, 1:02:09 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * Should an element count as "something playing", like a browser's media controls decide? Short clips (UI sounds)
 * and muted autoplay previews (feeds, hover previews) do not; anything that has been audible once does, so muting it
 * from the hub keeps it listed.
 */
export function isWorthShowing(e: { duration: number; everAudible: boolean; hasMetadata: boolean }): boolean {
  if (e.hasMetadata) return true
  if (!e.everAudible) return false
  return e.duration === Infinity || e.duration >= 3 || Number.isNaN(e.duration)
}

/** Sessions in the order the hub lists them: playing first (newest play first), then paused (newest first). */
export function orderSessions(list: readonly MediaInfo[]): MediaInfo[] {
  return [...list].sort((a, b) => Number(b.playing) - Number(a.playing) || b.lastPlayed - a.lastPlayed)
}

/** The one session a tab shows (its newest play). */
export function primaryOf(list: readonly MediaInfo[]): MediaInfo | null {
  return orderSessions(list)[0] ?? null
}

/** The biggest artwork entry (MediaImage `sizes` is "96x96", "512x512 256x256" or "any"). */
export function pickArtwork(images: readonly { src: string; sizes?: string }[]): string | null {
  let best: string | null = null
  let bestArea = -1
  for (const img of images) {
    if (!img?.src) continue
    const sizes = (img.sizes ?? '').toLowerCase()
    let area = 0
    if (sizes.includes('any')) area = Number.MAX_SAFE_INTEGER
    else
      for (const s of sizes.split(/\s+/)) {
        const m = /^(\d+)x(\d+)$/.exec(s)
        if (m) area = Math.max(area, Number(m[1]) * Number(m[2]))
      }
    if (area > bestArea) {
      best = img.src
      bestArea = area
    }
  }
  return best
}

/**
 * What the "Now playing" banner announces: the front session's track, once per track. Only a playing session the
 * page described (a title from navigator.mediaSession) is announced; pausing, seeking and resuming the same track
 * are not news. Returns the identity of the track, or null when there is nothing to announce.
 */
export function trackIdentity(m: Pick<MediaInfo, 'key' | 'title' | 'artist' | 'playing'> | null): string | null {
  if (!m || !m.playing || !m.title) return null
  return `${m.title}\u0000${m.artist}`
}

/**
 * A tab's title as the name of what it plays, for pages that never describe their media (Bandcamp, Jamendo):
 * without the play-state glyph some sites put in front ("▶ Sweden | C418") and a notification count ("(3) ...").
 */
export function pageTitleAsTrack(title: string): string {
  return title.replace(/^\s*(?:[▶►⏵⏸❚▮|]+\s*)+/u, '').replace(/^\(\d+\+?\)\s*/, '').trim()
}
