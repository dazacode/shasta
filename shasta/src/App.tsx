import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabBar } from '@/components/browser/TabBar'
import { Toolbar } from '@/components/browser/Toolbar'
import { BookmarksBar } from '@/components/browser/BookmarksBar'
import { BrowserView } from '@/components/browser/BrowserView'
import { ConnectionBanner } from '@/components/browser/ConnectionBanner'
import { ShortcutsDialog } from '@/components/browser/ShortcutsDialog'
import { Toasts } from '@/components/browser/Toasts'
import { PrivateTabDialog } from '@/components/browser/PrivateTabDialog'
import { ReportHost } from '@/store/ReportDialog'
import { RecoveryKeyDialog } from '@/store/RecoveryKeyDialog'
import { useAppearance } from '@/hooks/useAppearance'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useBrowserGuards } from '@/hooks/useBrowserGuards'
import { PageContextMenu } from '@/components/browser/PageContextMenu'
import { AssistantPanel } from '@/components/ai/AssistantPanel'
import { useConnection, startBridge } from '@/stores/connectionStore'
import { useTabs } from '@/stores/tabsStore'
import { useLibrary } from '@/stores/libraryStore'
import { useDownloads } from '@/stores/downloadsStore'
import { useStore } from '@/store/storeStore'
import { useSettings } from '@/stores/settingsStore'
import { useSupporterStore } from '@/stores/supporterStore'
import { useOffline } from '@/stores/offlineStore'
import { useUi } from '@/stores/uiStore'
import { tabTitle } from '@/lib/tabModel'
import { startResourceGuard } from '@/lib/resourceGuard'
import { startMaintenance } from '@/lib/maintenance'
import { openSharedLink } from '@/lib/shareLink'
import { showWhatsNewOnce } from '@/lib/whatsNew'

function useBootstrap() {
  useEffect(() => {
    startBridge()
    void useLibrary.getState().load()
    void useDownloads.getState().load()
    void useConnection.getState().boot()
    // installed apps are part of the browser itself (app:// and game:// addresses), so the library is ready from the start
    void useStore.getState().boot()
    // supporter pass: checked on the device, refreshed quietly when it is close to running out (cosmetic perks only)
    useSupporterStore.getState().boot()
    // offline application shell: background download, update notices (lib/offline.ts)
    useOffline.getState().boot()
    startResourceGuard()
    startMaintenance()
    // a link someone shared (https://<site>/?app=<slug>) opens that Store page
    // first open (and after a big change): the welcome tour and beta notice, before a shared link so that one ends up in front
    showWhatsNewOnce(() => useTabs.getState().openInternal('whats-new'))
    openSharedLink((path) => useTabs.getState().openInternal('store', path))
    // idle tabs release their page; one timer for the whole app
    const timer = setInterval(() => useTabs.getState().suspendIdle(), 60_000)
    return () => {
      clearInterval(timer)
    }
  }, [])
}

function useWindowTitle() {
  const title = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId)
    return t ? tabTitle(t) : ''
  })
  useEffect(() => {
    document.title = title && title !== 'New Tab' ? `${title} – Shasta` : 'Shasta'
  }, [title])
}

export default function App() {
  const { reducedMotion } = useAppearance()
  useBootstrap()
  useShortcuts()
  useBrowserGuards()
  useWindowTitle()
  const showBar = useSettings((s) => s.settings.showBookmarksBar)
  const hidden = useUi((s) => s.chromeHidden)
  const setHidden = useUi((s) => s.setChromeHidden)

  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      <TooltipProvider delay={400}>
        <div className="flex h-dvh flex-col overflow-hidden bg-shasta-chrome text-shasta-fg">
          {hidden ? (
            <button onClick={() => setHidden(false)} className="flex h-4 w-full shrink-0 items-center justify-center bg-shasta-chrome text-shasta-muted hover:bg-shasta-hover" aria-label="Show toolbar" title="Show toolbar">
              <ChevronDown className="size-3.5" />
            </button>
          ) : (
            <TabBar />
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-shasta-bg">
            {!hidden && (
              <>
                <Toolbar />
                {showBar && <BookmarksBar />}
              </>
            )}
            <ConnectionBanner />
            <div className="relative flex min-h-0 flex-1">
              <BrowserView />
              <AssistantPanel />
            </div>
          </div>
        </div>
        <ShortcutsDialog />
        <PrivateTabDialog />
        <RecoveryKeyDialog />
        <ReportHost />
        <Toasts />
        <PageContextMenu />
      </TooltipProvider>
    </MotionConfig>
  )
}
