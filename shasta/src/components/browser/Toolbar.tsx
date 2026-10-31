import { SlidersHorizontal, Bookmark, Flag, Gamepad2, HeartHandshake, MessagesSquare, RefreshCw, Share, ShieldCheck, Sparkles, VenetianMask, Film, Library, Store, ArrowLeft, Gauge, ArrowRight, Download, Home, Keyboard, MoreVertical, Printer, RotateCw, X } from 'lucide-react'
import { openControls } from '@/stores/gameControlsStore'
import { openSaveShasta, siteAddress } from '@/lib/saveShasta'
import { shouldSuggestApp } from '@/lib/shastaApp'
import { IconButton } from './IconButton'
import { Omnibox } from './Omnibox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useActiveTab, useTabs } from '@/stores/tabsStore'
import { useOffline } from '@/stores/offlineStore'
import { useDownloads, activeDownloads } from '@/stores/downloadsStore'
import { useSettings } from '@/stores/settingsStore'
import { canGoBack, canGoForward, tabUrl } from '@/lib/tabModel'
import { isInternalUrl } from '@/lib/url'
import { isMac, keysFor, perform } from '@/lib/shortcuts'
import { useUi } from '@/stores/uiStore'
import { requestPrivateTab } from '@/lib/privateTab'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openReport } from '@/store/ReportDialog'
import { appShareLink, shareLink, shareLinkFor } from '@/lib/shareLink'

const tabTitleOf = (t: { entries: { title: string }[]; index: number }) => t.entries[t.index]?.title ?? ''

/** The system share sheet where there is one, otherwise the address goes to the clipboard. */
async function sharePage(url: string, title: string) {
  if (!(await shareLink(url, title, (msg) => useUi.getState().toast(msg)))) useUi.getState().toast('Could not copy the link.', { tone: 'error' })
}

export function Toolbar() {
  const tab = useActiveTab()
  const { back, forward, reload, stop, home, newTab, openInternal } = useTabs.getState()
  const downloads = useDownloads((s) => s.items)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const running = activeDownloads(downloads).length
  const updateReady = useOffline((s) => s.updateReady)
  const assistantOpen = useUi((s) => s.assistantOpen)
  const url = tabUrl(tab)
  const external = !isInternalUrl(url)
  // Store pages and Store apps share an https link that opens them in Shasta; other sites share their own address
  const shareUrl = tab?.app ? appShareLink(tab.app.slug) : external ? url : shareLinkFor(url)

  return (
    <div className="relative flex items-center gap-1 px-2 py-1.5" role="toolbar" aria-label="Browser toolbar">
      <IconButton label="Back" shortcut={keysFor('back')} onClick={() => back()} disabled={!canGoBack(tab)}>
        <ArrowLeft className="size-[18px]" strokeWidth={1.6} />
      </IconButton>
      <IconButton label="Forward" shortcut={keysFor('forward')} onClick={() => forward()} disabled={!canGoForward(tab)}>
        <ArrowRight className="size-[18px]" strokeWidth={1.6} />
      </IconButton>
      <IconButton label="Share this page" disabled={!shareUrl} onClick={() => shareUrl && void sharePage(shareUrl, tab.app?.name ?? tabTitleOf(tab))}>
        <Share className="size-[18px]" strokeWidth={1.6} />
      </IconButton>
      {tab.loading ? (
        <IconButton label="Stop loading" shortcut="Esc" onClick={() => stop()}>
          <X className="size-[18px]" strokeWidth={1.6} />
        </IconButton>
      ) : (
        <IconButton label="Reload" shortcut={keysFor('reload')} onClick={() => reload()} disabled={!external}>
          <RotateCw className="size-[18px]" strokeWidth={1.6} />
        </IconButton>
      )}
      <IconButton label="Home" shortcut={keysFor('home')} onClick={() => home()}>
        <Home className="size-[18px]" strokeWidth={1.6} />
      </IconButton>

      <Omnibox tab={tab} />

      {tab.private && (
        <Tooltip>
          <TooltipTrigger render={<span role="img" aria-label="Private tab: Shasta saves no history, session or bookmarks for it. Websites' cookies are still shared with normal tabs." className="grid size-8 shrink-0 place-items-center rounded-full text-shasta-accent" />}>
            <VenetianMask className="size-[18px]" />
          </TooltipTrigger>
          <TooltipContent>Private tab: no history, session or bookmarks saved. Site cookies are still shared with normal tabs, and your network and the proxy can still see this traffic.</TooltipContent>
        </Tooltip>
      )}

      <IconButton label="Shasta Store" onClick={() => openInternal('store')}>
        <Store className="size-[18px]" />
      </IconButton>
      <IconButton label="Library" onClick={() => openInternal('library')}>
        <Library className="size-[18px]" />
      </IconButton>
      <IconButton label="Watch" onClick={() => openInternal('watch')}>
        <Film className="size-[18px]" />
      </IconButton>
      {settings.ai.enabled && (
        <IconButton label="Shasta AI" shortcut={keysFor('toggleAssistant')} onClick={() => useUi.getState().toggleAssistant()} aria-pressed={assistantOpen}>
          <Sparkles className={`size-[18px] ${assistantOpen ? 'text-shasta-accent' : ''}`} />
        </IconButton>
      )}

      {downloads.length > 0 && (
        <IconButton label={running ? `${running} download${running > 1 ? 's' : ''} in progress` : 'Downloads'} onClick={() => openInternal('downloads')}>
          <Download className="size-[18px]" />
          {running > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-shasta-accent" />}
        </IconButton>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={updateReady ? 'Shasta menu, an update is ready' : 'Shasta menu'}
          title={updateReady ? 'Menu: restart to update Shasta' : 'Menu'}
          className="relative grid size-8 shrink-0 place-items-center rounded-full text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg"
        >
          <MoreVertical className="size-[18px]" />
          {/* like a browser's "update" pill: a new version is installed and waits for a restart */}
          {updateReady && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-shasta-accent ring-2 ring-shasta-chrome" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {updateReady && (
            <>
              <DropdownMenuItem onClick={() => void useOffline.getState().applyUpdate()} className="font-medium text-shasta-accent">
                <RefreshCw /> Restart to update Shasta
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => newTab(undefined, { atEnd: true })}>
            New tab <DropdownMenuShortcut>{keysFor('newTab')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => requestPrivateTab()}>
            <VenetianMask /> New private tab <DropdownMenuShortcut>{keysFor('newPrivateTab')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => perform({ action: 'reopenTab' })}>
            Reopen closed tab <DropdownMenuShortcut>{keysFor('reopenTab')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => perform({ action: 'toggleGameMode' })}>
            <Gamepad2 /> Game mode <DropdownMenuShortcut>{keysFor('toggleGameMode')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          {tab && external && tab.app?.kind !== 'package' && (
            <DropdownMenuItem onClick={() => openControls(tab.id)}>
              <SlidersHorizontal /> Controls & controller…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openInternal('history')}>
            History <DropdownMenuShortcut>{keysFor('history')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('bookmarks')}>
            Bookmarks <DropdownMenuShortcut>{keysFor('bookmarks')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('downloads')}>
            Downloads <DropdownMenuShortcut>{keysFor('downloads')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('store')}>
            <Store /> Shasta Store
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('library')}>
            <Library /> Library
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('watch')}>
            <Film /> Watch
          </DropdownMenuItem>
          {tab?.app && (
            <DropdownMenuItem onClick={() => openReport({ appId: tab.app!.id, name: tab.app!.name, isGame: tab.app!.scheme === 'game', kind: tab.app!.kind, error: tab.error?.message ?? null })}>
              <Flag /> Report a problem with {tab.app.name.length > 22 ? `${tab.app.name.slice(0, 21)}…` : tab.app.name}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => update({ showBookmarksBar: !settings.showBookmarksBar })}>
            {settings.showBookmarksBar ? 'Hide' : 'Show'} bookmarks bar <DropdownMenuShortcut>{keysFor('toggleBookmarksBar')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!external} onClick={() => perform({ action: 'print' })}>
            <Printer /> Print… <DropdownMenuShortcut>{keysFor('print')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const n = useTabs.getState().suspendBackground(1)
              useUi.getState().toast(n ? `Paused ${n} background tab${n > 1 ? 's' : ''} to free memory. They reload when you open them.` : 'No other loaded tabs to pause.')
            }}
          >
            <Gauge /> Free up memory
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => perform({ action: 'fullscreen' })}>
            Full screen <DropdownMenuShortcut>{keysFor('fullscreen')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openInternal('settings')}>
            Settings <DropdownMenuShortcut>{isMac ? '⌘,' : 'Ctrl+,'}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('chat')}>
            <MessagesSquare /> Community chat
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('discord')}>
            <MessagesSquare /> Join our Discord
          </DropdownMenuItem>
          {siteAddress() && (
            <DropdownMenuItem onClick={() => openSaveShasta()}>
              <Bookmark /> Save Shasta (bookmark, phone)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => openInternal('whats-new')}>
            <Sparkles /> What's new
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('support')}>
            <HeartHandshake /> Support Shasta
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openInternal('privacy')}>
            <ShieldCheck /> Privacy policy
          </DropdownMenuItem>
          {shouldSuggestApp() && (
            <DropdownMenuItem onClick={() => openInternal('get-app')}>
              <Download /> Get the Shasta app
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => useUi.getState().setShortcutsOpen(true)}>
            <Keyboard /> Keyboard shortcuts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {tab.loading && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" role="progressbar" aria-label="Loading page">
          <div className="sh-progress h-full w-full origin-left bg-shasta-accent" />
        </div>
      )}
    </div>
  )
}
