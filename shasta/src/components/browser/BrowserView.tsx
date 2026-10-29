import { Suspense, createElement, lazy, memo, useEffect, useRef } from 'react'
import * as proxy from '@/proxy/scramjetAdapter'
import * as direct from '@/proxy/directFrame'
import { NewTab } from '@/pages/NewTab'
import { AppRuntime } from '@/store/AppLauncher'
import { PageBoundary } from './PageBoundary'
import type { ContextInfo } from '@/lib/contextMenu'
import { ErrorPage } from './ErrorPage'
import { SignInNotice } from './SignInNotice'
import { UnsupportedNotice } from './UnsupportedNotice'
import { useTabs } from '@/stores/tabsStore'
import { useConnection } from '@/stores/connectionStore'
import { tabUrl, type Tab } from '@/lib/tabModel'
import { handleKeydown } from '@/lib/shortcuts'
import { appKeyOf, hostOf, internalPage, isInternalUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useSettings, type PageAccess } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { keysFor } from '@/lib/shortcuts'
import { Gamepad2 } from 'lucide-react'

// secondary pages load on demand to keep startup fast
const HistoryPage = lazy(() => import('@/pages/History'))
const BookmarksPage = lazy(() => import('@/pages/Bookmarks'))
const DownloadsPage = lazy(() => import('@/pages/Downloads'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const LibraryPage = lazy(() => import('@/store/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SupportPage = lazy(() => import('@/pages/Support'))
const GetAppPage = lazy(() => import('@/pages/GetApp'))
const DiscordPage = lazy(() => import('@/pages/Discord'))
const WhatsNewPage = lazy(() => import('@/pages/WhatsNew'))
const ChatPage = lazy(() => import('@/pages/Chat'))
const StorePage = lazy(() => import('@/store/StorePage').then((m) => ({ default: m.StorePage })))

// Permissions policy for proxied pages. Everything powerful is blocked unless the user opted in under
// Settings → Privacy (the browser still asks before anything is granted).
function framePolicy(access: PageAccess): string {
  const rule = (features: string[], on: boolean) => features.map((f) => (on ? `${f} 'self'` : `${f} 'none'`))
  return [
    ...rule(['camera'], access.camera),
    ...rule(['microphone'], access.microphone),
    ...rule(['geolocation'], access.location),
    ...rule(['clipboard-read', 'clipboard-write'], access.clipboard),
    ...rule(['usb', 'serial', 'hid', 'bluetooth', 'midi'], access.devices),
    "display-capture 'none'",
    "payment 'none'",
    "fullscreen 'self'",
    "autoplay 'self'",
  ].join('; ')
}

function ProxiedFrame({ tab, active }: { tab: Tab; active: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const engineReady = useConnection((s) => s.engineReady)
  const { id, frameKey } = tab
  const access = useSettings((s) => s.settings.pageAccess)

  useEffect(() => {
    const iframe = ref.current
    if (!engineReady || !iframe) return
    const events = {
      ...useTabs.getState().frameEvents(id),
      key: handleKeydown,
      contextMenu: (info: ContextInfo) => {
        // a game that captured the pointer (or game mode) owns the mouse: no menu, and the browser's is already suppressed
        if (useUi.getState().gameMode || document.pointerLockElement) return
        useUi.getState().openContextMenu(id, info)
      },
    }
    // a freshly created frame has nothing loaded yet: send it to the tab's current page
    if (proxy.attach(id, iframe, events)) {
      const current = useTabs.getState().tabs.find((t) => t.id === id)
      if (current && !isInternalUrl(tabUrl(current))) proxy.go(id, tabUrl(current))
    }
    return () => proxy.detach(id)
  }, [engineReady, id, frameKey])

  return (
    <iframe
      key={frameKey}
      ref={ref}
      title={tab.entries[tab.index].title}
      allow={framePolicy(access)}
      inert={!active}
      aria-hidden={!active}
      className={cn('absolute inset-0 size-full border-0 bg-white', !active && 'pointer-events-none invisible')}
    />
  )
}

/**
 * A tab in the installed app with the direct engine: a <controlledframe> that loads the real site. The partition
 * is fixed when the element is created (a private tab gets its own, in memory), so it is part of the key.
 */
function DirectFrame({ tab, active }: { tab: Tab; active: boolean }) {
  const ref = useRef<direct.ControlledFrame>(null)
  const { id, frameKey } = tab
  const partition = direct.partitionFor(id, tab.private)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const events = {
      ...useTabs.getState().frameEvents(id),
      key: handleKeydown,
      contextMenu: (info: ContextInfo) => {
        if (useUi.getState().gameMode) return
        useUi.getState().openContextMenu(id, info)
      },
    }
    if (direct.attach(id, el, events, () => useSettings.getState().settings.pageAccess)) {
      const current = useTabs.getState().tabs.find((t) => t.id === id)
      if (current && !isInternalUrl(tabUrl(current))) direct.go(id, tabUrl(current))
    }
    return () => direct.detach(id)
  }, [id, frameKey, partition])

  return createElement('controlledframe', {
    key: `${frameKey}:${partition}`,
    ref,
    partition,
    title: tab.entries[tab.index].title,
    inert: !active,
    'aria-hidden': !active,
    className: cn('absolute inset-0 size-full border-0 bg-white', !active && 'pointer-events-none invisible'),
  })
}

/** The installed app's chosen engine, or the proxy everywhere else. */
function useDirectEngine(): boolean {
  const engine = useSettings((s) => s.settings.pageEngine)
  return engine === 'direct' && direct.available()
}

const TabView = memo(function TabView({ tab, active }: { tab: Tab; active: boolean }) {
  const url = tabUrl(tab)
  const page = internalPage(url)
  const external = !isInternalUrl(url)
  const waiting = active && external && tab.pendingCommit && !tab.frameUrl && !tab.error
  const useDirect = useDirectEngine()
  return (
    <div className={cn('absolute inset-0', !active && 'pointer-events-none invisible')}>
      {tab.frame && (useDirect ? <DirectFrame tab={tab} active={active} /> : <ProxiedFrame tab={tab} active={active} />)}
      {active && waiting && (
        <div className="absolute inset-0 z-[5] grid place-items-center bg-shasta-bg text-shasta-muted" role="status">
          <p className="text-sm">Waiting for {hostOf(url)}…</p>
        </div>
      )}
      {active && tab.suspended && external && !tab.error && <div className="sr-only">Tab suspended</div>}
      {/* a running app keeps its frame (and game state) while another tab is in front, like a proxied page does */}
      {page === 'app' && (
        <div className={cn('absolute inset-0 z-10 bg-shasta-bg', !active && 'pointer-events-none invisible')}>
          <PageBoundary resetKey={url}><AppRuntime tabId={tab.id} appKey={appKeyOf(url)} active={active} /></PageBoundary>
        </div>
      )}
      {/* the chat fills the tab and scrolls inside itself, unlike the document-style pages below */}
      {active && page === 'chat' && (
        <div className="absolute inset-0 z-10 bg-shasta-bg">
          <PageBoundary resetKey={url}>
            <Suspense fallback={null}><ChatPage /></Suspense>
          </PageBoundary>
        </div>
      )}
      {active && page && page !== 'app' && page !== 'chat' && (
        <div className="absolute inset-0 z-10 overflow-auto bg-shasta-bg">
          <PageBoundary resetKey={url}>
          <Suspense fallback={null}>
            {page === 'newtab' && <NewTab tabId={tab.id} />}
            {page === 'history' && <HistoryPage />}
            {page === 'bookmarks' && <BookmarksPage />}
            {page === 'downloads' && <DownloadsPage />}
            {page === 'settings' && <SettingsPage />}
            {page === 'store' && <StorePage tabId={tab.id} url={url} />}
            {page === 'library' && <LibraryPage tabId={tab.id} />}
            {page === 'support' && <SupportPage />}
            {page === 'discord' && <DiscordPage />}
            {page === 'whats-new' && <WhatsNewPage />}
            {page === 'get-app' && <GetAppPage />}
          </Suspense>
          </PageBoundary>
        </div>
      )}
      {active && external && tab.frame && <SignInNotice tab={tab} />}
      {active && external && tab.frame && <UnsupportedNotice tab={tab} />}
      {active && <ErrorPage tab={tab} />}
    </div>
  )
})

export function BrowserView() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const gameMode = useUi((s) => s.gameMode)
  return (
    <main className="relative min-h-0 flex-1 bg-shasta-bg" id="browser-view">
      {tabs.map((tab) => (
        <TabView key={tab.id} tab={tab} active={tab.id === activeId} />
      ))}
      {gameMode && (
        <button
          onClick={() => useUi.getState().setGameMode(false)}
          className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-xs text-white opacity-60 shadow backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100"
          title="Shasta's shortcuts are paused so the page gets every key. Click to leave game mode."
        >
          <Gamepad2 className="size-3.5" aria-hidden /> Game mode · {keysFor('toggleGameMode')} to exit
        </button>
      )}
    </main>
  )
}
