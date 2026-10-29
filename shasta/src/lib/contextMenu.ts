// What a right-click is about, and which menu entries that produces. Pure logic, so it can be unit-tested.
import { searchUrl, type SearchEngine, SEARCH_ENGINES } from './url'

/** Everything the menu needs to know about the thing that was clicked. */
export interface ContextInfo {
  /** position in the shell's viewport (already translated out of any nested frames) */
  x: number
  y: number
  linkUrl: string | null
  imageUrl: string | null
  selection: string
  editable: boolean
  /** the window the click happened in, so clipboard commands run in the right document */
  win: Window | null
  /** the element to act on for editable fields */
  element: Element | null
  /** the picture under the pointer (for "Describe image") */
  imageElement?: Element | null
  /** the click was on page content (a tab's view) rather than on Shasta's own chrome */
  inPage: boolean
  /** clipboard commands for a page the shell cannot reach into (a direct tab); `win` is null then */
  exec?: (cmd: 'cut' | 'copy' | 'paste' | 'selectAll') => Promise<void>
}

export interface TabContext {
  tabId: string
  url: string
  external: boolean
  canBack: boolean
  canForward: boolean
  bookmarked: boolean
  engine: SearchEngine
}

export interface MenuActions {
  back: () => void
  forward: () => void
  reload: () => void
  print: () => void
  toggleBookmark: () => void
  openTab: (url: string, background: boolean) => void
  copyText: (text: string) => void
  search: (url: string) => void
  clipboard: (cmd: 'cut' | 'copy' | 'paste' | 'selectAll') => void
  /** on-device AI entries; absent when the person turned them off */
  ai?: {
    explain: (selection: string) => void
    summarizePage: () => void
    describeImage: (img: Element) => void
  }
}

export type MenuItem = { type: 'item'; id: string; label: string; shortcut?: string; disabled?: boolean; run: () => void } | { type: 'separator'; id: string }

const web = (u: string | null): u is string => !!u && /^https?:/i.test(u)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s)

/**
 * Link actions first, then image, selection, editing, and finally the page itself (back / forward / reload...).
 * Deliberately no "Inspect" or "View source".
 */
export function menuItems(info: ContextInfo, tab: TabContext, act: MenuActions, keys: { reload?: string } = {}): MenuItem[] {
  const out: MenuItem[] = []
  const sep = () => {
    if (out.length && out[out.length - 1].type !== 'separator') out.push({ type: 'separator', id: `sep-${out.length}` })
  }
  const item = (id: string, label: string, run: () => void, extra: Partial<Extract<MenuItem, { type: 'item' }>> = {}) => out.push({ type: 'item', id, label, run, ...extra })

  if (web(info.linkUrl)) {
    const link = info.linkUrl
    item('open-link', 'Open link in new tab', () => act.openTab(link, false))
    item('open-link-bg', 'Open link in background tab', () => act.openTab(link, true))
    item('copy-link', 'Copy link address', () => act.copyText(link))
    sep()
  }
  if (web(info.imageUrl)) {
    const img = info.imageUrl
    item('open-image', 'Open image in new tab', () => act.openTab(img, false))
    item('copy-image', 'Copy image address', () => act.copyText(img))
    const el = info.imageElement
    if (act.ai && el) item('ai-describe-image', 'Describe image with Shasta AI', () => act.ai!.describeImage(el))
    sep()
  }

  const hasSelection = info.selection.trim().length > 0
  if (info.editable) {
    item('cut', 'Cut', () => act.clipboard('cut'), { disabled: !hasSelection, shortcut: '⌘X' })
    item('copy', 'Copy', () => act.clipboard('copy'), { disabled: !hasSelection, shortcut: '⌘C' })
    item('paste', 'Paste', () => act.clipboard('paste'), { shortcut: '⌘V' })
    item('select-all', 'Select all', () => act.clipboard('selectAll'), { shortcut: '⌘A' })
    sep()
  } else if (hasSelection) {
    item('copy', 'Copy', () => act.clipboard('copy'), { shortcut: '⌘C' })
    item('search-selection', `Search ${SEARCH_ENGINES[tab.engine].label} for “${clip(info.selection.trim(), 28)}”`, () => act.search(searchUrl(info.selection.trim(), tab.engine)))
    if (act.ai) item('ai-explain', 'Explain with Shasta AI', () => act.ai!.explain(info.selection.trim()))
    sep()
  }

  // page-level entries belong to a tab's view, not to Shasta's own toolbar, and only when nothing more specific was clicked
  if (info.inPage && !info.editable) {
    item('back', 'Back', act.back, { disabled: !tab.canBack, shortcut: '⌥←' })
    item('forward', 'Forward', act.forward, { disabled: !tab.canForward, shortcut: '⌥→' })
    item('reload', 'Reload', act.reload, { disabled: !tab.external, shortcut: keys.reload })
    if (tab.external) {
      sep()
      item('bookmark', tab.bookmarked ? 'Remove bookmark' : 'Bookmark this page', act.toggleBookmark)
      item('copy-address', 'Copy page address', () => act.copyText(tab.url))
      item('print', 'Print…', act.print)
      if (act.ai) {
        sep()
        item('ai-summarize', 'Summarize this page with Shasta AI', act.ai.summarizePage)
      }
    }
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop()
  return out
}
