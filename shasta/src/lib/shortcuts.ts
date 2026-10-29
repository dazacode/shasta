// Keyboard shortcuts. Matching is separate from running so the same table drives the
// handler, the "Keyboard shortcuts" dialog and the tooltips.
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { useSettings } from '@/stores/settingsStore'
import { useLibrary } from '@/stores/libraryStore'
import { tabTitle, tabUrl } from '@/lib/tabModel'
import { isInternalUrl } from '@/lib/url'
import { requestPrivateTab } from '@/lib/privateTab'
import { NO_PRIVATE_BOOKMARKS } from '@/hooks/usePrivateTab'
import * as proxy from '@/proxy/scramjetAdapter'
import { forceFocus } from '@/lib/gameControl'

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl+'

export type Action =
  | 'newTab' | 'newPrivateTab' | 'closeTab' | 'reopenTab' | 'focusAddress' | 'reload' | 'stop' | 'bookmark'
  | 'nextTab' | 'prevTab' | 'back' | 'forward' | 'home' | 'settings' | 'history' | 'downloads'
  | 'bookmarks' | 'fullscreen' | 'duplicateTab' | 'pinTab' | 'print' | 'toggleBookmarksBar' | 'tabN' | 'toggleGameMode' | 'toggleAssistant'

export interface ShortcutDef {
  action: Action
  label: string
  /** shown in the shortcuts dialog */
  keys: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
  { action: 'newTab', label: 'New tab', keys: [`${MOD}T`, 'Alt+Shift+T'] },
  { action: 'newPrivateTab', label: 'New private tab', keys: [isMac ? '⇧⌘N' : 'Ctrl+Shift+N', 'Alt+Shift+N'] },
  { action: 'closeTab', label: 'Close tab', keys: [`${MOD}W`, 'Alt+Shift+W'] },
  { action: 'reopenTab', label: 'Reopen closed tab', keys: [isMac ? '⇧⌘T' : 'Ctrl+Shift+T', 'Alt+Shift+Z'] },
  { action: 'focusAddress', label: 'Focus address bar', keys: [`${MOD}L`, 'F6'] },
  { action: 'reload', label: 'Reload', keys: [`${MOD}R`, 'F5'] },
  { action: 'stop', label: 'Stop loading', keys: ['Esc'] },
  { action: 'bookmark', label: 'Bookmark this page', keys: [`${MOD}D`] },
  { action: 'nextTab', label: 'Next tab', keys: ['Ctrl+Tab', isMac ? '⇧⌘]' : 'Ctrl+PageDown'] },
  { action: 'prevTab', label: 'Previous tab', keys: ['Ctrl+Shift+Tab', isMac ? '⇧⌘[' : 'Ctrl+PageUp'] },
  { action: 'tabN', label: 'Go to tab 1–8 (9 = last)', keys: [`${MOD}1…9`] },
  { action: 'back', label: 'Back', keys: [isMac ? '⌘[' : 'Alt+←'] },
  { action: 'forward', label: 'Forward', keys: [isMac ? '⌘]' : 'Alt+→'] },
  { action: 'home', label: 'Home', keys: ['Alt+Home'] },
  { action: 'history', label: 'History', keys: [isMac ? '⌘Y' : 'Ctrl+H'] },
  { action: 'bookmarks', label: 'Bookmarks', keys: [isMac ? '⌥⌘B' : 'Ctrl+Alt+B'] },
  { action: 'downloads', label: 'Downloads', keys: [isMac ? '⇧⌘J' : 'Ctrl+J'] },
  { action: 'settings', label: 'Settings', keys: [`${MOD},`] },
  { action: 'toggleBookmarksBar', label: 'Show / hide bookmarks bar', keys: [isMac ? '⇧⌘B' : 'Ctrl+Shift+B'] },
  { action: 'fullscreen', label: 'Full screen', keys: [isMac ? '⌃⌘F' : 'F11'] },
  { action: 'toggleGameMode', label: 'Game mode (pause shortcuts, send all keys to the page)', keys: ['Alt+Shift+G'] },
  { action: 'toggleAssistant', label: 'Shasta AI assistant', keys: [isMac ? '⇧⌘K' : 'Ctrl+Shift+K', 'Alt+Shift+A'] },
  { action: 'print', label: 'Print page', keys: [`${MOD}P`] },
]

export const keysFor = (action: Action) => SHORTCUTS.find((s) => s.action === action)?.keys[0] ?? ''

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Maps a key event to an action, or null when it is not one of ours. */
export function matchAction(e: KeyboardEvent): { action: Action; n?: number } | null {
  const mod = isMac ? e.metaKey : e.ctrlKey
  const key = e.key.toLowerCase()
  const editable = isEditable(e.target)

  // alternatives that browsers do not reserve (matched on physical key so Option+letter on Mac works)
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
    if (e.code === 'KeyT') return { action: 'newTab' }
    if (e.code === 'KeyW') return { action: 'closeTab' }
    if (e.code === 'KeyN') return { action: 'newPrivateTab' }
    if (e.code === 'KeyZ') return { action: 'reopenTab' }
    if (e.code === 'KeyG') return { action: 'toggleGameMode' }
    if (e.code === 'KeyA') return { action: 'toggleAssistant' }
  }

  if (e.key === 'F5') return { action: 'reload' }
  if (e.key === 'F6') return { action: 'focusAddress' }
  if (e.key === 'F11' && !isMac) return { action: 'fullscreen' }
  if (isMac && e.ctrlKey && e.metaKey && key === 'f') return { action: 'fullscreen' }

  if (e.ctrlKey && key === 'tab') return { action: e.shiftKey ? 'prevTab' : 'nextTab' }
  if (e.ctrlKey && (e.key === 'PageDown' || e.key === 'PageUp')) return { action: e.key === 'PageDown' ? 'nextTab' : 'prevTab' }

  if (e.altKey && !mod && !e.shiftKey && !editable) {
    if (e.key === 'ArrowLeft') return { action: 'back' }
    if (e.key === 'ArrowRight') return { action: 'forward' }
    if (e.key === 'Home') return { action: 'home' }
  }

  if (!mod) return null
  if (/^[1-9]$/.test(e.key) && !e.shiftKey && !e.altKey) return { action: 'tabN', n: Number(e.key) }

  if (e.shiftKey && !e.altKey) {
    if (key === 't') return { action: 'reopenTab' }
    if (key === 'n') return { action: 'newPrivateTab' }
    if (key === 'b') return { action: 'toggleBookmarksBar' }
    if (key === 'k') return { action: 'toggleAssistant' }
    if (key === 'j' && isMac) return { action: 'downloads' }
    if (e.key === '}' || e.code === 'BracketRight') return { action: 'nextTab' }
    if (e.key === '{' || e.code === 'BracketLeft') return { action: 'prevTab' }
    if (key === 'r') return { action: 'reload' }
    return null
  }
  if (e.altKey) return key === 'b' || e.code === 'KeyB' ? { action: 'bookmarks' } : null

  switch (key) {
    case 't': return { action: 'newTab' }
    case 'w': return { action: 'closeTab' }
    case 'l': return { action: 'focusAddress' }
    case 'r': return { action: 'reload' }
    case 'd': return { action: 'bookmark' }
    case ',': return { action: 'settings' }
    case 'p': return { action: 'print' }
    case 'y': return isMac ? { action: 'history' } : null
    case 'h': return isMac ? null : { action: 'history' }
    case 'j': return isMac ? null : { action: 'downloads' }
    case '[': return { action: 'back' }
    case ']': return { action: 'forward' }
  }
  return null
}

/** Gives keyboard focus to the visible proxied page (a click on the toolbar leaves it in the shell). */
export function focusActiveFrame() {
  const frame = document.querySelector<HTMLIFrameElement>('#browser-view iframe:not([inert])')
  frame?.focus()
  // game mode: tell the game it has focus even if its window already had it (lib/gameControl.ts)
  if (frame?.contentWindow && useUi.getState().gameMode) forceFocus(frame.contentWindow)
}

export function perform(match: { action: Action; n?: number }) {
  const tabs = useTabs.getState()
  const ui = useUi.getState()
  const active = tabs.tabs.find((t) => t.id === tabs.activeId)
  switch (match.action) {
    case 'newTab': tabs.newTab(undefined, { atEnd: true }); ui.requestOmniboxFocus(); break
    case 'newPrivateTab': requestPrivateTab(); break
    case 'closeTab': tabs.closeTab(tabs.activeId); break
    case 'reopenTab': tabs.reopenClosed(); break
    case 'duplicateTab': tabs.duplicateTab(tabs.activeId); break
    case 'pinTab': if (active) tabs.pinTab(active.id, !active.pinned); break
    case 'focusAddress': ui.requestOmniboxFocus(); break
    case 'reload': tabs.reload(); break
    case 'stop': tabs.stop(); break
    case 'bookmark':
      if (active?.private) ui.toast(NO_PRIVATE_BOOKMARKS)
      else if (active && !isInternalUrl(tabUrl(active))) {
        const lib = useLibrary.getState()
        if (!lib.bookmarks.some((b) => b.type === 'bookmark' && b.url === tabUrl(active))) lib.addBookmark({ url: tabUrl(active), title: tabTitle(active) })
        ui.openBookmarkEditor()
      }
      break
    case 'nextTab': tabs.cycleTab(1); break
    case 'prevTab': tabs.cycleTab(-1); break
    case 'tabN': tabs.selectIndex(match.n ?? 1); break
    case 'back': tabs.back(); break
    case 'forward': tabs.forward(); break
    case 'home': tabs.home(); break
    case 'settings': tabs.openInternal('settings'); break
    case 'history': tabs.openInternal('history'); break
    case 'downloads': tabs.openInternal('downloads'); break
    case 'bookmarks': tabs.openInternal('bookmarks'); break
    case 'toggleBookmarksBar': {
      const s = useSettings.getState()
      s.update({ showBookmarksBar: !s.settings.showBookmarksBar })
      break
    }
    case 'fullscreen':
      void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => ui.toast('Full screen was blocked by the browser', { tone: 'error' }))
      break
    case 'toggleGameMode': {
      const on = !ui.gameMode
      ui.setGameMode(on)
      ui.toast(on ? 'Game mode on: click the game to take control. Alt+Shift+G to leave.' : 'Game mode off', { ms: 3000 })
      focusActiveFrame()
      break
    }
    case 'toggleAssistant':
      if (useSettings.getState().settings.ai.enabled) ui.toggleAssistant()
      else ui.toast('Shasta AI is turned off. Turn it on in Settings → AI.')
      break
    case 'print': if (active && !isInternalUrl(tabUrl(active))) proxy.print(active.id); break
  }
}

/** Returns true when the event was a Shasta shortcut (and has been consumed). */
export function handleKeydown(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing) return false
  const match = matchAction(e)
  if (!match) return false
  // in game mode only the way out is ours; everything else belongs to the page
  if (useUi.getState().gameMode && match.action !== 'toggleGameMode') return false
  e.preventDefault()
  perform(match)
  return true
}
