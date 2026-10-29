import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { motion } from 'motion/react'
import { Bookmark, Copy, Download, Minus, Plus, X, Maximize2, Pin, VenetianMask } from 'lucide-react'
import { IconButton } from './IconButton'
import { Favicon } from './Favicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTabs } from '@/stores/tabsStore'
import { useLibrary } from '@/stores/libraryStore'
import { useUi } from '@/stores/uiStore'
import { ACCENTS, type AccentName } from '@/stores/settingsStore'
import { tabTitle, tabUrl, type Tab, type TabGroup } from '@/lib/tabModel'
import { isInternalUrl } from '@/lib/url'
import { keysFor, perform } from '@/lib/shortcuts'
import { requestPrivateTab } from '@/lib/privateTab'
import { useActiveTab } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'

function TrafficLights() {
  const fullscreen = useUi((s) => s.fullscreen)
  const setChromeHidden = useUi((s) => s.setChromeHidden)
  const activeId = useTabs((s) => s.activeId)
  if (fullscreen) return null
  // 24 px hit area (WCAG target size) around the 12 px dot
  const dot = 'group/dot grid size-6 place-items-center rounded-full text-black/60 outline-offset-0'
  const disc = 'grid size-3 place-items-center rounded-full'
  return (
    <div className="mr-1 flex shrink-0 items-center self-center" role="group" aria-label="Window controls">
      <button aria-label="Close tab" title="Close tab" onClick={() => useTabs.getState().closeTab(activeId)} className={dot}>
        <span className={cn(disc, 'bg-[#ff5f57]')}>
          <X className="size-2 opacity-0 group-hover/dot:opacity-100" strokeWidth={3.5} />
        </span>
      </button>
      <button aria-label="Hide toolbar" title="Hide toolbar" onClick={() => setChromeHidden(true)} className={dot}>
        <span className={cn(disc, 'bg-[#febc2e]')}>
          <Minus className="size-2 opacity-0 group-hover/dot:opacity-100" strokeWidth={3.5} />
        </span>
      </button>
      <button aria-label="Toggle full screen" title="Toggle full screen" onClick={() => perform({ action: 'fullscreen' })} className={dot}>
        <span className={cn(disc, 'bg-[#28c840]')}>
          <Maximize2 className="size-2 opacity-0 group-hover/dot:opacity-100" strokeWidth={3.5} />
        </span>
      </button>
    </div>
  )
}

interface DropTarget {
  id: string
  side: 'before' | 'after'
}

interface TabItemProps {
  tab: Tab
  active: boolean
  group?: TabGroup
  groups: TabGroup[]
  tabIndex: number
  drop: DropTarget | null
  onDragStart: (id: string) => void
  onDragOver: (e: DragEvent, id: string) => void
  onDrop: (e: DragEvent) => void
  onDragEnd: () => void
  onKeyNav: (e: KeyboardEvent, id: string) => void
  onRename: (groupId: string) => void
}

const TabItem = memo(function TabItem({ tab, active, group, groups, tabIndex, drop, onDragStart, onDragOver, onDrop, onDragEnd, onKeyNav, onRename }: TabItemProps) {
  const url = tabUrl(tab)
  const title = tabTitle(tab)
  const s = useTabs.getState
  const bookmarked = useLibrary((st) => st.bookmarks.some((b) => b.type === 'bookmark' && b.url === url))
  const hasClosed = useTabs((st) => st.closed.length > 0)
  const external = !isInternalUrl(url)

  const label = `${title}${tab.loading ? ', loading' : ''}${tab.error ? ', failed to load' : ''}${tab.pinned ? ', pinned' : ''}${tab.suspended ? ', suspended' : ''}`

  return (
    <ContextMenu>
      <ContextMenuTrigger
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={active}
        aria-label={tab.private ? `Private tab: ${label}` : label}
        tabIndex={tabIndex}
        draggable
        title={tab.pinned ? title : `${title}\n${external ? url : ''}`.trim()}
        data-tab-id={tab.id}
        onClick={() => s().selectTab(tab.id)}
        onKeyDown={(e) => onKeyNav(e, tab.id)}
        onAuxClick={(e: MouseEvent) => {
          if (e.button === 1) {
            e.preventDefault()
            s().closeTab(tab.id)
          }
        }}
        onMouseDown={(e: MouseEvent) => e.button === 1 && e.preventDefault()}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/x-shasta-tab', tab.id)
          if (external) e.dataTransfer.setData('text/uri-list', url)
          onDragStart(tab.id)
        }}
        onDragOver={(e: DragEvent) => onDragOver(e, tab.id)}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={cn(
          'group relative flex h-tab-h cursor-default items-center gap-2 text-[13px] outline-offset-[-2px] transition-colors',
          tab.pinned ? 'size-[calc(var(--sh-tab-h)-0.5rem)] shrink-0 justify-center rounded-lg px-0' : 'w-52 min-w-28 shrink px-3',
          !tab.pinned && (active ? 'rounded-t-[14px] border border-b-0 border-shasta-line bg-shasta-bg' : 'mb-1 h-[calc(var(--sh-tab-h)-0.25rem)] rounded-xl border border-white/10 bg-white/[.04]'),
          active ? 'text-shasta-fg' : 'text-shasta-muted hover:bg-shasta-hover',
          tab.pinned && active && 'bg-white/10',
          tab.suspended && !active && 'opacity-70',
          drop?.id === tab.id && drop.side === 'before' && 'shadow-[inset_2px_0_0_var(--sh-accent)]',
          drop?.id === tab.id && drop.side === 'after' && 'shadow-[inset_-2px_0_0_var(--sh-accent)]',
        )}
        style={group ? { borderTop: `2px solid ${ACCENTS[group.color].swatch}` } : undefined}
      >
        {tab.private && <VenetianMask className="size-4 shrink-0 text-shasta-accent" role="img" aria-label="Private tab" />}
        <Favicon url={url} loading={tab.loading} error={!!tab.error} appIcon={tab.app?.iconUrl} />
        {!tab.pinned && (
          <>
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <button
              aria-label={`Close ${title}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                s().closeTab(tab.id)
              }}
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full text-shasta-muted hover:bg-shasta-line hover:text-shasta-fg',
                !active && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => s().newTab(undefined, { afterId: tab.id })}>New tab to the right</ContextMenuItem>
        <ContextMenuItem onClick={() => requestPrivateTab()}>New private tab</ContextMenuItem>
        <ContextMenuSeparator />
        {external && <ContextMenuItem onClick={() => s().reload(tab.id)}>Reload</ContextMenuItem>}
        <ContextMenuItem onClick={() => s().duplicateTab(tab.id)}>Duplicate</ContextMenuItem>
        <ContextMenuItem onClick={() => s().pinTab(tab.id, !tab.pinned)}>{tab.pinned ? 'Unpin tab' : 'Pin tab'}</ContextMenuItem>
        {external && !tab.private && (
          <ContextMenuItem
            onClick={() => {
              const lib = useLibrary.getState()
              if (bookmarked) lib.bookmarks.filter((b) => b.type === 'bookmark' && b.url === url).forEach((b) => lib.removeNode(b.id))
              else lib.addBookmark({ url, title })
            }}
          >
            {bookmarked ? 'Remove bookmark' : 'Bookmark this tab'}
          </ContextMenuItem>
        )}
        {!tab.pinned && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Add to group</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => s().groupTabs([tab.id])}>New group</ContextMenuItem>
              {groups.filter((g) => g.id !== tab.groupId).map((g) => (
                <ContextMenuItem key={g.id} onClick={() => s().addToGroup(tab.id, g.id)}>
                  <span className="size-2.5 rounded-full" style={{ background: ACCENTS[g.color].swatch }} />
                  {g.title || 'Untitled group'}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {tab.groupId && (
          <>
            <ContextMenuItem onClick={() => s().ungroupTab(tab.id)}>Remove from group</ContextMenuItem>
            <ContextMenuItem onClick={() => onRename(tab.groupId!)}>Rename group…</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => s().closeTab(tab.id)}>Close</ContextMenuItem>
        <ContextMenuItem onClick={() => s().closeOthers(tab.id)}>Close other tabs</ContextMenuItem>
        <ContextMenuItem onClick={() => s().closeToRight(tab.id)}>Close tabs to the right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!hasClosed} onClick={() => s().reopenClosed()}>
          Reopen closed tab
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

function GroupChip({ group, onRename }: { group: TabGroup; onRename: (id: string) => void }) {
  const toggle = useTabs((s) => s.toggleGroup)
  const color = ACCENTS[group.color].swatch
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            aria-expanded={!group.collapsed}
            aria-label={`${group.title || 'Untitled group'} group, ${group.collapsed ? 'collapsed' : 'expanded'}`}
            onClick={() => toggle(group.id)}
            className="mr-0.5 mb-1 flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-black/80 transition-[filter] hover:brightness-110"
            style={{ background: color }}
          />
        }
      >
        {group.title || <span className="size-2 rounded-full bg-black/30" />}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRename(group.id)}>Rename or recolor…</ContextMenuItem>
        <ContextMenuItem onClick={() => toggle(group.id)}>{group.collapsed ? 'Expand group' : 'Collapse group'}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => useTabs.getState().closeGroup(group.id)}>Close group</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function GroupDialog({ groupId, onClose }: { groupId: string | null; onClose: () => void }) {
  const group = useTabs((s) => s.groups.find((g) => g.id === groupId))
  const update = useTabs((s) => s.updateGroup)
  const ungroupAll = (id: string) =>
    useTabs.getState().tabs.filter((t) => t.groupId === id).forEach((t) => useTabs.getState().ungroupTab(t.id))
  const [title, setTitle] = useState('')
  const [seeded, setSeeded] = useState<string | null>(null)
  if (group && seeded !== group.id) {
    setSeeded(group.id)
    setTitle(group.title)
  }
  return (
    <Dialog open={!!group} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Edit group</DialogTitle>
        </DialogHeader>
        {group && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              update(group.id, { title: title.trim() })
              onClose()
            }}
          >
            <Input autoFocus aria-label="Group name" placeholder="Name this group" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
            <div className="flex gap-2" role="radiogroup" aria-label="Group colour">
              {(Object.keys(ACCENTS) as AccentName[]).map((c) => (
                <button
                  type="button"
                  key={c}
                  role="radio"
                  aria-checked={group.color === c}
                  aria-label={ACCENTS[c].label}
                  onClick={() => update(group.id, { color: c })}
                  className={cn('size-6 rounded-full ring-offset-2 ring-offset-popover', group.color === c && 'ring-2 ring-foreground')}
                  style={{ background: ACCENTS[c].swatch }}
                />
              ))}
            </div>
            <div className="flex justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  ungroupAll(group.id)
                  onClose()
                }}
              >
                Ungroup
              </Button>
              <Button type="submit">Done</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TabSearch() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const closed = useTabs((s) => s.closed)
  const select = useTabs((s) => s.selectTab)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Search tabs"
        title="Search tabs"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg"
      >
        <Copy className="size-[17px]" strokeWidth={1.6} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Open tabs ({tabs.length})</DropdownMenuLabel>
          {tabs.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => select(t.id)} className={cn(t.id === activeId && 'bg-shasta-hover')}>
              <Favicon url={tabUrl(t)} loading={t.loading} error={!!t.error} appIcon={t.app?.iconUrl} />
              <span className="min-w-0 flex-1 truncate">{tabTitle(t)}</span>
              {t.pinned && <Pin className="size-3 text-shasta-muted" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {closed.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recently closed</DropdownMenuLabel>
              {closed.slice(0, 5).map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => useTabs.getState().reopenClosed()}>
                  <Favicon url={c.url} />
                  <span className="min-w-0 flex-1 truncate">{c.title || c.url}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Bookmark, downloads, new tab and the tab list: small rounded pods at the right end of the strip. */
function StripActions() {
  const tab = useActiveTab()
  const external = !isInternalUrl(tabUrl(tab))
  const newTab = useTabs((s) => s.newTab)
  const openInternal = useTabs((s) => s.openInternal)
  const pod = 'mb-1 flex h-[calc(var(--sh-tab-h)-0.25rem)] shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/[.05] px-1'
  const btn = 'size-7 rounded-lg'
  return (
    <div className="flex shrink-0 items-end gap-2">
      <div className={pod}>
        <IconButton label="Bookmark this page" className={btn} disabled={!external || tab.private} onClick={() => useUi.getState().openBookmarkEditor()}>
          <Bookmark className="size-[17px]" strokeWidth={1.6} />
        </IconButton>
      </div>
      <div className={pod}>
        <IconButton label="Downloads" className={btn} onClick={() => openInternal('downloads')}>
          <Download className="size-[17px]" strokeWidth={1.6} />
        </IconButton>
      </div>
      <div className={pod}>
        <IconButton label="New tab" shortcut={keysFor('newTab')} className={btn} onClick={() => { newTab(undefined, { atEnd: true }); useUi.getState().requestOmniboxFocus() }}>
          <Plus className="size-[18px]" strokeWidth={1.6} />
        </IconButton>
        <TabSearch />
      </div>
    </div>
  )
}

export function TabBar() {
  const tabs = useTabs((s) => s.tabs)
  const groups = useTabs((s) => s.groups)
  const activeId = useTabs((s) => s.activeId)
  const newTab = useTabs((s) => s.newTab)
  const moveTab = useTabs((s) => s.moveTab)
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [editGroup, setEditGroup] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // keep the active tab in view when the strip overflows
  useEffect(() => {
    listRef.current?.querySelector(`[data-tab-id="${activeId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])

  const onDragOver = useCallback((e: DragEvent, id: string) => {
    if (!e.dataTransfer.types.includes('text/x-shasta-tab')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side = e.clientX > rect.left + rect.width / 2 ? 'after' : 'before'
    setDrop((d) => (d?.id === id && d.side === side ? d : { id, side }))
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const id = e.dataTransfer.getData('text/x-shasta-tab') || dragId
      const list = useTabs.getState().tabs
      const from = list.findIndex((t) => t.id === id)
      if (id && drop && from >= 0) {
        let to = list.findIndex((t) => t.id === drop.id) + (drop.side === 'after' ? 1 : 0)
        if (from < to) to -= 1
        moveTab(id, to)
      }
      setDragId(null)
      setDrop(null)
    },
    [dragId, drop, moveTab],
  )

  const onDragEnd = useCallback(() => {
    setDragId(null)
    setDrop(null)
  }, [])

  const onKeyNav = useCallback((e: KeyboardEvent, id: string) => {
    const { tabs: list, selectTab, closeTab } = useTabs.getState()
    const visible = list.filter((t) => !t.groupId || !useTabs.getState().groups.find((g) => g.id === t.groupId)?.collapsed)
    const i = visible.findIndex((t) => t.id === id)
    const go = (t: Tab | undefined) => {
      if (!t) return
      e.preventDefault()
      selectTab(t.id)
      requestAnimationFrame(() => document.getElementById(`tab-${t.id}`)?.focus())
    }
    if (e.key === 'ArrowRight') go(visible[(i + 1) % visible.length])
    else if (e.key === 'ArrowLeft') go(visible[(i - 1 + visible.length) % visible.length])
    else if (e.key === 'Home') go(visible[0])
    else if (e.key === 'End') go(visible[visible.length - 1])
    else if (e.key === 'Delete') {
      e.preventDefault()
      closeTab(id)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectTab(id)
    }
  }, [])

  const items: React.ReactNode[] = []
  const pinned: React.ReactNode[] = []
  let lastGroup: string | null = null
  tabs.forEach((tab, i) => {
    const group = tab.groupId ? groups.find((g) => g.id === tab.groupId) : undefined
    if (group && group.id !== lastGroup) items.push(<GroupChip key={`g-${group.id}`} group={group} onRename={setEditGroup} />)
    lastGroup = group?.id ?? null
    if (group?.collapsed) return
    ;(tab.pinned ? pinned : items).push(
      <motion.div key={tab.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14 }} className={cn('flex', tab.pinned ? 'shrink-0' : 'min-w-0 shrink')}>
        <TabItem
          tab={tab}
          active={tab.id === activeId}
          group={group}
          groups={groups}
          tabIndex={tab.id === activeId ? 0 : -1}
          drop={drop}
          onDragStart={setDragId}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onKeyNav={onKeyNav}
          onRename={setEditGroup}
        />
      </motion.div>,
    )
    void i
  })

  return (
    <div
      className="relative flex items-end gap-2 bg-shasta-chrome px-3 pt-2.5 select-none after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-shasta-line"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).dataset.stripBlank !== undefined) newTab(undefined, { atEnd: true })
      }}
    >
      <TrafficLights />
      {pinned.length > 0 && (
        <div role="group" aria-label="Pinned tabs" className="mb-1 flex h-[calc(var(--sh-tab-h)-0.25rem)] shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/[.05] px-1">
          {pinned}
        </div>
      )}
      <div ref={listRef} role="tablist" aria-label="Open tabs" aria-orientation="horizontal" className="no-scrollbar relative z-[1] flex min-w-0 items-end gap-1 overflow-x-auto" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}>
        {items}
      </div>
      <div data-strip-blank className="h-tab-h min-w-6 flex-1" />
      <StripActions />
      <GroupDialog groupId={editGroup} onClose={() => setEditGroup(null)} />
    </div>
  )
}
