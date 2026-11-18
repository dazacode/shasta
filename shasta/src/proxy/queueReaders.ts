// Reads a page's own playlist ("Up next") from its document, for the player screen's queue. The Media Session API never exposes the
// queue (only "previous" and "next"), so this is the one place that knows a site's markup, on purpose and kept small: each reader
// recognises one player by the elements only it has and returns what the page itself lists. A page no reader knows gives null and
// the player falls back to a history of what was played. Reading only: nothing here clicks, and skipping goes through the page's
// own next and previous actions (shasuta/queue.ts).
//
// The readers take a Document (a proxied frame's, same-origin with the shell) so they can be tested against fixtures.

export interface QueueItem {
  title: string
  artist: string
  /** an address the shell can load (the frame already loaded it through the proxy), or null */
  art: string | null
  current: boolean
}

export interface QueueRead {
  items: QueueItem[]
  /** index of the one playing, -1 when the page does not say */
  current: number
  /** which reader understood the page (for the notes and the tests) */
  reader: string
}

const text = (el: Element | null | undefined): string => (el?.getAttribute('title') || el?.textContent || '').replace(/\s+/g, ' ').trim()
const artOf = (img: HTMLImageElement | null | undefined): string | null => {
  const src = img?.currentSrc || img?.getAttribute('src') || ''
  if (!src || src.startsWith('about:')) return null
  // a lazy-loading page shows a 1x1 placeholder until the real picture arrives: that is no picture
  if (src.startsWith('data:') && src.length < 400) return null
  return src
}

/** The same song twice in a row (YouTube Music lists a song and its video side by side) is one entry. */
export function dedupe(items: QueueItem[]): QueueItem[] {
  const out: QueueItem[] = []
  for (const it of items) {
    const prev = out[out.length - 1]
    if (prev && prev.title === it.title && prev.artist === it.artist) {
      if (it.current) prev.current = true
      continue
    }
    out.push({ ...it })
  }
  return out
}

function finish(items: QueueItem[], reader: string): QueueRead | null {
  const list = dedupe(items.filter((i) => i.title))
  if (list.length < 1) return null
  return { items: list, current: list.findIndex((i) => i.current), reader }
}

/** YouTube Music: `ytmusic-player-queue-item`; a song and its video counterpart share a wrapper, and only the first is the entry. */
function youtubeMusic(doc: Document): QueueRead | null {
  const els = [...doc.querySelectorAll('ytmusic-player-queue-item')].filter((el) => !el.closest('#counterpart-renderer'))
  if (!els.length) return null
  return finish(
    els.map((el) => ({
      title: text(el.querySelector('.song-title')),
      artist: text(el.querySelector('.byline')),
      art: artOf(el.querySelector('img')),
      current: el.hasAttribute('selected') || el.getAttribute('play-button-state') === 'playing' || el.getAttribute('play-button-state') === 'paused',
    })),
    'youtube-music',
  )
}

/** YouTube: the playlist panel beside the video. */
function youtube(doc: Document): QueueRead | null {
  const els = [...doc.querySelectorAll('ytd-playlist-panel-video-renderer')]
  if (!els.length) return null
  return finish(
    els.map((el) => ({
      title: text(el.querySelector('#video-title')),
      artist: text(el.querySelector('#byline')),
      art: artOf(el.querySelector('img')),
      current: el.hasAttribute('selected'),
    })),
    'youtube',
  )
}

const READERS = [youtubeMusic, youtube]

/** What the page lists as its queue, or null when no reader recognises it (or it has nothing). Never throws. */
export function readQueue(doc: Document): QueueRead | null {
  for (const reader of READERS) {
    try {
      const r = reader(doc)
      if (r) return r
    } catch {
      /* a page in the middle of changing */
    }
  }
  return null
}

// Adverts the page itself marks (the same markers Last.fm's Web Scrobbler uses for these two sites). Other services name their
// adverts in the media session title instead (shasuta/musicNotes.ts `AD_TITLE`).
const AD_MARKERS = ['ytmusic-player-bar.advertisement', '.ytmusic-player-bar.advertisement', '.Tuner__Audio__TrackDetail__title--ad']

/** True while the page shows one of its own advert markers. Never throws. */
export function adShowing(doc: Document): boolean {
  try {
    return AD_MARKERS.some((s) => !!doc.querySelector(s))
  } catch {
    return false
  }
}

// ---- the browser's own playlist, when a page publishes one -----------------------------------------------------------------
// WebKit's MediaSessionCoordinator explainer proposes `navigator.mediaSession.playlist`: a list of MediaMetadata-like items, so a site can
// tell the browser what plays next. No site or browser is known to ship it yet, so this does nothing until one does; then every site that
// does gets a real "Up next" with no per-site code. Checked FIRST, since the page itself is the authority on its own queue.

interface PlaylistItem {
  title?: unknown
  artist?: unknown
  artwork?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The page's published playlist, or null (not supported, empty, malformed). `now` is the session's current title and artist, used to
 * find which entry is playing (the proposal does not say). Cover art is only kept when it is inline (data:/blob:): an address on the
 * service's own host would be loaded outside the proxy.
 */
export function readSessionPlaylist(win: Window, now: { title: string; artist: string }): QueueRead | null {
  try {
    const list = (win.navigator.mediaSession as unknown as { playlist?: unknown } | undefined)?.playlist
    if (!list || typeof list !== 'object' || typeof (list as { length?: unknown }).length !== 'number') return null
    const raw = Array.from(list as ArrayLike<PlaylistItem>).slice(0, 200)
    const items: QueueItem[] = []
    for (const p of raw) {
      const title = str(p?.title)
      if (!title) continue
      const images = Array.isArray(p?.artwork) ? (p.artwork as { src?: unknown }[]) : []
      const art = images.map((i) => str(i?.src)).find((s) => s.startsWith('data:') || s.startsWith('blob:')) ?? null
      items.push({ title, artist: str(p?.artist), art, current: false })
    }
    if (!items.length) return null
    const t = norm(now.title)
    const a = norm(now.artist)
    const current = t ? items.findIndex((i) => norm(i.title) === t && (!a || !i.artist || norm(i.artist) === a)) : -1
    if (current >= 0) items[current].current = true
    return { items, current, reader: 'media-session' }
  } catch {
    return null
  }
}

/** What a tab's page lists as its queue: its published playlist, else a reader that knows its markup, else null. */
export function readPageQueue(win: Window, now: { title: string; artist: string }): QueueRead | null {
  return readSessionPlaylist(win, now) ?? readQueue(win.document)
}
