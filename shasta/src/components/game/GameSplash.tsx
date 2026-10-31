// The game launcher: a game:// tab opens on its own splash screen (cover art, name, what is happening, how to control
// it) and only fades into the game once the page really shows one (a canvas, a video/Flash player or a game frame of a
// real size), so nobody stares at a half-built page. Uploaded games (store/AppLauncher.tsx) use the same screen.
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { Check, Flag, Gamepad2, Keyboard, Loader2, Play, RefreshCw, SlidersHorizontal } from 'lucide-react'
import * as proxy from '@/proxy/scramjetAdapter'
import { focusActiveFrame, keysFor } from '@/lib/shortcuts'
import { type Tab } from '@/lib/tabModel'
import { usePads } from '@/lib/gamepad'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/storeStore'
import { openReport } from '@/store/ReportDialog'
import { AppIcon } from '@/store/components'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { openControls } from '@/stores/gameControlsStore'
import { MEDIA_CORS } from '@/lib/appApi'
import { usePhonePads } from '@/lib/phonePad'
import { PhonePadCard } from './PhonePadCard'

export type SplashStage = 'connecting' | 'loading' | 'starting' | 'ready'

const MIN_SHOW_MS = 1200
const FADE_MS = 450
const SLOW_MS = 30_000
const STEPS: [Exclude<SplashStage, 'ready'>, string][] = [
  ['connecting', 'Connecting'],
  ['loading', 'Loading'],
  ['starting', 'Starting'],
]

interface SplashApp {
  id?: string
  name: string
  iconUrl: string | null
  kind: 'package' | 'linked'
}

/** Cover art and maker of an installed app, when the library knows it. */
function useArt(app: SplashApp) {
  const item = useStore((s) => s.library?.installed.find((i) => i.app.id === app.id || i.app.slug === app.id))
  return { banner: item?.app.bannerUrl ?? null, developer: item?.app.developer ?? '', icon: app.iconUrl ?? item?.app.iconUrl ?? null }
}

export function GameSplash({ app, stage, tabId, onDone, onReload }: { app: SplashApp; stage: SplashStage; tabId: string; onDone: () => void; onReload: () => void }) {
  const { banner, developer, icon } = useArt(app)
  const reducedMotion = document.documentElement.dataset.motion === 'reduced'
  const pad = usePads((s) => s.name)
  const shownAt = useRef(Date.now())
  const [leaving, setLeaving] = useState(false)
  const [slow, setSlow] = useState(false)
  const done = useRef(onDone)
  done.current = onDone

  // the person asked for a phone on this screen: wait for it (like Netflix's launch screen) instead of fading out
  const phoneStatus = usePhonePads((s) => s.status)
  const phoneOn = usePhonePads((s) => s.pads.some((p) => p.on))
  const phoneAtStart = useRef(phoneStatus)
  const waitingForPhone = phoneAtStart.current === 'off' && (phoneStatus === 'opening' || phoneStatus === 'open') && !phoneOn

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [])

  // ready: stay a moment (no flash for a game that was cached), then fade into it
  useEffect(() => {
    if (stage !== 'ready' || leaving || waitingForPhone) return
    const t = setTimeout(() => setLeaving(true), Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt.current)))
    return () => clearTimeout(t)
  }, [stage, leaving, waitingForPhone])

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => done.current(), reducedMotion ? 0 : FADE_MS)
    return () => clearTimeout(t)
  }, [leaving, reducedMotion])

  const at = stage === 'ready' ? STEPS.length : STEPS.findIndex(([s]) => s === stage)
  const remappable = app.kind !== 'package'

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${app.name}: ${stage === 'ready' ? 'ready' : STEPS[at]?.[1] ?? ''}`}
      className={cn(
        'absolute inset-0 z-[7] overflow-hidden bg-black text-white transition-[opacity,transform] ease-out',
        reducedMotion ? 'duration-0' : 'duration-[450ms]',
        leaving && 'pointer-events-none scale-[1.04] opacity-0',
      )}
    >
      {/* the cover, blurred into a backdrop */}
      {banner ? (
        <img src={banner} alt="" aria-hidden crossOrigin={MEDIA_CORS} className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl" />
      ) : icon ? (
        <img src={icon} alt="" aria-hidden crossOrigin={MEDIA_CORS} className="absolute inset-0 size-full scale-150 object-cover opacity-30 blur-3xl" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black/90" />

      <div className="relative flex h-full flex-col items-center gap-6 overflow-auto px-4 pb-8 pt-12 [&>*:first-child]:mt-auto [&>*:last-child]:mb-auto">
        <div className="w-full max-w-xl">
          <div className={cn('relative w-full overflow-hidden rounded-2xl bg-white/5 shadow-2xl ring-1 ring-white/10 transition-[aspect-ratio]', phoneStatus === 'off' ? 'aspect-[16/7]' : 'aspect-[16/4]')}>
            {banner ? (
              <img src={banner} alt="" crossOrigin={MEDIA_CORS} className={cn('size-full object-cover', !reducedMotion && 'animate-[sh-splash-pan_14s_ease-in-out_infinite_alternate]')} />
            ) : (
              <div className="grid size-full place-items-center">
                <AppIcon app={{ name: app.name, iconUrl: icon }} size={96} className="shadow-xl" />
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            {banner && <AppIcon app={{ name: app.name, iconUrl: icon }} size={48} className="shrink-0 shadow-lg ring-1 ring-white/20" />}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{app.name}</h1>
              {developer && <p className="truncate text-sm text-white/60">{developer}</p>}
            </div>
          </div>

          {/* what is happening, step by step (real states, no made-up percentage) */}
          <ol className="mt-6 flex items-center gap-2 text-xs text-white/50" aria-hidden>
            {STEPS.map(([key, label], i) => (
              <li key={key} className="flex flex-1 items-center gap-2">
                <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', i < at ? 'border-white bg-white text-black' : i === at ? 'border-white text-white' : 'border-white/25')}>
                  {i < at ? <Check className="size-3" strokeWidth={3} /> : i === at ? <Loader2 className="sh-spin size-3" /> : null}
                </span>
                <span className={cn(i <= at && 'text-white')}>{label}</span>
                {i < STEPS.length - 1 && <span className={cn('h-px flex-1', i < at ? 'bg-white/70' : 'bg-white/15')} />}
              </li>
            ))}
          </ol>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
            <div className={cn('h-full rounded-full bg-white transition-[width] duration-700', stage !== 'ready' && !reducedMotion && 'animate-pulse')} style={{ width: `${Math.max(8, (at / STEPS.length) * 100)}%` }} />
          </div>

          {slow && stage !== 'ready' ? (
            <div className="mt-5 rounded-xl bg-white/10 p-3 text-sm ring-1 ring-white/10">
              <p>This is taking longer than usual. Big games can take a minute on a slow connection.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <SplashButton primary onClick={() => setLeaving(true)}><Play className="size-4" /> Show the game anyway</SplashButton>
                <SplashButton onClick={onReload}><RefreshCw className="size-4" /> Reload</SplashButton>
                {app.id && (
                  <SplashButton onClick={() => openReport({ appId: app.id!, name: app.name, isGame: true, kind: app.kind, problem: 'stuck-loading' })}>
                    <Flag className="size-4" /> Report
                  </SplashButton>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-white/70">
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1">
                <Gamepad2 className="size-3.5" aria-hidden />
                {pad ? `${pad} ready` : 'Plug in a controller to play with it'}
              </span>
              {remappable && (
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1">
                  <Keyboard className="size-3.5" aria-hidden /> Keys can be remapped
                </span>
              )}
              <span className="rounded-full bg-white/10 px-2.5 py-1">{keysFor('toggleGameMode')} leaves game mode</span>
            </div>
          )}
        </div>

        {remappable && <PhonePadCard dark className="w-full max-w-xl" />}

        <div className="flex gap-2">
          {waitingForPhone && stage === 'ready' && (
            <SplashButton primary onClick={() => setLeaving(true)}>
              <Play className="size-4" /> Play without a phone
            </SplashButton>
          )}
          {remappable && (
            <SplashButton onClick={() => openControls(tabId)}>
              <SlidersHorizontal className="size-4" /> Controls
            </SplashButton>
          )}
          {!(waitingForPhone && stage === 'ready') && <SplashButton onClick={() => setLeaving(true)}>Skip</SplashButton>}
        </div>
      </div>
    </div>
  )
}

function SplashButton({ primary, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/70',
        primary ? 'bg-white text-black hover:bg-white/90' : 'bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20',
        className,
      )}
    />
  )
}

// ---- proxied game:// tabs -------------------------------------------------------------------------------

const MIN_CANVAS = { w: 160, h: 120 }
const DOM_GAME_MS = 2500
const MAX_WAIT_MS = 8000

const big = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.width >= MIN_CANVAS.w && r.height >= MIN_CANVAS.h
}

/** A page shows a game when it has a canvas, video or plugin player of a real size, here or in a frame inside it. */
export function hasGameSurface(doc: Document, depth = 0): boolean {
  for (const el of doc.querySelectorAll('canvas, video, embed, object, ruffle-player, ruffle-embed')) if (big(el)) return true
  if (depth >= 3) return false
  for (const f of doc.querySelectorAll('iframe, frame')) {
    if (!big(f)) continue
    try {
      const inner = (f as HTMLIFrameElement).contentDocument
      if (inner && inner.readyState !== 'loading' && hasGameSurface(inner, depth + 1)) return true
    } catch {
      /* a frame the proxy does not own: judged by time below */
    }
  }
  return false
}

const hasContent = (doc: Document) => {
  const b = doc.body
  return !!b && b.getBoundingClientRect().height > 0 && (b.children.length > 0 || (b.textContent ?? '').trim().length > 0)
}

/** Where a proxied tab is: the tab's own state until the document loaded, then the wait for a game surface. */
function useProxiedStage(tab: Tab): SplashStage {
  const loaded = !tab.loading && !tab.pendingCommit
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    if (!loaded) return
    const started = Date.now()
    const check = () => {
      const doc = proxy.byTab.get(tab.id)?.iframe.contentDocument ?? null
      const waited = Date.now() - started
      // the installed app's direct engine: the page cannot be looked into, so give it a moment
      const ok = doc ? hasGameSurface(doc) || (waited >= DOM_GAME_MS && hasContent(doc)) || waited >= MAX_WAIT_MS : waited >= 1500
      if (ok) setReady(true)
      return ok
    }
    if (check()) return
    const t = setInterval(() => check() && clearInterval(t), 250)
    return () => clearInterval(t)
  }, [loaded, tab.id, tab.frameKey])
  if (tab.pendingCommit) return 'connecting'
  if (!loaded) return 'loading'
  return ready ? 'ready' : 'starting'
}

const TIP_KEY = 'shasta-game-tip-v1'

/** Once per device: say where the controls are, right after the first game opened. */
function nudgeOnce(tabId: string) {
  try {
    if (localStorage.getItem(TIP_KEY)) return
    localStorage.setItem(TIP_KEY, '1')
  } catch {
    return
  }
  useUi.getState().toast('Tip: you can remap keys or play with a controller. Find Controls at the top of the game.', {
    ms: 8000,
    action: { label: 'Controls', run: () => openControls(tabId) },
  })
}

/** Launched games that were already shown (a tab and its current frame): switching tabs never replays the splash. */
const shown = new Set<string>()

/** The splash over a proxied game:// tab, until the game is on screen. Keyed by the tab's frame in BrowserView. */
export function GameLaunchOverlay({ tab }: { tab: Tab }) {
  const id = `${tab.id}:${tab.frameKey}`
  const [done, setDone] = useState(() => shown.has(id))
  const stage = useProxiedStage(tab)
  if (done || tab.error || !tab.app) return null
  return (
    <GameSplash
      app={{ id: tab.app.id, name: tab.app.name, iconUrl: tab.app.iconUrl, kind: tab.app.kind }}
      stage={stage}
      tabId={tab.id}
      onReload={() => useTabs.getState().reload(tab.id)}
      onDone={() => {
        shown.add(id)
        setDone(true)
        if (useTabs.getState().activeId === tab.id) {
          focusActiveFrame()
          nudgeOnce(tab.id)
        }
      }}
    />
  )
}
