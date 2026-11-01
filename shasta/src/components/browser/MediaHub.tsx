// The toolbar's media hub, like a browser's global media controls: it appears when any tab plays something and
// lists every tab's media with its real metadata (the page's navigator.mediaSession, else the tab), a live preview
// for video, a seek bar that follows the playhead in real time, and play/pause, ±10 s, previous/next track (when the
// page offers them), mute and picture-in-picture. Data: proxy/mediaWatch.ts -> stores/mediaStore.ts.
// When a new track starts, a "Now playing" banner drops from the hub's button with its metadata, then tucks back in.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AudioLines, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Favicon } from './Favicon'
import { useMedia } from '@/stores/mediaStore'
import { useTabs } from '@/stores/tabsStore'
import { tabTitle, tabUrl } from '@/lib/tabModel'
import { hostOf, isInternalUrl } from '@/lib/url'
import { formatTime, isLive, orderSessions, pageTitleAsTrack, positionAt, trackIdentity, type MediaInfo } from '@/lib/media'
import { useUi } from '@/stores/uiStore'
import { dismissMedia, mediaAction, mediaElement, setMediaMuted, togglePictureInPicture } from '@/proxy/mediaWatch'
import { cn } from '@/lib/utils'

/** performance.now(), re-rendered every animation frame while `on` (the seek bar follows the playhead smoothly) */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!on) return
    let raf = 0
    const tick = () => {
      setNow(performance.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [on])
  // only read while playing; a paused or live session ignores the clock (lib/media.ts positionAt)
  return now
}

export function MediaHub() {
  const byTab = useMedia((s) => s.byTab)
  const [open, setOpen] = useState(false)
  const tabs = useTabs((s) => s.tabs)
  // a page that never describes its media (no mediaSession title) is named after its tab
  const sessions = useMemo(
    () =>
      orderSessions(Object.values(byTab).flat()).map((m) => {
        if (m.title) return m
        const tab = tabs.find((t) => t.id === m.tabId)
        return { ...m, title: tab ? pageTitleAsTrack(tabTitle(tab)) : '' }
      }),
    [byTab, tabs],
  )
  const anchor = useRef<HTMLDivElement>(null)
  const announced = useNowPlaying(sessions[0] ?? null, open)
  if (!sessions.length) return null
  const playing = sessions.some((m) => m.playing)
  const front = sessions[0]
  const label = playing ? `Playing: ${front.title || 'media'}` : 'Media controls'
  const banner = announced.key ? sessions.find((m) => m.key === announced.key) : undefined

  return (
    <div ref={anchor} className="shrink-0">
    <NowPlaying
      m={banner}
      anchor={anchor}
      onOpen={() => {
        announced.hide()
        setOpen(true)
      }}
      onClose={announced.hide}
      onHold={announced.hold}
    />
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label={label}
              className={cn(
                'relative grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-150 ease-shasta hover:bg-shasta-hover',
                playing ? 'text-shasta-accent' : 'text-shasta-muted hover:text-shasta-fg',
                open && 'bg-shasta-hover',
              )}
            />
          }
        >
          <AudioLines className="size-[18px]" strokeWidth={1.6} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[22rem] p-1.5">
        <div className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto">
          {sessions.map((m) => (
            <MediaCard key={m.key} m={m} onPick={() => setOpen(false)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
    </div>
  )
}

const BANNER_MS = 5000

/**
 * Which session the "Now playing" banner shows: the front one, each time a new track starts (lib/media.ts
 * trackIdentity), for a few seconds; held open while the pointer is on it. Never while the hub itself is open,
 * in game mode or in fullscreen (a banner over a game or a film is in the way).
 */
function useNowPlaying(front: MediaInfo | null, hubOpen: boolean) {
  const [key, setKey] = useState<string | null>(null)
  const last = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const id = trackIdentity(front)
  const frontKey = front?.key ?? null

  const arm = () => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setKey(null), BANNER_MS)
  }
  useEffect(() => {
    if (!id || id === last.current) return
    last.current = id
    if (hubOpen || useUi.getState().gameMode || document.fullscreenElement) return
    setKey(frontKey)
    arm()
  }, [id, frontKey, hubOpen])
  useEffect(() => {
    if (hubOpen) setKey(null)
  }, [hubOpen])
  useEffect(() => {
    return () => {
      clearTimeout(timer.current)
    }
  }, [])

  return {
    key,
    hide: () => {
      clearTimeout(timer.current)
      setKey(null)
    },
    /** true while the pointer rests on the banner (it stays), false when it leaves (the countdown starts again) */
    hold: (on: boolean) => {
      if (on) clearTimeout(timer.current)
      else arm()
    },
  }
}

function NowPlaying({ m, anchor, onOpen, onClose, onHold }: { m: MediaInfo | undefined; anchor: React.RefObject<HTMLDivElement | null>; onOpen: () => void; onClose: () => void; onHold: (on: boolean) => void }) {
  const tab = useTabs((s) => (m ? s.tabs.find((t) => t.id === m.tabId) : undefined))
  const rect = m ? anchor.current?.getBoundingClientRect() : undefined
  const show = !!(m && tab && rect)
  let body: React.ReactNode = null
  if (show) {
    const url = tabUrl(tab)
    const source = tab.app?.name ?? (isInternalUrl(url) ? 'Shasta' : hostOf(url))
    const subtitle = [m.artist, m.album].filter(Boolean).join(' · ') || source
    body = (
      <motion.div
        key={m.key + m.title}
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: -12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        style={{ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right - 8), transformOrigin: 'top right' }}
        onPointerEnter={() => onHold(true)}
        onPointerLeave={() => onHold(false)}
        className="fixed z-[70] w-80 rounded-xl bg-popover p-2.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      >
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left" aria-label={`Now playing: ${m.title}, ${subtitle}. Open media controls`}>
          <motion.div
            initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 20, delay: 0.06 }}
            className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-shasta-hover"
          >
            {m.artwork ? <img src={m.artwork} alt="" className="size-full object-cover" /> : <Favicon url={url} appIcon={tab.app?.iconUrl} className="size-6" />}
          </motion.div>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[11px] text-shasta-accent">
              <Bars playing={m.playing} />
              Now playing
            </span>
            <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1, duration: 0.25 }} className="block truncate text-sm font-medium" title={m.title}>
              {m.title}
            </motion.span>
            <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.16, duration: 0.25 }} className="block truncate text-xs text-shasta-muted" title={subtitle}>
              {subtitle}
            </motion.span>
          </span>
        </button>
        <button type="button" aria-label="Hide" onClick={onClose} className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
          <X className="size-3.5" />
        </button>
      </motion.div>
    )
  }
  return createPortal(<AnimatePresence>{body}</AnimatePresence>, document.body)
}

/** Three little level bars that bounce while it plays (still with reduced motion: MotionConfig skips transforms). */
function Bars({ playing }: { playing: boolean }) {
  return (
    <span className="flex h-2.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-[2px] origin-bottom rounded-full bg-current"
          style={{ height: '100%' }}
          animate={playing ? { scaleY: [0.35, 1, 0.5, 0.85, 0.35] } : { scaleY: 0.35 }}
          transition={playing ? { duration: 0.9 + i * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 } : { duration: 0.2 }}
        />
      ))}
    </span>
  )
}

function CtlButton({ label, onClick, disabled, children, big }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; big?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid shrink-0 place-items-center rounded-full transition-colors duration-150 ease-shasta disabled:pointer-events-none disabled:opacity-30',
        big ? 'size-10 bg-shasta-fg text-shasta-bg hover:opacity-90' : 'size-8 text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg',
      )}
    >
      {children}
    </button>
  )
}

function MediaCard({ m, onPick }: { m: MediaInfo; onPick: () => void }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === m.tabId))
  const now = useNow(m.playing && !isLive(m))
  const [scrub, setScrub] = useState<number | null>(null)
  if (!tab) return null
  const url = tabUrl(tab)
  const source = tab.app?.name ?? (isInternalUrl(url) ? 'Shasta' : hostOf(url))
  const title = m.title || tabTitle(tab) || source
  const subtitle = [m.artist, m.album].filter(Boolean).join(' · ') || source
  const live = isLive(m)
  const position = scrub ?? positionAt(m, now)
  const canSeek = m.actions.seekto && m.duration > 0
  const commit = () => {
    if (scrub != null) mediaAction(m.key, 'seekto', scrub)
    setScrub(null)
  }
  const goToTab = () => {
    useTabs.getState().selectTab(m.tabId)
    onPick()
  }

  return (
    <article className="rounded-lg bg-shasta-raised p-2.5" aria-label={`${title}, ${m.playing ? 'playing' : 'paused'}`}>
      <header className="mb-2 flex items-center gap-2 text-xs text-shasta-muted">
        <button type="button" onClick={goToTab} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left hover:text-shasta-fg" title="Go to this tab">
          <Favicon url={url} appIcon={tab.app?.iconUrl} className="size-3.5" />
          <span className="truncate">{source}</span>
        </button>
        <button type="button" aria-label="Stop and hide" title="Stop and hide" onClick={() => dismissMedia(m.key)} className="grid size-6 place-items-center rounded-md hover:bg-shasta-hover hover:text-shasta-fg">
          <X className="size-3.5" />
        </button>
      </header>

      {m.kind === 'video' && <VideoPreview m={m} onClick={goToTab} />}

      <div className="flex items-center gap-3">
        {m.kind === 'audio' && (
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-shasta-hover">
            {m.artwork ? <img src={m.artwork} alt="" className="size-full object-cover" /> : <Favicon url={url} appIcon={tab.app?.iconUrl} className="size-6" />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-shasta-fg" title={title}>{title}</p>
          <p className="truncate text-xs text-shasta-muted" title={subtitle}>{subtitle}</p>
        </div>
      </div>

      <div className="mt-2.5">
        {live ? (
          <p className="flex items-center gap-1.5 text-xs text-shasta-muted">
            <span className="size-1.5 rounded-full bg-shasta-danger" /> Live
          </p>
        ) : (
          <>
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={m.duration || 0}
              step={0.1}
              value={Math.min(position, m.duration || 0)}
              disabled={!canSeek}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
              className="h-1 w-full cursor-pointer accent-shasta-accent disabled:cursor-default"
            />
            <div className="home-fig mt-1 flex justify-between text-[11px] text-shasta-muted">
              <span>{formatTime(position)}</span>
              <span>{m.duration ? `-${formatTime(Math.max(0, m.duration - position))}` : '--:--'}</span>
            </div>
          </>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <CtlButton label={m.muted ? 'Unmute' : 'Mute'} onClick={() => setMediaMuted(m.key, !m.muted)}>
            {m.muted || m.volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </CtlButton>
        </div>
        <div className="flex items-center gap-0.5">
          {m.actions.previoustrack && (
            <CtlButton label="Previous track" onClick={() => mediaAction(m.key, 'previoustrack')}>
              <SkipBack className="size-4" />
            </CtlButton>
          )}
          <CtlButton label="Back 10 seconds" disabled={!m.actions.seekbackward} onClick={() => mediaAction(m.key, 'seekbackward')}>
            <RotateCcw className="size-4" />
          </CtlButton>
          <CtlButton big label={m.playing ? 'Pause' : 'Play'} onClick={() => mediaAction(m.key, m.playing ? 'pause' : 'play')}>
            {m.playing ? <Pause className="size-4.5 fill-current" /> : <Play className="ml-0.5 size-4.5 fill-current" />}
          </CtlButton>
          <CtlButton label="Forward 10 seconds" disabled={!m.actions.seekforward} onClick={() => mediaAction(m.key, 'seekforward')}>
            <RotateCw className="size-4" />
          </CtlButton>
          {m.actions.nexttrack && (
            <CtlButton label="Next track" onClick={() => mediaAction(m.key, 'nexttrack')}>
              <SkipForward className="size-4" />
            </CtlButton>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <CtlButton label="Picture in picture" disabled={m.kind !== 'video' || !document.pictureInPictureEnabled} onClick={() => void togglePictureInPicture(m.key)}>
            <PictureInPicture2 className="size-4" />
          </CtlButton>
        </div>
      </div>
    </article>
  )
}

/**
 * The video itself, drawn live into a canvas while the hub is open (the element stays in its page; this only paints
 * its current frame). Protected video (DRM) paints black, so it shows the artwork instead.
 */
function VideoPreview({ m, onClick }: { m: MediaInfo; onClick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const el = mediaElement(m.key) as HTMLVideoElement | null
  const protectedVideo = !!el?.mediaKeys
  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !el || protectedVideo) return
    let raf = 0
    let last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      // ~30 fps is plenty for a preview; paused video only needs its frame once
      if (t - last < 33) return
      last = t
      const vw = el.videoWidth
      const vh = el.videoHeight
      if (!vw || !vh) return
      const scale = Math.min(c.width / vw, c.height / vh)
      const w = vw * scale
      const h = vh * scale
      try {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, c.width, c.height)
        ctx.drawImage(el, (c.width - w) / 2, (c.height - h) / 2, w, h)
      } catch {
        /* not drawable right now */
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [el, protectedVideo])

  return (
    <button type="button" onClick={onClick} title="Go to this tab" className="mb-2.5 block aspect-video w-full overflow-hidden rounded-md bg-black">
      {protectedVideo || !el ? (
        m.artwork ? <img src={m.artwork} alt="" className="size-full object-cover" /> : null
      ) : (
        <canvas ref={canvas} width={640} height={360} className="size-full" />
      )}
    </button>
  )
}
