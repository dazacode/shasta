// Pure model of the media hub (components/browser/MediaHub.tsx): what is playing in each tab, which one to show,
// and where its playhead is right now. No DOM, so it is unit-testable (tests/media.test.ts).

import { serviceForHost } from './musicServices'

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

/** How long a paused session stays the "front" one (the island still offers its play button): ten minutes. */
export const FRONT_PAUSED_MS = 10 * 60_000

/**
 * The session the now-playing island shows: whatever is playing (the newest play if several), else the one that played last
 * if that was recent. `now` is performance.now(), the clock `lastPlayed` uses.
 */
export function pickFront(list: readonly MediaInfo[], now: number): MediaInfo | null {
  const playing = list.filter((m) => m.playing)
  if (playing.length) return [...playing].sort((a, b) => b.lastPlayed - a.lastPlayed)[0]
  const recent = list.filter((m) => m.lastPlayed > 0 && now - m.lastPlayed < FRONT_PAUSED_MS)
  return [...recent].sort((a, b) => b.lastPlayed - a.lastPlayed)[0] ?? null
}

/** What the OS is told about a session: nothing that changes every second, so it is only re-sent when the track or the actions change. */
export function bridgeIdentity(m: MediaInfo | null, title: string): string {
  if (!m) return ''
  return [m.key, title, m.artist, m.album, m.artwork ?? '', m.actions.previoustrack, m.actions.nexttrack, m.actions.seekto].join('\u0000')
}


// ---- music or video? --------------------------------------------------------------------------------------------------------
// An element's tag is not the answer: YouTube Music plays its songs (and the music videos mixed into its playlists) in a <video>,
// with a picture. The people playing it are listening, so for music sites everything is music, and a "video" that carries an album
// is a track whatever site it is on. Anything else with a picture is a video (Shasuta sends those back to the browser).

/** Sites where whatever plays is music, even in a <video> (the list is lib/musicServices.ts). A host matches itself and its subdomains. */
export const isMusicHost = (host: string): boolean => serviceForHost(host) !== null

/** What a session is, given what its element is and where it plays. */
export function classifyKind(raw: MediaInfo['kind'], ctx: { host: string; album: string }): MediaInfo['kind'] {
  if (raw === 'audio') return 'audio'
  if (isMusicHost(ctx.host)) return 'audio'
  if (ctx.album.trim()) return 'audio'
  return 'video'
}

/**
 * One session per tab: a page that swaps between elements (YouTube Music hands a song and its video to different elements) is one
 * player, so its newest session stands for the tab. Playing first, then the newest.
 */
export function onePerTab(list: readonly MediaInfo[]): MediaInfo[] {
  const best = new Map<string, MediaInfo>()
  for (const m of list) {
    const cur = best.get(m.tabId)
    if (!cur || Number(m.playing) > Number(cur.playing) || (m.playing === cur.playing && m.lastPlayed > cur.lastPlayed)) best.set(m.tabId, m)
  }
  return orderSessions([...best.values()])
}
