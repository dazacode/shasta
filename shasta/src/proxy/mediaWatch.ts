// Finds what is playing in every proxied frame (and in Shasta's own pages, like Watch) for the media hub.
// Like a browser's global media controls: the page's own navigator.mediaSession gives the title, artist, album,
// artwork and the actions it supports (next/previous track, seek); the <video>/<audio> element gives the real state
// (playing, position, duration, rate, volume). Controls go back through the page's own action handlers when it set
// them (so its UI stays in step), otherwise to the element directly.
//
// Nothing is injected into the page's scripts and nothing leaves the device: this reads the frame from the shell,
// which can, because every proxied document is same-origin with it.
import { NO_ACTIONS, isWorthShowing, pickArtwork, type MediaActions, type MediaInfo } from '@/lib/media'
import { useMedia } from '@/stores/mediaStore'
import { useTabs } from '@/stores/tabsStore'

type Action = keyof MediaActions | 'play' | 'pause'
type ActionHandler = MediaSessionActionHandler | null

interface Handle {
  key: string
  el: HTMLMediaElement
  win: Window
  /** the plugin's tab id; frames inside Shasta pages (Watch embeds) are resolved through the DOM instead */
  hint: string | null
  /** the page's real address for an artwork URL as the frame resolved it (proxied frames resolve against the proxy) */
  art: (src: string) => string | null
  everAudible: boolean
  wasConnected: boolean
  lastPlayed: number
}

interface WindowSession {
  handlers: Map<string, ActionHandler>
}

const handles = new Map<string, Handle>()
const byElement = new WeakMap<HTMLMediaElement, Handle>()
const sessions = new WeakMap<Window, WindowSession>()
const watched = new WeakSet<Window>()
/** detached autoplay elements already listened to */
const listening = new WeakSet<HTMLMediaElement>()
let seq = 0

const sessionOf = (win: Window): WindowSession => {
  let s = sessions.get(win)
  if (!s) sessions.set(win, (s = { handlers: new Map() }))
  return s
}

/** The Shasta tab an element is shown in: climb the frame chain to the shell's DOM, which marks each tab. */
function tabOf(h: Handle): string | null {
  try {
    let node: Element | null = h.el
    let win: Window | null = h.win
    for (let i = 0; i < 12 && win; i++) {
      if (win === window) {
        const marked = (node as Element | null)?.closest?.('[data-media-tab]')
        return marked?.getAttribute('data-media-tab') ?? h.hint
      }
      node = win.frameElement
      win = win.parent === win ? null : win.parent
    }
  } catch {
    /* a cross-origin ancestor: fall back to the plugin's id */
  }
  return h.hint
}

// ---- publishing ---------------------------------------------------------------------------------------------------

const dirty = new Set<string>()
let flushQueued = false
let ticker: number | null = null

function markDirty(tabId: string | null) {
  if (!tabId) return
  dirty.add(tabId)
  if (flushQueued) return
  flushQueued = true
  queueMicrotask(flush)
}

const markHandle = (h: Handle) => markDirty(tabOf(h))

function alive(h: Handle): boolean {
  try {
    if (h.win.closed) return false
    if (h.el.isConnected) h.wasConnected = true
    // removed from the page (a detached `new Audio()` that never was in the DOM is fine)
    else if (h.wasConnected) return false
    return !!(h.el.currentSrc || h.el.srcObject) && !h.el.error
  } catch {
    return false
  }
}

function readMetadata(win: Window) {
  try {
    const md = win.navigator.mediaSession?.metadata
    if (!md) return null
    return { title: md.title || '', artist: md.artist || '', album: md.album || '', artwork: pickArtwork(Array.from(md.artwork ?? [])) }
  } catch {
    return null
  }
}

// Artwork lives on the site's own hosts. The FRAME's fetch goes through the proxy (Scramjet patches it), so the
// picture is fetched there once and shown from a blob: URL in the shell. Memory only; failures fall back to the tab's icon.
const artwork = new Map<string, string | null>()
const MAX_ART = 40

function artworkFor(h: Handle, src: string): string | null {
  const real = h.art(src)
  if (!real) return null
  if (artwork.has(real)) return artwork.get(real) ?? null
  if (real.startsWith('data:') || real.startsWith('blob:')) return real
  artwork.set(real, null)
  if (artwork.size > MAX_ART) {
    const [oldest, url] = artwork.entries().next().value as [string, string | null]
    artwork.delete(oldest)
    if (url) URL.revokeObjectURL(url)
  }
  void (async () => {
    try {
      const res = await h.win.fetch(real, { credentials: 'omit' })
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.startsWith('image/')) return
      const blob = await res.blob()
      if (!artwork.has(real)) return
      artwork.set(real, URL.createObjectURL(blob))
      markHandle(h)
    } catch {
      /* stays null: the hub shows the tab's icon */
    }
  })()
  return null
}

function snapshot(h: Handle, withMetadata: boolean, now: number): MediaInfo | null {
  const el = h.el
  const md = withMetadata ? readMetadata(h.win) : null
  const duration = el.duration
  if (!isWorthShowing({ duration, everAudible: h.everAudible, hasMetadata: !!md && !el.paused })) {
    // a session the page described keeps showing while paused, as long as it was really played
    if (!(md && h.lastPlayed)) return null
  }
  const session = sessions.get(h.win)
  const has = (a: string) => !!session?.handlers.get(a)
  return {
    tabId: '',
    key: h.key,
    kind: el instanceof (h.win as Window & typeof globalThis).HTMLVideoElement && (el as HTMLVideoElement).videoWidth > 0 ? 'video' : 'audio',
    title: md?.title ?? '',
    artist: md?.artist ?? '',
    album: md?.album ?? '',
    artwork: md?.artwork ? artworkFor(h, md.artwork) : null,
    playing: !el.paused && !el.ended,
    position: el.currentTime || 0,
    duration: Number.isNaN(duration) ? 0 : duration,
    rate: el.playbackRate || 1,
    at: now,
    muted: el.muted,
    volume: el.volume,
    actions: {
      ...NO_ACTIONS,
      previoustrack: has('previoustrack'),
      nexttrack: has('nexttrack'),
      // Shasta can always seek the element itself (not a live stream)
      seekbackward: Number.isFinite(duration),
      seekforward: Number.isFinite(duration),
      seekto: Number.isFinite(duration),
    },
    lastPlayed: h.lastPlayed,
  }
}

function flush() {
  flushQueued = false
  const tabs = new Set(useTabs.getState().tabs.map((t) => t.id))
  const now = performance.now()
  // group the live handles by tab; the page's metadata belongs to the newest played element of its window
  const perTab = new Map<string, Handle[]>()
  for (const h of handles.values()) {
    if (!alive(h)) {
      handles.delete(h.key)
      const t = tabOf(h)
      if (t) dirty.add(t)
      continue
    }
    const t = tabOf(h)
    if (!t || !dirty.has(t)) continue
    let list = perTab.get(t)
    if (!list) perTab.set(t, (list = []))
    list.push(h)
  }
  const { setTab } = useMedia.getState()
  for (const tabId of dirty) {
    const list = tabs.has(tabId) ? (perTab.get(tabId) ?? []) : []
    const newestInWindow = new Map<Window, Handle>()
    for (const h of list) {
      const cur = newestInWindow.get(h.win)
      if (!cur || h.lastPlayed > cur.lastPlayed) newestInWindow.set(h.win, h)
    }
    const infos: MediaInfo[] = []
    for (const h of list) {
      const info = snapshot(h, newestInWindow.get(h.win) === h, now)
      if (info) infos.push({ ...info, tabId })
    }
    setTab(tabId, infos)
  }
  dirty.clear()
  syncTicker()
}

/** While anything is listed: re-read every tab now and then (drift, metadata the page edited in place, closed tabs). */
function syncTicker() {
  const any = Object.keys(useMedia.getState().byTab).length > 0 || handles.size > 0
  if (any && ticker === null) {
    ticker = window.setInterval(() => {
      for (const h of handles.values()) markHandle(h)
      for (const t of Object.keys(useMedia.getState().byTab)) markDirty(t)
      if (!handles.size) markDirty('__none__')
    }, 1000)
  } else if (!any && ticker !== null) {
    clearInterval(ticker)
    ticker = null
  }
}

// ---- watching a window --------------------------------------------------------------------------------------------

const EVENTS = ['play', 'playing', 'pause', 'ended', 'seeked', 'ratechange', 'durationchange', 'loadedmetadata', 'volumechange', 'emptied', 'resize'] as const

function track(el: HTMLMediaElement, win: Window, hint: string | null, art: Handle['art']): Handle {
  let h = byElement.get(el)
  if (h) return h
  h = { key: `m${++seq}`, el, win, hint, art, everAudible: false, wasConnected: el.isConnected, lastPlayed: 0 }
  byElement.set(el, h)
  handles.set(h.key, h)
  const handle = h
  const onEvent = (e: Event) => {
    if ((e.type === 'play' || e.type === 'playing') && !el.paused) handle.lastPlayed = performance.now()
    if (!el.paused && !el.muted && el.volume > 0) handle.everAudible = true
    if (e.type === 'emptied' && !el.currentSrc) handles.delete(handle.key)
    else if (!handles.has(handle.key) && (el.currentSrc || el.srcObject)) handles.set(handle.key, handle)
    markHandle(handle)
  }
  for (const type of EVENTS) el.addEventListener(type, onEvent)
  if (!el.paused) {
    h.lastPlayed = performance.now()
    if (!el.muted && el.volume > 0) h.everAudible = true
  }
  return h
}

/**
 * Starts watching `win` (a proxied frame from the plugin's init.post, or the shell itself). `hint` is the tab the
 * frame belongs to; `art` makes a page's artwork address loadable from the shell.
 */
export function applyMediaWatch(win: Window, hint: string | null, art: (src: string) => string | null = (s) => s) {
  if (watched.has(win)) return
  watched.add(win)
  const W = win as Window & typeof globalThis
  // media events do not bubble, but a capture listener on the window sees every element in the document
  const discover = (e: Event) => {
    const el = e.target
    if (el instanceof W.HTMLMediaElement) markHandle(track(el, win, hint, art))
  }
  for (const type of ['play', 'playing', 'loadedmetadata'] as const) win.addEventListener(type, discover, { capture: true })
  // elements that never join the document (`new Audio()`, the usual music player) are found when they start
  try {
    const proto = W.HTMLMediaElement.prototype
    const play = proto.play
    proto.play = function (this: HTMLMediaElement) {
      try {
        markHandle(track(this, win, hint, art))
      } catch {
        /* never break the page's play() */
      }
      return play.call(this)
    }
  } catch {
    /* frozen prototype */
  }
  // ...or that start by themselves: a detached element with `autoplay` (Deezer) never calls play() and its events
  // never reach the window, so listen on the element itself from the moment autoplay is turned on
  try {
    const proto = W.HTMLMediaElement.prototype
    const listen = (el: HTMLMediaElement) => {
      if (listening.has(el)) return
      listening.add(el)
      el.addEventListener('playing', () => markHandle(track(el, win, hint, art)))
    }
    const desc = Object.getOwnPropertyDescriptor(proto, 'autoplay')
    if (desc?.set && desc.get)
      Object.defineProperty(proto, 'autoplay', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(this: HTMLMediaElement, v: boolean) {
          desc.set!.call(this, v)
          try {
            if (v && !this.isConnected) listen(this)
          } catch {
            /* ignore */
          }
        },
      })
    const setAttr = W.Element.prototype.setAttribute
    W.Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
      const r = setAttr.call(this, name, value)
      try {
        if (this instanceof W.HTMLMediaElement && !this.isConnected && String(name).toLowerCase() === 'autoplay') listen(this)
      } catch {
        /* ignore */
      }
      return r
    }
  } catch {
    /* frozen prototype */
  }
  // the page's media session: metadata changes and the actions it handles (there is no getter for handlers)
  try {
    const MS = W.MediaSession?.prototype
    if (MS) {
      const setAction = MS.setActionHandler
      MS.setActionHandler = function (this: MediaSession, action: MediaSessionAction, handler: ActionHandler) {
        sessionOf(win).handlers.set(action, handler)
        for (const h of handles.values()) if (h.win === win) markHandle(h)
        return setAction.call(this, action, handler)
      }
      const desc = Object.getOwnPropertyDescriptor(MS, 'metadata')
      if (desc?.set && desc.get) {
        Object.defineProperty(MS, 'metadata', {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set(this: MediaSession, v: MediaMetadata | null) {
            desc.set!.call(this, v)
            for (const h of handles.values()) if (h.win === win) markHandle(h)
          },
        })
      }
    }
  } catch {
    /* no Media Session API in this browser */
  }
  // the document goes away (navigation): its elements are gone with it
  win.addEventListener('pagehide', () => {
    for (const h of [...handles.values()]) {
      if (h.win !== win) continue
      handles.delete(h.key)
      markHandle(h)
    }
  })
}

// ---- controls -----------------------------------------------------------------------------------------------------

const SKIP_SECONDS = 10

/** The element behind a session, for the hub's live video preview. */
export const mediaElement = (key: string): HTMLMediaElement | null => handles.get(key)?.el ?? null

function callPage(h: Handle, action: string, details: Record<string, unknown> = {}): boolean {
  const fn = sessions.get(h.win)?.handlers.get(action)
  if (!fn) return false
  try {
    fn({ action, ...details } as MediaSessionActionDetails)
    return true
  } catch {
    return false
  }
}

export function mediaAction(key: string, action: Action, value?: number) {
  const h = handles.get(key)
  if (!h) return
  const el = h.el
  // the page's handlers are tied to the page's NEWEST element (its session), not to an older one
  const isSession = [...handles.values()].every((o) => o.win !== h.win || o.lastPlayed <= h.lastPlayed)
  const page = (a: string, d?: Record<string, unknown>) => isSession && callPage(h, a, d)
  switch (action) {
    case 'play':
      if (!page('play')) void el.play().catch(() => {})
      break
    case 'pause':
      if (!page('pause')) el.pause()
      break
    case 'previoustrack':
    case 'nexttrack':
      page(action)
      break
    case 'seekbackward':
    case 'seekforward': {
      const offset = value ?? SKIP_SECONDS
      if (!page(action, { seekOffset: offset })) el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + (action === 'seekforward' ? offset : -offset)))
      break
    }
    case 'seekto':
      if (value == null || !Number.isFinite(value)) return
      if (!page('seekto', { seekTime: value, fastSeek: false })) el.currentTime = value
      break
  }
  markHandle(h)
}

export function setMediaMuted(key: string, muted: boolean) {
  const h = handles.get(key)
  if (!h) return
  const el = h.el
  el.muted = muted
  if (!muted && el.volume === 0) el.volume = 1
  markHandle(h)
}

/** Mutes or unmutes every element of a tab (the speaker icon on a tab). */
export function setTabMuted(tabId: string, muted: boolean) {
  for (const h of handles.values()) if (tabOf(h) === tabId) h.el.muted = muted
}

export async function togglePictureInPicture(key: string) {
  const h = handles.get(key)
  const el = h?.el
  if (!h || !(el instanceof (h.win as Window & typeof globalThis).HTMLVideoElement)) return
  const doc = el.ownerDocument
  try {
    if (doc.pictureInPictureElement === el) await doc.exitPictureInPicture()
    else await (el as HTMLVideoElement).requestPictureInPicture()
  } catch {
    /* the page disabled it (disablePictureInPicture) or no user activation reached the frame */
  }
}

/** Stops it and takes it off the list (like closing a notification). */
export function dismissMedia(key: string) {
  const h = handles.get(key)
  if (!h) return
  try {
    h.el.pause()
  } catch {
    /* ignore */
  }
  h.lastPlayed = 0
  h.everAudible = false
  markHandle(h)
}
