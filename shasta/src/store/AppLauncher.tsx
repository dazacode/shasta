// The runtime: one tab per running app. Uploaded apps run in an iframe on their OWN origin (one hostname per app), inside
// a restrictive sandbox, so they cannot reach Shasta's page, storage, session cookie or the Store API.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Flag, Info, Loader2, Maximize2, Minimize2, RefreshCw, Store, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { ApiError, errorMessage } from './api'
import { useStore } from './storeStore'
import { useStoreBoot } from './hooks'
import { AppIcon } from './components'
import { AI_APP_SLUG, attachBridge } from '@/ai/bridge'
import type { RuntimeTarget } from './types'
import { openReport, type ReportTarget } from './ReportDialog'
import { GameSplash } from '@/components/game/GameSplash'

/** No allow-popups / allow-top-navigation / allow-downloads-without-gesture: the app cannot open windows or leave its frame. */
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals allow-downloads'
const FRAME_POLICY = "fullscreen *; autoplay *; gamepad *; cross-origin-isolated *; screen-wake-lock *"
const SLOW_MS = 20_000

type Phase =
  | { kind: 'starting' }
  | { kind: 'loading'; info: RuntimeTarget; slow: boolean }
  | { kind: 'running'; info: RuntimeTarget }
  | { kind: 'error'; title: string; message: string; recover: 'retry' | 'store' | 'library' }

function Fail({ title, message, recover, onRetry, onReport }: { title: string; message: string; recover: 'retry' | 'store' | 'library'; onRetry: () => void; onReport?: () => void }) {
  const open = (path: string) => useTabs.getState().openInternal('store', path)
  return (
    <div className="grid h-full place-items-center p-6" role="alert">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-shasta-field">{recover === 'retry' ? <WifiOff className="size-6 text-shasta-muted" /> : <AlertTriangle className="size-6 text-shasta-warn" />}</div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-shasta-muted">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          {recover === 'retry' && <Button onClick={onRetry}><RefreshCw /> Try again</Button>}
          {recover === 'library' && <Button onClick={() => useTabs.getState().openInternal('library')}>Open Library</Button>}
          <Button variant="secondary" onClick={() => open('/')}><Store /> Back to the Store</Button>
        </div>
        {onReport && (
          <button className="mt-4 text-sm text-shasta-muted underline-offset-2 hover:text-shasta-fg hover:underline" onClick={onReport}>
            Keeps happening? Report it
          </button>
        )}
      </div>
    </div>
  )
}

/** `appKey` is the app's name from its address (game://click-quest -> click-quest); older tabs carry the id instead. */
export function AppRuntime({ tabId, appKey, active, isGame = false }: { tabId: string; appKey: string; active: boolean; /** a game:// address: the launcher splash instead of the plain loading screen */ isGame?: boolean }) {
  useStoreBoot()
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [nonce, setNonce] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const library = useStore((s) => s.library)
  const [appId, setAppId] = useState<string | null>(null)
  const reloads = useUi((s) => (appId ? (s.appReloads[appId] ?? 0) : 0))
  const item = library?.installed.find((i) => i.app.id === appId || i.app.slug === appKey || i.app.id === appKey)
  // the launcher splash (games): shown again after a reload, gone for good once the game is on screen
  const [splashDone, setSplashDone] = useState(false)
  useEffect(() => {
    setSplashDone(false)
  }, [appKey, nonce, reloads])

  // look up how to run the app (no side effects: reopening a restored tab is not a "launch")
  useEffect(() => {
    let live = true
    setPhase({ kind: 'starting' })
    // the library is on this device: load it, ask the Store how to run the app, and check this device really has it
    void (async () => {
      await useStore.getState().boot()
      const info = await useStore.getState().fetchLaunch(appKey)
      const id = info.id ?? useStore.getState().library?.installed.find((i) => i.app.slug === appKey)?.app.id ?? appKey
      if (!useStore.getState().local?.installs.some((i) => i.appId === id)) throw new ApiError(404, 'It was uninstalled, or it was never installed on this device.', 'not_installed')
      return info
    })()
      .then((info) => {
        if (!live) return
        if (info.target.kind === 'linked') {
          useTabs.getState().navigateTo(tabId, info.target.url)
          return
        }
        const known = useStore.getState().library?.installed.find((i) => i.app.slug === appKey || i.app.id === appKey)?.app
        const id = info.id ?? known?.id ?? appKey
        setAppId(id)
        // tabs restored from an older session, or typed as an address, learn which app they are
        useTabs.getState().setTabApp(tabId, { id, slug: info.slug ?? known?.slug ?? appKey, scheme: info.scheme ?? (known?.category?.isGame ? 'game' : 'app'), name: info.name, iconUrl: info.iconUrl ?? known?.iconUrl ?? null, kind: 'package', home: '' })
        setPhase({ kind: 'loading', info, slow: false })
      })
      .catch((e: unknown) => {
        if (!live) return
        if (e instanceof ApiError && e.offline) setPhase({ kind: 'error', title: "Can't reach the Store", message: e.message, recover: 'retry' })
        else if (e instanceof ApiError && e.status === 404) setPhase({ kind: 'error', title: 'This app is not in your library', message: e.code === 'not_installed' ? e.message : 'It is no longer in the Store.', recover: 'store' })
        else if (e instanceof ApiError && e.status === 409) setPhase({ kind: 'error', title: 'This app is unavailable', message: e.message, recover: 'library' })
        else setPhase({ kind: 'error', title: 'The app could not be started', message: errorMessage(e), recover: 'retry' })
      })
    return () => {
      live = false
    }
  }, [appKey, tabId, nonce, reloads])

  // a frame that never finishes loading gets a way out instead of a spinner forever
  useEffect(() => {
    if (phase.kind !== 'loading') return
    const t = setTimeout(() => setPhase((p) => (p.kind === 'loading' ? { ...p, slow: true } : p)), SLOW_MS)
    return () => clearTimeout(t)
  }, [phase.kind, nonce])

  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.current?.requestFullscreen().catch(() => useUi.getState().toast('Full screen is not allowed here.', { tone: 'error' }))
  }, [])

  const info = phase.kind === 'loading' || phase.kind === 'running' ? phase.info : null

  const report = (extra: Partial<ReportTarget> = {}) => {
    const app = item?.app
    const id = appId ?? app?.id
    if (!id) return
    openReport({ appId: id, name: info?.name ?? app?.name ?? appKey, official: app?.store?.official, isGame: app?.category?.isGame, kind: 'package', appVersion: info?.version ?? null, ...extra })
  }
  const canReport = !!(appId ?? item?.app.id)

  // the official Shasta AI app (and only it) may use the on-device models through the shell
  const officialAi = !!info && info.slug === AI_APP_SLUG && item?.app.store?.official === true
  const frameUrl = info?.target.url
  useEffect(() => {
    const el = frame.current
    if (!officialAi || !el || !frameUrl) return
    return attachBridge(el, new URL(frameUrl).origin)
  }, [officialAi, frameUrl, nonce, reloads])

  return (
    <div ref={box} className="flex h-full flex-col bg-shasta-bg text-shasta-fg">
      <div className={`flex h-9 shrink-0 items-center gap-2 border-b border-shasta-line bg-shasta-tab px-2 text-sm ${fullscreen ? 'hidden' : ''}`}>
        <button onClick={() => useTabs.getState().openInternal('library')} className="flex items-center gap-1 rounded-md px-2 py-1 text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg" aria-label="Back to Library">
          <ArrowLeft className="size-4" /> Library
        </button>
        {info && <AppIcon app={{ name: info.name, iconUrl: info.iconUrl }} size={20} />}
        <span className="truncate font-medium">{info?.name ?? 'Starting…'}</span>
        {(info?.showVersion || info?.onOlderVersion) && <span className="text-xs text-shasta-muted">v{info.version}</span>}
        {item && !item.available && (
          <span role="status" className="rounded-full bg-shasta-warn/15 px-2 py-0.5 text-xs font-medium text-shasta-warn">{item.unavailableReason ?? 'No longer available'}: reloading will not work</span>
        )}
        {item?.updateAvailable && (
          <Button size="xs" variant={item.canStay ? 'secondary' : 'default'} onClick={() => appId && void useStore.getState().update(appId)} title={item.changelog.map((c) => `${c.version}: ${c.notes || 'No notes'}`).join('\n') || undefined}>
            {item.canStay ? `Update to ${item.latestVersion} (optional)` : `Update to ${item.latestVersion}`}
          </Button>
        )}
        <span className="flex-1" />
        <button aria-label="Open store listing" title="About this app" disabled={!item} onClick={() => item && useTabs.getState().openInternal('store', `/app/${encodeURIComponent(item.app.slug)}`)} className="grid size-7 place-items-center rounded-md text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg disabled:opacity-40">
          <Info className="size-4" />
        </button>
        <button aria-label="Report a problem" title="Report a problem" disabled={!canReport} onClick={() => report()} className="grid size-7 place-items-center rounded-md text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg disabled:opacity-40">
          <Flag className="size-4" />
        </button>
        <button aria-label="Reload app" title="Reload app" onClick={() => setNonce((n) => n + 1)} className="grid size-7 place-items-center rounded-md text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
          <RefreshCw className="size-4" />
        </button>
        <button
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          title={document.fullscreenEnabled ? (fullscreen ? 'Exit full screen' : 'Full screen') : 'Full screen is not available here'}
          disabled={!document.fullscreenEnabled}
          onClick={toggleFullscreen}
          className="grid size-7 place-items-center rounded-md text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg disabled:opacity-40"
        >
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {info && (
          <iframe
            ref={frame}
            key={`${info.originKey}-${nonce}-${reloads}`}
            title={info.name}
            src={info.target.url}
            sandbox={SANDBOX}
            allow={FRAME_POLICY}
            allowFullScreen
            referrerPolicy="no-referrer"
            inert={!active}
            onLoad={() => setPhase((p) => (p.kind === 'loading' ? { kind: 'running', info: p.info } : p))}
            className="absolute inset-0 size-full border-0 bg-white"
          />
        )}
        {isGame && !splashDone && phase.kind !== 'error' && (
          <GameSplash
            app={{ id: appId ?? item?.app.id, name: info?.name ?? item?.app.name ?? appKey, iconUrl: info?.iconUrl ?? item?.app.iconUrl ?? null, kind: info ? (info.target.kind === 'linked' ? 'linked' : 'package') : (item?.app.kind ?? 'linked') }}
            stage={phase.kind === 'starting' ? 'connecting' : phase.kind === 'loading' ? 'loading' : 'ready'}
            tabId={tabId}
            onReload={() => setNonce((n) => n + 1)}
            onDone={() => {
              setSplashDone(true)
              if (active) frame.current?.focus()
            }}
          />
        )}
        {!isGame && (phase.kind === 'starting' || phase.kind === 'loading') && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-shasta-bg" role="status" aria-live="polite">
            <div className="text-center">
              {info ? <AppIcon app={{ name: info.name, iconUrl: info.iconUrl }} size={72} className="mx-auto shadow-lg" /> : <Loader2 className="sh-spin mx-auto size-8 text-shasta-accent" />}
              <p className="mt-4 text-sm text-shasta-muted">{info ? `Loading ${info.name}…` : 'Starting…'}</p>
              {info && <Loader2 className="sh-spin mx-auto mt-3 size-5 text-shasta-accent" aria-hidden />}
              {phase.kind === 'loading' && phase.slow && (
                <div className="mt-4">
                  <p className="text-xs text-shasta-muted">This is taking longer than usual.</p>
                  <div className="mt-2 flex justify-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setNonce((n) => n + 1)}><RefreshCw /> Reload</Button>
                    {canReport && <Button size="sm" variant="ghost" onClick={() => report({ problem: 'stuck-loading' })}><Flag /> Report</Button>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {phase.kind === 'error' && <div className="absolute inset-0 z-10 bg-shasta-bg"><Fail {...phase} onRetry={() => setNonce((n) => n + 1)} onReport={phase.recover === 'retry' && canReport ? () => report({ problem: 'wont-load', error: `${phase.title}: ${phase.message}` }) : undefined} /></div>}
      </div>
    </div>
  )
}
