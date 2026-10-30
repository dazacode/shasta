// The Watch player. One component for every source kind: HLS (hls.js), DASH (dash.js), plain mp4, and proxied
// embeds. It owns the whole control surface — play/seek/volume/speed, quality, audio tracks, subtitles, fullscreen,
// picture-in-picture, keyboard, resume and source switching — and moves to the next source on a fatal error.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  ChevronLeft, Gauge, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw,
  Settings, SkipForward, Subtitles, Volume2, VolumeX, Zap,
} from 'lucide-react'
import type Hls from 'hls.js'
import * as proxy from '@/proxy/scramjetAdapter'
import { apiUrl, streamUrl } from './api'
import type { Candidate } from './types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settingsStore'

type Menu = 'none' | 'source' | 'quality' | 'speed' | 'audio' | 'subs'
interface Track { label: string; lang: string }

export interface PlayerProps {
  candidate: Candidate
  candidates: Candidate[]
  title: string
  sub?: string
  poster?: string | null
  startAt?: number
  nextLabel?: string
  onPickSource: (c: Candidate) => void
  onProgress?: (position: number, duration: number) => void
  onEnded?: () => void
  onNext?: () => void
  onClose?: () => void
  onFailed?: (c: Candidate) => void
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** The embed path: a real player page, run through Shasta's proxy so its ads are stripped and its host stays hidden.
 *  It reports a proxied load failure (the proxy writes a shasta-error marker into the frame) so the player can move on. */
function EmbedView({ url, title, nonce, direct, onFail, frameRef }: { url: string; title: string; nonce: number; direct: boolean; onFail: (msg: string) => void; frameRef: RefObject<HTMLIFrameElement | null> }) {
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    if (direct || !proxy.isReady()) {
      el.src = url
      return
    }
    const id = proxy.proxySubFrame(el, url)
    return () => proxy.releaseSubFrame(id)
  }, [url, nonce, direct])
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    let done = false
    const check = () => {
      if (done) return
      try {
        const meta = el.contentDocument?.querySelector<HTMLMetaElement>('meta[name="shasta-error"]')
        if (meta?.content) {
          done = true
          onFail(meta.content)
        }
      } catch {
        /* not same-origin yet: the load event will come again */
      }
    }
    const onLoad = () => window.setTimeout(check, 250)
    el.addEventListener('load', onLoad)
    const t = window.setTimeout(check, 15_000) // an embed that never finishes loading
    return () => {
      el.removeEventListener('load', onLoad)
      clearTimeout(t)
    }
  }, [url, nonce, onFail])
  return (
    <iframe ref={frameRef} title={title} className="size-full border-0 bg-black" allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write" />
  )
}

export function Player(props: PlayerProps) {
  const { candidate, title, sub, poster, startAt = 0, candidates } = props
  const proxyVideo = useSettings((s) => s.settings.watchProxy)
  const updateSettings = useSettings((s) => s.update)
  // callbacks live in a ref so changing them never tears down the media engine
  const cb = useRef(props)
  cb.current = props

  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const hls = useRef<Hls | null>(null)
  const dash = useRef<{ reset: () => void } | null>(null)
  const hideTimer = useRef<number | null>(null)
  const errored = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(startAt)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [waiting, setWaiting] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<Menu>('none')
  const [shown, setShown] = useState(true)
  const [levels, setLevels] = useState<{ label: string; index: number }[]>([])
  const [level, setLevel] = useState(-1)
  const [audio, setAudio] = useState<Track[]>([])
  const [audioOn, setAudioOn] = useState(0)
  const [hlsSubs, setHlsSubs] = useState<Track[]>([])
  const [subOn, setSubOn] = useState(-1)
  const [error, setError] = useState('')
  const [embedNonce, setEmbedNonce] = useState(0)

  const isEmbed = candidate.kind === 'embed'
  // a direct scrape of a CORS-less host (vidsrc.buzz) always goes through our proxy, even when "direct" mode is on
  const mustProxy = proxyVideo || !!candidate.forceProxy
  const extSubs = useMemo(() => candidate.subtitles ?? [], [candidate])
  const src = useMemo(
    () => (isEmbed ? candidate.url : apiUrl(mustProxy ? streamUrl(candidate.url, candidate.referer) : candidate.url)),
    [isEmbed, candidate.url, candidate.referer, mustProxy],
  )
  const subSrc = useCallback((u: string) => apiUrl(mustProxy ? streamUrl(u, candidate.referer) : u), [candidate.referer, mustProxy])

  const wake = useCallback(() => {
    setShown(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShown(false), 2600)
  }, [])

  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  // a new source (or a manual retry) clears the previous failure
  useEffect(() => {
    errored.current = false
    setError('')
  }, [candidate.id, embedNonce])

  // an embed that fails (the proxy writes a shasta-error marker) surfaces it and hops to the next source
  const onEmbedFail = useCallback(
    (msg: string) => {
      if (errored.current) return
      errored.current = true
      setError(msg || 'This source failed to load.')
      if (candidates.length <= 1) return
      const id = candidate.id
      window.setTimeout(() => {
        if (errored.current && cb.current.candidate.id === id) cb.current.onFailed?.(candidate)
      }, 1400)
    },
    [candidates.length, candidate],
  )

  // ---- set up the media engine when the source changes ----
  useEffect(() => {
    if (isEmbed) return
    const el = video.current
    if (!el) return
    errored.current = false
    setError('')
    setLevels([])
    setAudio([])
    setHlsSubs([])
    setSubOn(-1)
    setWaiting(true)

    const fail = (msg: string) => {
      if (errored.current) return
      errored.current = true
      setError(msg)
      cb.current.onFailed?.(candidate)
    }
    let cancelled = false

    void (async () => {
      if (candidate.kind === 'hls') {
        const mod = await import('hls.js').catch(() => null)
        if (cancelled) return
        if (!mod) return fail('Could not load the player.')
        const H = mod.default
        if (H.isSupported()) {
          const h = new H({ enableWorker: true, backBufferLength: 90, maxBufferLength: 45, maxMaxBufferLength: 120, capLevelToPlayerSize: true, abrEwmaDefaultEstimate: 1_000_000 })
          hls.current = h
          h.attachMedia(el)
          h.on(H.Events.MEDIA_ATTACHED, () => h.loadSource(src))
          h.on(H.Events.MANIFEST_PARSED, (_e, d) => {
            setLevels(d.levels.map((l, i) => ({ index: i, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)}k` })))
            setAudio((h.audioTracks ?? []).map((t) => ({ label: t.name || t.lang || 'Audio', lang: t.lang || '' })))
            setAudioOn(h.audioTrack)
            setWaiting(false)
          })
          h.on(H.Events.AUDIO_TRACKS_UPDATED, () => {
            setAudio((h.audioTracks ?? []).map((t) => ({ label: t.name || t.lang || 'Audio', lang: t.lang || '' })))
            setAudioOn(h.audioTrack)
          })
          h.on(H.Events.SUBTITLE_TRACKS_UPDATED, () => {
            setHlsSubs((h.subtitleTracks ?? []).map((t) => ({ label: t.name || t.lang || 'Subtitles', lang: t.lang || '' })))
          })
          h.on(H.Events.LEVEL_SWITCHED, (_e, d) => setLevel(h.autoLevelEnabled ? -1 : d.level))
          h.on(H.Events.ERROR, (_e, data) => {
            if (!data.fatal) return
            if (data.type === H.ErrorTypes.NETWORK_ERROR) h.startLoad()
            else if (data.type === H.ErrorTypes.MEDIA_ERROR) h.recoverMediaError()
            else fail('This source stopped working.')
          })
        } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
          el.src = src
        } else {
          fail('HLS is not supported in this browser.')
        }
      } else if (candidate.kind === 'dash') {
        const mod = await import('dashjs').catch(() => null)
        if (cancelled) return
        if (!mod) return fail('Could not load the player.')
        const p = mod.MediaPlayer().create()
        dash.current = p as unknown as { reset: () => void }
        p.initialize(el, src, false)
        setWaiting(false)
      } else {
        el.src = src
        setWaiting(false)
      }
    })()

    return () => {
      cancelled = true
      hls.current?.destroy()
      hls.current = null
      dash.current?.reset()
      dash.current = null
    }
  }, [src, candidate, isEmbed])

  useEffect(() => {
    const el = video.current
    if (!el || isEmbed || !startAt) return
    const seek = () => {
      if (el.duration && startAt < el.duration - 5) el.currentTime = startAt
      el.removeEventListener('loadedmetadata', seek)
    }
    el.addEventListener('loadedmetadata', seek)
    return () => el.removeEventListener('loadedmetadata', seek)
  }, [startAt, isEmbed])

  useEffect(() => { if (video.current) video.current.playbackRate = rate }, [rate])
  useEffect(() => {
    if (video.current) {
      video.current.volume = volume
      video.current.muted = muted
    }
    if (embedVideoRef.current) {
      embedVideoRef.current.volume = volume
      embedVideoRef.current.muted = muted
    }
  }, [volume, muted])

  // external subtitles (hls tracks are handled through hls.subtitleTrack)
  useEffect(() => {
    const el = video.current
    if (el) {
      const tt = el.textTracks
      for (let i = 0; i < tt.length; i++) tt[i].mode = subOn >= 1000 && i === subOn - 1000 ? 'showing' : 'disabled'
    }
    const h = hls.current
    if (h) {
      const onHls = subOn >= 0 && subOn < 1000
      h.subtitleDisplay = onHls
      h.subtitleTrack = onHls ? subOn : -1
    }
  }, [subOn, hlsSubs, extSubs])

  // ---- media element events (subscribe once per element) ----
  useEffect(() => {
    const el = video.current
    if (!el) return
    const onTime = () => setTime(el.currentTime)
    const onDur = () => setDuration(el.duration || 0)
    const onProg = () => { const b = el.buffered; if (b.length) setBuffered(b.end(b.length - 1)) }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onWait = () => setWaiting(true)
    const onCan = () => setWaiting(false)
    const onEnd = () => cb.current.onEnded?.()
    // a source that stalls before anything plays is worse than a dead one: advance after 12s
    let stall = 0
    const clearStall = () => clearTimeout(stall)
    const onStall = () => {
      clearStall()
      if (el.currentTime > 0.5) return
      stall = window.setTimeout(() => {
        if (errored.current || cb.current.candidates.length <= 1) return
        errored.current = true
        setError('Buffering — trying another source…')
        cb.current.onFailed?.(candidate)
      }, 12_000)
    }
    const onErr = () => {
      if (!el.error?.code) return
      setError('This source could not be played.')
      cb.current.onFailed?.(candidate)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('durationchange', onDur)
    el.addEventListener('progress', onProg)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWait)
    el.addEventListener('playing', onCan)
    el.addEventListener('canplay', onCan)
    el.addEventListener('ended', onEnd)
    el.addEventListener('error', onErr)
    // start as soon as it can play (a card click is a user gesture, so unmuted autoplay is allowed)
    const onFirstCanPlay = () => {
      el.removeEventListener('canplay', onFirstCanPlay)
      void el.play().catch(() => undefined)
    }
    el.addEventListener('canplay', onFirstCanPlay)
    el.addEventListener('waiting', onStall)
    el.addEventListener('stalled', onStall)
    el.addEventListener('playing', clearStall)
    el.addEventListener('canplay', clearStall)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('durationchange', onDur)
      el.removeEventListener('progress', onProg)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('waiting', onWait)
      el.removeEventListener('playing', onCan)
      el.removeEventListener('canplay', onCan)
      el.removeEventListener('ended', onEnd)
      el.removeEventListener('error', onErr)
      el.removeEventListener('canplay', onFirstCanPlay)
      el.removeEventListener('waiting', onStall)
      el.removeEventListener('stalled', onStall)
      el.removeEventListener('playing', clearStall)
      el.removeEventListener('canplay', clearStall)
      clearStall()
    }
  }, [isEmbed, candidate])

  // progress persistence (throttled)
  useEffect(() => {
    const t = window.setInterval(() => {
      const el = video.current
      if (el && !el.paused && el.duration) cb.current.onProgress?.(el.currentTime, el.duration)
    }, 5000)
    return () => clearInterval(t)
  }, [])

  const toggle = useCallback(() => {
    const el = video.current ?? embedVideoRef.current
    if (!el) return
    // a muted player is the #1 confusion: the first click/tap unmutes instead of doing nothing
    if (el.muted || el.volume === 0) {
      el.muted = false
      if (el.volume === 0) el.volume = 1
      setMuted(false)
      setVolume(1)
      if (el.paused) void el.play().catch(() => undefined)
      return
    }
    if (el.paused) void el.play().catch(() => cb.current.onFailed?.(candidate))
    else el.pause()
  }, [candidate])

  const seek = useCallback((to: number) => {
    const el = video.current ?? embedVideoRef.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(to, el.duration || 0))
    setTime(el.currentTime)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.current?.requestFullscreen().catch(() => undefined)
  }, [])

  const pip = () => {
    const el = video.current
    if (!el) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void el.requestPictureInPicture().catch(() => undefined)
  }

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (isEmbed) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag && /input|textarea/i.test(tag)) return
      const k = e.key.toLowerCase()
      if (k === ' ' || k === 'k') { e.preventDefault(); toggle() }
      else if (k === 'arrowright') { e.preventDefault(); seek((video.current?.currentTime ?? 0) + 10) }
      else if (k === 'arrowleft') { e.preventDefault(); seek((video.current?.currentTime ?? 0) - 10) }
      else if (k === 'arrowup') { e.preventDefault(); setVolume((v) => Math.min(1, v + 0.05)) }
      else if (k === 'arrowdown') { e.preventDefault(); setVolume((v) => Math.max(0, v - 0.05)) }
      else if (k === 'm') setMuted((m) => !m)
      else if (k === 'f') toggleFullscreen()
      else if (k === 'n') cb.current.onNext?.()
      wake()
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [toggle, seek, toggleFullscreen, wake, isEmbed])

  const menuBtn = (active = false) =>
    cn('grid size-10 shrink-0 place-items-center rounded-lg text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] transition hover:bg-white/20', active && 'bg-white/20')
  const item = 'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-white/10'

  const subChoices = [
    { label: 'Off', value: -1 },
    ...hlsSubs.map((t, i) => ({ label: t.lang ? `${t.label} (${t.lang})` : t.label, value: i })),
    ...extSubs.map((t, i) => ({ label: t.lang ? `${t.label} (${t.lang})` : t.label, value: 1000 + i })),
  ]

  // An embed's own <video>: proxied Scramjet frames are same-origin, so we can drive its play/mute.
  const embedFrame = useRef<HTMLIFrameElement | null>(null)
  const embedVideoRef = useRef<HTMLVideoElement | null>(null)
  const [embedPlaying, setEmbedPlaying] = useState(false)
  const [embedTime, setEmbedTime] = useState(0)
  const [embedDur, setEmbedDur] = useState(0)
  // the embed's own frame swallows key events, so our shortcuts are bound inside its document too
  const actions = useRef({ toggle: () => {}, nudge: (_: number) => {}, mute: () => {}, fullscreen: () => {} })
  const keysBound = useRef(new WeakSet<Document>())

  useEffect(() => {
    if (!isEmbed) {
      embedVideoRef.current = null
      return
    }
    const find = (doc: Document | null | undefined, depth = 0): HTMLVideoElement | null => {
      if (!doc || depth > 4) return null
      const v = doc.querySelector('video')
      if (v) return v
      for (const f of Array.from(doc.querySelectorAll('iframe'))) {
        try {
          const hit = find(f.contentDocument, depth + 1)
          if (hit) return hit
        } catch {
          /* a nested cross-origin frame in direct mode */
        }
      }
      return null
    }
    const attachKeys = (doc: Document) => {
      if (keysBound.current.has(doc)) return
      keysBound.current.add(doc)
      doc.addEventListener('keydown', (ev: KeyboardEvent) => {
        const k = ev.key.toLowerCase()
        if (k === ' ' || k === 'k') { ev.preventDefault(); actions.current.toggle() }
        else if (k === 'arrowright') { ev.preventDefault(); actions.current.nudge(10) }
        else if (k === 'arrowleft') { ev.preventDefault(); actions.current.nudge(-10) }
        else if (k === 'm') actions.current.mute()
        else if (k === 'f') actions.current.fullscreen()
      })
    }
    const tick = () => {
      try {
        const doc = embedFrame.current?.contentDocument
        if (doc) attachKeys(doc)
        const v = find(doc)
        if (!v) return
        if (embedVideoRef.current !== v) {
          embedVideoRef.current = v
          v.volume = 1
          v.muted = false // embeds often autoplay muted; unmute so audio just works
          setMuted(false)
          void v.play().catch(() => undefined)
        }
        setEmbedPlaying(!v.paused)
        setEmbedTime(v.currentTime || 0)
        setEmbedDur(Number.isFinite(v.duration) ? v.duration : 0)
      } catch {
        /* ignore */
      }
    }
    const t = window.setInterval(tick, 1200)
    tick()
    return () => clearInterval(t)
  }, [isEmbed, candidate.id])

  const curPlaying = isEmbed ? embedPlaying : playing
  const curTime = isEmbed ? embedTime : time
  const curDur = isEmbed ? embedDur : duration
  const curBuffered = isEmbed ? embedDur : buffered
  actions.current = {
    toggle,
    nudge: (d: number) => {
      const el = video.current ?? embedVideoRef.current
      if (el) seek(el.currentTime + d)
    },
    mute: () => setMuted((m) => !m),
    fullscreen: toggleFullscreen,
  }

  const proxyToggle = (
    <button
      className={menuBtn(proxyVideo)}
      onClick={() => updateSettings({ watchProxy: !proxyVideo })}
      title={proxyVideo ? 'Playing through Shasta (survives a school filter). Click to go direct — faster.' : 'Playing directly (fast). Click to go through Shasta — survives a school filter.'}
      aria-label={proxyVideo ? 'Switch to direct playback' : 'Switch to proxied playback'}
    >
      <Zap className="size-5" />
    </button>
  )

  return (
    <div ref={box} tabIndex={0} onMouseMove={wake} onFocus={wake} className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black outline-none">
      {isEmbed ? (
        <EmbedView url={src} title={title} nonce={embedNonce} direct={!proxyVideo} onFail={onEmbedFail} frameRef={embedFrame} />
      ) : (
        <video ref={video} poster={poster ?? undefined} crossOrigin="anonymous" playsInline preload="auto" className="size-full bg-black" onClick={toggle} onDoubleClick={toggleFullscreen}>
          {extSubs.map((t, i) => (
            <track key={`${t.url}-${i}`} kind="subtitles" src={subSrc(t.url)} srcLang={t.lang || 'und'} label={t.label} />
          ))}
        </video>
      )}

      {!isEmbed && waiting && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="size-10 animate-spin text-white/80" /></div>}
      {!isEmbed && !playing && !waiting && !error && (
        <button onClick={toggle} aria-label="Play" className="absolute inset-0 grid place-items-center">
          <span className="grid size-16 place-items-center rounded-full bg-black/50 backdrop-blur transition hover:scale-105"><Play className="size-7 translate-x-0.5 fill-white text-white" /></span>
        </button>
      )}
      {!isEmbed && muted && playing && !error && (
        <button onClick={() => setMuted(false)} className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur transition hover:bg-black/85">
          <VolumeX className="size-4" /> Tap to unmute
        </button>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center">
          <div>
            <p className="text-sm text-white/90">{error}{candidates.length > 1 ? <span className="text-white/60"> Trying another source…</span> : null}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => { errored.current = false; setError(''); if (isEmbed) setEmbedNonce((n) => n + 1); else { video.current?.load(); void video.current?.play().catch(() => undefined) } }} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25"><RotateCcw className="mr-1 inline size-4" /> Retry</button>
              {candidates.length > 1 && <button onClick={() => setMenu('source')} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25">Try another source</button>}
            </div>
          </div>
        </div>
      )}

      {/* top bar */}
      <div className={cn('absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 transition-opacity', shown || !playing ? 'opacity-100' : 'opacity-0')}>
        <div className="flex min-w-0 items-center gap-2">
          {cb.current.onClose && <button className={menuBtn()} onClick={() => cb.current.onClose?.()} aria-label="Back"><ChevronLeft className="size-5" /></button>}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white drop-shadow">{title}</p>
            {sub && <p className="truncate text-xs text-white/70">{sub}</p>}
          </div>
        </div>
        {cb.current.onNext && (
          <button className="flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white hover:bg-white/20" onClick={() => cb.current.onNext?.()}>
            {cb.current.nextLabel ?? 'Next'} <SkipForward className="size-3.5" />
          </button>
        )}
      </div>

      {/* bottom bar */}
      <div className={cn('absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-3 pb-3 pt-20 transition-opacity duration-200', isEmbed ? 'opacity-100' : shown || !playing || waiting ? 'opacity-100' : 'opacity-0')}>
        <div className="relative mb-1 h-1.5 w-full cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * (curDur || 0)) }}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${curDur ? (curBuffered / curDur) * 100 : 0}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-shasta-accent" style={{ width: `${curDur ? (curTime / curDur) * 100 : 0}%` }} />
          <div className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-shasta-accent shadow" style={{ left: `calc(${curDur ? (curTime / curDur) * 100 : 0}% - 6px)` }} />
        </div>
        <div className="flex items-center gap-1 text-white">
          <button className={menuBtn()} onClick={toggle} aria-label={curPlaying ? 'Pause' : 'Play'}>{curPlaying ? <Pause className="size-5 fill-white" /> : <Play className="size-5 fill-white" />}</button>
          <div className="group/vol flex items-center">
            <button className={menuBtn()} onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}</button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false) }} className="h-1.5 w-0 cursor-pointer accent-shasta-accent transition-all group-hover/vol:w-24 sm:w-24" aria-label="Volume" />
          </div>
          <span className="ml-1 text-xs tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">{fmt(curTime)} <span className="text-white/60">/ {fmt(curDur)}</span></span>
          <div className="ml-auto flex items-center gap-1">
            {!isEmbed && audio.length > 1 && <button className={menuBtn(menu === 'audio')} onClick={() => setMenu(menu === 'audio' ? 'none' : 'audio')} title="Audio" aria-label="Audio track"><Settings className="size-5" /></button>}
            {!isEmbed && subChoices.length > 1 && <button className={menuBtn(menu === 'subs' || subOn >= 0)} onClick={() => setMenu(menu === 'subs' ? 'none' : 'subs')} title="Subtitles" aria-label="Subtitles"><Subtitles className="size-5" /></button>}
            {!isEmbed && <button className={menuBtn(menu === 'speed')} onClick={() => setMenu(menu === 'speed' ? 'none' : 'speed')} title="Speed" aria-label="Speed"><Gauge className="size-5" /></button>}
            {!isEmbed && <button className={menuBtn(menu === 'quality')} onClick={() => setMenu(menu === 'quality' ? 'none' : 'quality')} title="Quality" aria-label="Quality"><span className="text-xs font-semibold">{level < 0 ? 'Auto' : levels.find((l) => l.index === level)?.label ?? 'Auto'}</span></button>}
            {proxyToggle}
            {candidates.length > 1 && <button className={menuBtn(menu === 'source')} onClick={() => setMenu(menu === 'source' ? 'none' : 'source')} title="Source" aria-label="Source"><Settings className="size-5" /></button>}
            {!isEmbed && <button className={menuBtn()} onClick={pip} title="Picture in picture" aria-label="Picture in picture"><PictureInPicture2 className="size-5" /></button>}
            <button className={menuBtn()} onClick={toggleFullscreen} aria-label="Full screen">{fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}</button>
          </div>
        </div>

        {menu !== 'none' && (
          <div className="absolute bottom-12 right-3 max-h-[60%] w-64 overflow-auto rounded-xl border border-white/10 bg-[#16181d]/95 p-1.5 text-white shadow-2xl backdrop-blur">
            {menu === 'source' && (
              <>
                <p className="px-2 py-1 text-xs text-white/50">Source</p>
                {candidates.map((c) => (
                  <button key={c.id} className={item} onClick={() => { cb.current.onPickSource(c); setMenu('none') }}>
                    <span className="truncate">{c.label}{c.audio ? ` · ${c.audio.join(', ')}` : ''}{c.note ? ` — ${c.note}` : ''}</span>
                    {c.id === candidate.id && <span className="text-shasta-accent">●</span>}
                  </button>
                ))}
              </>
            )}
            {menu === 'quality' && (
              <>
                <button className={item} onClick={() => { if (hls.current) hls.current.currentLevel = -1; setLevel(-1) }}><span>Auto</span>{level < 0 && <span className="text-shasta-accent">●</span>}</button>
                {levels.map((l) => (
                  <button key={l.index} className={item} onClick={() => { if (hls.current) hls.current.currentLevel = l.index; setLevel(l.index) }}><span>{l.label}</span>{level === l.index && <span className="text-shasta-accent">●</span>}</button>
                ))}
                {!levels.length && <p className="px-2 py-1 text-xs text-white/50">Single quality</p>}
              </>
            )}
            {menu === 'audio' && audio.map((t, i) => (
              <button key={i} className={item} onClick={() => { if (hls.current) hls.current.audioTrack = i; setAudioOn(i) }}><span>{t.label}{t.lang ? ` (${t.lang})` : ''}</span>{audioOn === i && <span className="text-shasta-accent">●</span>}</button>
            ))}
            {menu === 'subs' && subChoices.map((c) => (
              <button key={c.value} className={item} onClick={() => setSubOn(c.value)}><span>{c.label}</span>{subOn === c.value && <span className="text-shasta-accent">●</span>}</button>
            ))}
            {menu === 'speed' && RATES.map((r) => (
              <button key={r} className={item} onClick={() => { setRate(r); setMenu('none') }}><span>{r === 1 ? 'Normal' : `${r}×`}</span>{rate === r && <span className="text-shasta-accent">●</span>}</button>
            ))}
          </div>
        )}

        {isEmbed && <div className="flex justify-end gap-1" />}
      </div>
    </div>
  )
}
