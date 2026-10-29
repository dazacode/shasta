import { useMemo, useRef, useState } from 'react'
import { ChevronRight, Download, Folder, FolderPlus, Pencil, Search, Star, Trash2, Upload } from 'lucide-react'
import { PageShell, EmptyState } from './PageShell'
import { Favicon } from '@/components/browser/Favicon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useLibrary, childrenOf, exportBookmarksHtml, type BookmarkNode } from '@/stores/libraryStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { displayUrl, resolveInput } from '@/lib/url'

function pathTo(nodes: BookmarkNode[], id: string | null): BookmarkNode[] {
  const out: BookmarkNode[] = []
  let cur = id
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = nodes.find((x) => x.id === cur)
    if (!n) break
    out.unshift(n)
    cur = n.parentId
  }
  return out
}

function folderOptions(nodes: BookmarkNode[], exclude: string | null) {
  const out: { id: string | null; label: string }[] = [{ id: null, label: 'Bookmarks' }]
  const walk = (parent: string | null, depth: number) => {
    for (const n of childrenOf(nodes, parent)) {
      if (n.type !== 'folder' || n.id === exclude) continue
      out.push({ id: n.id, label: `${'  '.repeat(depth + 1)}${n.title}` })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function EditDialog({ node, onClose }: { node: BookmarkNode | 'new-folder' | null; onClose: () => void }) {
  const nodes = useLibrary((s) => s.bookmarks)
  const { updateNode, addFolder } = useLibrary.getState()
  const existing = node && node !== 'new-folder' ? node : null
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [seed, setSeed] = useState<unknown>(null)
  if (node !== seed) {
    setSeed(node)
    setTitle(existing?.title ?? '')
    setUrl(existing?.type === 'bookmark' ? existing.url : '')
    setParentId(existing?.parentId ?? null)
    setError('')
  }

  const save = () => {
    if (node === 'new-folder') addFolder(title, parentId)
    else if (existing) {
      let nextUrl: string | undefined
      if (existing.type === 'bookmark') {
        const r = resolveInput(url, 'google')
        if (r.kind !== 'url') return setError('Enter a valid web address')
        nextUrl = r.url
      }
      updateNode(existing.id, { title: title.trim() || existing.title, parentId, ...(nextUrl ? { url: nextUrl } : {}) })
    }
    onClose()
  }

  return (
    <Dialog open={node !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{node === 'new-folder' ? 'New folder' : existing?.type === 'folder' ? 'Rename folder' : 'Edit bookmark'}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Name
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {existing?.type === 'bookmark' && (
            <label className="grid gap-1 text-xs text-muted-foreground">
              Address
              <Input value={url} onChange={(e) => { setUrl(e.target.value); setError('') }} aria-invalid={!!error} spellCheck={false} />
            </label>
          )}
          <label className="grid gap-1 text-xs text-muted-foreground">
            Folder
            <select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)} className="h-9 rounded-md border border-input bg-popover px-2 text-sm text-foreground">
              {folderOptions(nodes, existing?.id ?? null).map((o) => (
                <option key={o.id ?? 'root'} value={o.id ?? ''}>{o.label}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function BookmarksPage() {
  const nodes = useLibrary((s) => s.bookmarks)
  const remove = useLibrary((s) => s.removeNode)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<BookmarkNode | 'new-folder' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // a deleted folder must not leave the page looking at a folder that no longer exists
  const currentId = folderId && nodes.some((n) => n.id === folderId) ? folderId : null
  const crumbs = pathTo(nodes, currentId)
  const q = query.trim().toLowerCase()
  const rows = useMemo(
    () => (q ? nodes.filter((n) => n.type === 'bookmark' && (n.title.toLowerCase().includes(q) || n.url.toLowerCase().includes(q))) : childrenOf(nodes, currentId)),
    [nodes, q, currentId],
  )

  const open = (e: React.MouseEvent, url: string) => {
    const tabs = useTabs.getState()
    if (e.metaKey || e.ctrlKey) tabs.newTab(url, { background: true })
    else tabs.navigateTo(tabs.activeId, url)
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const count = useLibrary.getState().importBookmarks(await file.text())
      useUi.getState().toast(count ? `Imported ${count} bookmark${count === 1 ? '' : 's'}` : 'No bookmarks were found in that file', { tone: count ? 'success' : 'error' })
    } catch {
      useUi.getState().toast('That file could not be read', { tone: 'error' })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const onExport = () => {
    const blob = new Blob([exportBookmarksHtml(nodes)], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'shasta-bookmarks.html'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  return (
    <PageShell
      title="Bookmarks"
      subtitle={`${nodes.filter((n) => n.type === 'bookmark').length} saved`}
      actions={
        <>
          <Button variant="outline" onClick={() => setEditing('new-folder')}><FolderPlus /> New folder</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Import</Button>
          <Button variant="outline" disabled={!nodes.length} onClick={onExport}><Download /> Export</Button>
          <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="sr-only" aria-label="Import bookmarks file" onChange={(e) => void onImport(e.target.files?.[0])} tabIndex={-1} />
        </>
      }
    >
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-shasta-muted" />
        <input type="search" aria-label="Search bookmarks" placeholder="Search bookmarks" value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 w-full rounded-full bg-shasta-field pr-4 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent/60" />
      </div>

      {!q && (
        <nav aria-label="Folder path" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => setFolderId(null)} className="rounded-md px-1.5 py-0.5 hover:bg-shasta-hover">Bookmarks</button>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-shasta-muted" />
              <button onClick={() => setFolderId(c.id)} className="rounded-md px-1.5 py-0.5 hover:bg-shasta-hover">{c.title}</button>
            </span>
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Star className="size-6" />}
          title={q ? 'No matching bookmarks' : currentId ? 'This folder is empty' : 'No bookmarks yet'}
          body={q ? 'Try a different search term.' : 'Press the star in the address bar (or Ctrl/⌘+D) to save a page, or import a bookmarks file from another browser.'}
        />
      ) : (
        <ul>
          {rows.map((n) => (
            <li key={n.id} className="group flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-shasta-hover">
              {n.type === 'folder' ? (
                <button onClick={() => setFolderId(n.id)} className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left text-sm">
                  <Folder className="size-4 shrink-0 text-shasta-accent" />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="text-xs text-shasta-muted">{nodes.filter((c) => c.parentId === n.id).length} items</span>
                </button>
              ) : (
                <button onClick={(e) => open(e, n.url)} onAuxClick={(e) => e.button === 1 && useTabs.getState().newTab(n.url, { background: true })} className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left text-sm" title={n.url}>
                  <Favicon url={n.url} />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="hidden max-w-[40%] truncate text-xs text-shasta-muted sm:block">{displayUrl(n.url)}</span>
                </button>
              )}
              <button aria-label={`Edit ${n.title}`} onClick={() => setEditing(n)} className="grid size-7 place-items-center rounded-full text-shasta-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-shasta-line hover:text-shasta-fg">
                <Pencil className="size-4" />
              </button>
              <button aria-label={`Delete ${n.title}`} onClick={() => remove(n.id)} className="grid size-7 place-items-center rounded-full text-shasta-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-shasta-line hover:text-shasta-danger">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <EditDialog node={editing} onClose={() => setEditing(null)} />
    </PageShell>
  )
}
