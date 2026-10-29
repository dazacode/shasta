import { ChevronRight, Folder as FolderIcon } from 'lucide-react'
import { Favicon } from './Favicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useLibrary, childrenOf, type BookmarkNode } from '@/stores/libraryStore'
import { useTabs, useActiveTab } from '@/stores/tabsStore'

function MenuNodes({ nodes, parentId }: { nodes: BookmarkNode[]; parentId: string | null }) {
  const kids = childrenOf(nodes, parentId)
  if (!kids.length) return <div className="px-2 py-1.5 text-xs text-muted-foreground">Empty</div>
  return (
    <>
      {kids.map((n) =>
        n.type === 'folder' ? (
          <DropdownMenuSub key={n.id}>
            <DropdownMenuSubTrigger>
              <FolderIcon /> {n.title}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <MenuNodes nodes={nodes} parentId={n.id} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem key={n.id} onClick={() => useTabs.getState().navigateTo(useTabs.getState().activeId, n.url)}>
            <Favicon url={n.url} /> <span className="max-w-64 truncate">{n.title}</span>
          </DropdownMenuItem>
        ),
      )}
    </>
  )
}

export function BookmarksBar() {
  const nodes = useLibrary((s) => s.bookmarks)
  const tab = useActiveTab()
  const roots = childrenOf(nodes, null)

  return (
    <nav aria-label="Bookmarks bar" className="flex h-8 items-center gap-0.5 overflow-hidden border-t border-shasta-line bg-shasta-tab px-2 text-[13px]">
      {roots.length === 0 && <span className="px-2 text-xs text-shasta-muted">Bookmarks you save appear here. Press the star in the address bar.</span>}
      {roots.map((n) =>
        n.type === 'folder' ? (
          <DropdownMenu key={n.id}>
            <DropdownMenuTrigger className="flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-shasta-fg hover:bg-shasta-hover">
              <FolderIcon className="size-3.5 text-shasta-muted" />
              <span className="truncate">{n.title}</span>
              <ChevronRight className="size-3 rotate-90 text-shasta-muted" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <MenuNodes nodes={nodes} parentId={n.id} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <ContextMenu key={n.id}>
            <ContextMenuTrigger
              render={
                <button
                  title={`${n.title}\n${n.url}`}
                  onClick={(e) => (e.metaKey || e.ctrlKey ? useTabs.getState().newTab(n.url, { background: true }) : useTabs.getState().navigateTo(tab.id, n.url))}
                  onAuxClick={(e) => e.button === 1 && useTabs.getState().newTab(n.url, { background: true })}
                  className="flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-shasta-fg hover:bg-shasta-hover"
                />
              }
            >
              <Favicon url={n.url} />
              <span className="truncate">{n.title}</span>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => useTabs.getState().newTab(n.url)}>Open in new tab</ContextMenuItem>
              <ContextMenuItem onClick={() => useTabs.getState().openInternal('bookmarks')}>Manage bookmarks</ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={() => useLibrary.getState().removeNode(n.id)}>
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ),
      )}
    </nav>
  )
}
