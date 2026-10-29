import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as proxy from '@/proxy/scramjetAdapter'
import { menuItems, type MenuActions, type MenuItem, type TabContext } from '@/lib/contextMenu'
import { runClipboard } from '@/lib/contextTarget'
import { isMac, keysFor } from '@/lib/shortcuts'
import { NO_PRIVATE_BOOKMARKS } from '@/hooks/usePrivateTab'
import { canGoBack, canGoForward, tabUrl } from '@/lib/tabModel'
import { isInternalUrl } from '@/lib/url'
import { useLibrary } from '@/stores/libraryStore'
import { getSettings } from '@/stores/settingsStore'
import { explainPrompt, quickPrompt } from '@/ai/prompts'
import { imageToBlob } from '@/ai/pageContext'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const fmt = (s?: string) => (s && !isMac ? s.replace('⌘', 'Ctrl+').replace('⌥←', 'Alt+←').replace('⌥→', 'Alt+→') : s)

/**
 * Shasta's own right-click menu. It replaces the browser's menu everywhere (proxied pages, Shasta's pages, the address
 * bar), so there is no "Inspect" and no "View source" in it.
 */
export function PageContextMenu() {
  const menu = useUi((s) => s.contextMenu)
  const close = useUi((s) => s.closeContextMenu)
  const activeId = useTabs((s) => s.activeId)
  const bookmarks = useLibrary((s) => s.bookmarks)
  const ref = useRef<HTMLUListElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const items = useMemo<MenuItem[]>(() => {
    if (!menu) return []
    const tab = useTabs.getState().tabs.find((t) => t.id === menu.tabId)
    if (!tab) return []
    const url = tabUrl(tab)
    const ctx: TabContext = {
      tabId: tab.id,
      url,
      external: !isInternalUrl(url),
      canBack: canGoBack(tab),
      canForward: canGoForward(tab),
      bookmarked: bookmarks.some((b) => b.type === 'bookmark' && b.url === url),
      engine: getSettings().searchEngine,
    }
    const t = useTabs.getState()
    const toast = useUi.getState().toast
    const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast('Copied.'), () => toast('Your browser did not allow Shasta to copy.', { tone: 'error' }))
    const act: MenuActions = {
      back: () => t.back(tab.id),
      forward: () => t.forward(tab.id),
      reload: () => t.reload(tab.id),
      print: () => proxy.print(tab.id),
      toggleBookmark: () => {
        if (tab.private) return toast(NO_PRIVATE_BOOKMARKS)
        const added = useLibrary.getState().toggleBookmark(url, tab.entries[tab.index].title)
        toast(added ? 'Bookmark added.' : 'Bookmark removed.')
      },
      openTab: (link, background) => t.newTab(link, { background, afterId: tab.id }),
      copyText: copy,
      search: (target) => t.newTab(target, { afterId: tab.id }),
      clipboard: (cmd) => void runClipboard(menu.info, cmd).catch((e: Error) => toast(e.message, { tone: 'error' })),
      ai: getSettings().ai.enabled && getSettings().ai.contextMenu
        ? {
            explain: (selection) => useUi.getState().openAssistant({ text: explainPrompt(selection), label: `Explain: “${selection.slice(0, 80)}”` }),
            summarizePage: () => useUi.getState().openAssistant({ text: quickPrompt('summarize'), withPage: true, label: 'Summarize this page' }),
            describeImage: (el) =>
              void imageToBlob(el).then(
                (image) => useUi.getState().openAssistant({ text: 'Describe this image in detail. Read out any text that is visible.', image, label: 'Describe this image' }),
                () => toast("Shasta couldn't read that image. Save it and attach it in the assistant instead.", { tone: 'error' }),
              ),
          }
        : undefined,
    }
    return menuItems(menu.info, ctx, act, { reload: keysFor('reload') })
  }, [menu, bookmarks])

  // keep the menu on screen
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(menu.info.x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(menu.info.y, window.innerHeight - r.height - 4)) })
    ref.current.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus()
  }, [menu, items])

  useEffect(() => {
    if (!menu) return
    const off = () => close()
    window.addEventListener('blur', off)
    window.addEventListener('resize', off)
    return () => {
      window.removeEventListener('blur', off)
      window.removeEventListener('resize', off)
    }
  }, [menu, close])

  // switching tabs (or the tab closing) dismisses it
  useEffect(() => {
    close()
  }, [activeId, close])

  if (!menu || items.length === 0) return null

  const onKey = (e: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      buttons[e.key === 'Home' ? 0 : buttons.length - 1]?.focus()
    }
  }

  return (
    <>
      {/* a click anywhere else (even over a page frame, which would swallow it) just dismisses the menu */}
      <div className="fixed inset-0 z-[70]" onPointerDown={close} onContextMenu={(e) => (e.preventDefault(), close())} />
      <ul
        ref={ref}
        role="menu"
        aria-label="Page menu"
        onKeyDown={onKey}
        style={{ left: pos.left, top: pos.top }}
        className="fixed z-[71] min-w-52 rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10"
      >
        {items.map((it) =>
          it.type === 'separator' ? (
            <li key={it.id} role="separator" className="my-1 h-px bg-shasta-line" />
          ) : (
            <li key={it.id} role="none">
              <button
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  close()
                  it.run()
                }}
                className={cn('flex w-full items-center justify-between gap-6 rounded-lg px-3 py-1.5 text-left outline-none', it.disabled ? 'opacity-40' : 'hover:bg-shasta-hover focus-visible:bg-shasta-hover')}
              >
                <span className="truncate">{it.label}</span>
                {it.shortcut && <span className="shrink-0 text-xs text-muted-foreground">{fmt(it.shortcut)}</span>}
              </button>
            </li>
          ),
        )}
      </ul>
    </>
  )
}
