import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, FolderPlus, Heart, MoreHorizontal, Pencil, Pin, PinOff, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useUi } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { errorMessage } from './api'
import { timeAgo } from './hooks'
import { useStore } from './storeStore'
import { appPath, useStoreNav } from './nav'
import { AppIcon, AppRow, Chip, Message, Section, StoreTile, addressOf } from './components'
import { UninstallDialog } from './UninstallDialog'
import type { InstalledApp } from './types'

// the empty Library's demo (install -> into the Library -> open), loaded only when the Library is empty
const LibraryDemo = lazy(() => import('@/components/demos/LibraryDemo'))

type Sort = 'recent' | 'name' | 'category'

function LauncherTile({ item, folders, onUninstall, onChanged }: { item: InstalledApp; folders: { id: string; name: string }[]; onUninstall: () => void; onChanged: () => void }) {
  const { go } = useStoreNav()
  const { launch, update } = useStore.getState()
  const app = item.app
  const patch = async (body: { pinned?: boolean; folderId?: string | null }) => {
    try {
      if (body.pinned !== undefined) await useStore.getState().setPinned(app.id, body.pinned)
      if (body.folderId !== undefined) await useStore.getState().moveToFolder(app.id, body.folderId)
      onChanged()
    } catch (e) {
      useUi.getState().toast(errorMessage(e), { tone: 'error' })
    }
  }
  return (
    <div className={cn('group relative flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition-colors duration-150 ease-shasta hover:bg-shasta-hover', !item.available && 'opacity-70')}>
      <button
        onClick={() => (item.available ? void launch(app.id) : go(appPath(app.slug)))}
        aria-label={item.available ? `Open ${app.name}${item.updateAvailable ? ' (update available)' : ''}` : `${app.name} is unavailable`}
        className="flex w-full flex-col items-center gap-2 rounded-xl"
      >
        <span className="relative">
          <AppIcon app={app} size={76} className="shadow-sm ring-1 ring-shasta-line" />
          {item.updateAvailable && <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-shasta-accent text-shasta-accent-fg ring-2 ring-shasta-bg" title="Update available"><RefreshCw className="size-3" aria-hidden /></span>}
          {!item.available && <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-shasta-warn text-black ring-2 ring-shasta-bg" title={item.unavailableReason ?? ''}><AlertTriangle className="size-3" aria-hidden /></span>}
          {item.pinned && <Pin className="absolute -bottom-1 -left-1 size-4 rounded-full bg-shasta-bg p-0.5 text-shasta-muted" aria-label="Pinned" />}
        </span>
        <span className="w-full truncate text-sm font-medium">{app.name}</span>
        <span className={cn('w-full truncate', item.available && !item.updateAvailable ? 'sh-meta' : 'text-xs text-shasta-muted')}>{item.available ? (item.updateAvailable ? (item.canStay ? `Update ${item.latestVersion} available` : `Updates to ${item.latestVersion} on open`) : addressOf(app)) : item.unavailableReason}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`More options for ${app.name}`} className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg bg-shasta-bg/80 text-shasta-muted opacity-0 transition-opacity duration-150 ease-shasta group-focus-within:opacity-100 group-hover:opacity-100 hover:text-shasta-fg">
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {item.available && <DropdownMenuItem onClick={() => void launch(app.id)}>Open</DropdownMenuItem>}
          {item.updateAvailable && <DropdownMenuItem onClick={() => void update(app.id)}>Update to {item.latestVersion}{item.canStay ? ' (optional)' : ''}</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => go(appPath(app.slug))}>View in Store</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void patch({ pinned: !item.pinned })}>{item.pinned ? <><PinOff /> Unpin</> : <><Pin /> Pin to top</>}</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {item.folderId && <DropdownMenuItem onClick={() => void patch({ folderId: null })}>Remove from folder</DropdownMenuItem>}
              {folders.filter((f) => f.id !== item.folderId).map((f) => <DropdownMenuItem key={f.id} onClick={() => void patch({ folderId: f.id })}>{f.name}</DropdownMenuItem>)}
              {folders.length === 0 && <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onUninstall} className="text-shasta-danger"><Trash2 /> Uninstall…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function FolderDialog({ folder, onClose }: { folder: { id: string; name: string } | 'new' | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [seed, setSeed] = useState<unknown>(null)
  const [error, setError] = useState('')
  if (folder !== seed) {
    setSeed(folder)
    setName(folder && folder !== 'new' ? folder.name : '')
    setError('')
  }
  const save = async () => {
    try {
      if (folder === 'new') await useStore.getState().createFolder(name)
      else if (folder) await useStore.getState().renameFolder(folder.id, name)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <Dialog open={folder !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{folder === 'new' ? 'New folder' : 'Rename folder'}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => (e.preventDefault(), void save())} className="grid gap-3">
          <Input autoFocus aria-label="Folder name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Folder name" />
          {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!name.trim()}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function MyApps({ actions }: { actions?: ReactNode }) {
  const { go } = useStoreNav()
  const library = useStore((s) => s.library)
  const error = useStore((s) => s.libraryError)
  const [tab, setTab] = useState<'apps' | 'favorites' | 'following'>('apps')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [folder, setFolder] = useState<string>('all')
  const [removing, setRemoving] = useState<InstalledApp | null>(null)
  const [folderDlg, setFolderDlg] = useState<{ id: string; name: string } | 'new' | null>(null)
  const [checking, setChecking] = useState(false)
  const refresh = () => void useStore.getState().refreshLibrary()

  const installed = library?.installed ?? []
  const folders = library?.folders ?? []
  const updates = installed.filter((i) => i.updateAvailable)
  const optional = updates.filter((i) => i.canStay)

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    let list = installed.filter((i) => (folder === 'all' || i.folderId === folder) && (!t || [i.app.name, i.app.developer, i.app.category?.name ?? ''].some((s) => s.toLowerCase().includes(t))))
    list = [...list].sort((a, b) =>
      sort === 'name' ? a.app.name.localeCompare(b.app.name) : sort === 'category' ? (a.app.category?.name ?? '~').localeCompare(b.app.category?.name ?? '~') || a.app.name.localeCompare(b.app.name) : (b.lastLaunchedAt ?? b.installedAt) - (a.lastLaunchedAt ?? a.installedAt),
    )
    return list
  }, [installed, q, sort, folder])

  const pinned = shown.filter((i) => i.pinned)
  const rest = shown.filter((i) => !i.pinned)
  const recent = sort === 'recent' && !q.trim() && folder === 'all' ? installed.filter((i) => i.lastLaunchedAt).sort((a, b) => b.lastLaunchedAt! - a.lastLaunchedAt!).slice(0, 6) : []

  const check = async () => {
    setChecking(true)
    await useStore.getState().refreshLibrary()
    const n = useStore.getState().library?.installed.filter((i) => i.updateAvailable).length ?? 0
    useUi.getState().toast(n ? `${n} update${n > 1 ? 's' : ''} available` : 'Everything is up to date', { tone: n ? 'info' : 'success' })
    setChecking(false)
  }

  const tile = (i: InstalledApp) => <LauncherTile key={i.app.id} item={i} folders={folders} onChanged={refresh} onUninstall={() => setRemoving(i)} />
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1'

  return (
    <div className="pt-2">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="sh-title">Library</h1>
          <p className="mt-1 text-sm text-shasta-muted tabular-nums">{`${installed.length} installed app${installed.length === 1 ? '' : 's'} on this device`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {installed.length > 0 && <Button variant="secondary" className="h-9 px-3" disabled={checking} onClick={check}><RefreshCw className={cn(checking && 'sh-spin')} /> Check for updates</Button>}
          {installed.length > 0 && <Button variant="secondary" className="h-9 px-3" onClick={() => setFolderDlg('new')}><FolderPlus /> New folder</Button>}
          {actions}
        </div>
      </div>

      <div className="mb-6 flex gap-2" role="tablist" aria-label="Library sections">
        <Chip active={tab === 'apps'} role="tab" aria-selected={tab === 'apps'} onClick={() => setTab('apps')}>Installed</Chip>
        <Chip active={tab === 'following'} role="tab" aria-selected={tab === 'following'} onClick={() => setTab('following')}>Following{library?.following.length ? <span className="font-mono text-xs text-shasta-faint tabular-nums">{library.following.length}</span> : null}</Chip>
        <Chip active={tab === 'favorites'} role="tab" aria-selected={tab === 'favorites'} onClick={() => setTab('favorites')}>Favorites{library?.favorites.length ? <span className="font-mono text-xs text-shasta-faint tabular-nums">{library.favorites.length}</span> : null}</Chip>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-shasta-danger/10 px-4 py-2 text-sm text-shasta-danger">{error}</p>}

      {tab === 'following' ? (
        library?.following.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">{library.following.map((s) => <StoreTile key={s.id} store={s} />)}</div>
        ) : (
          <Message title="You're not following any storefronts" body="Follow a publisher from their storefront to see their new releases on Discover." action={<Button onClick={() => go('/stores')}>Browse storefronts</Button>} />
        )
      ) : tab === 'favorites' ? (
        library?.favorites.length ? (
          <div className="max-w-3xl">{library.favorites.map((a) => <AppRow key={a.id} app={a} />)}</div>
        ) : (
          <Message icon={<Heart className="size-5" />} title="No favorites yet" body="Tap Favorite on an app's page to keep it here, even if you haven't installed it." action={<Button onClick={() => go('/')}>Discover apps</Button>} />
        )
      ) : installed.length === 0 ? (
        <div className="flex flex-col items-center pt-4 pb-8 text-center" role="status">
          <div className="mb-8 min-h-[200px] w-[600px] max-w-full" aria-hidden>
            <Suspense fallback={null}>
              <LibraryDemo />
            </Suspense>
          </div>
          <p className="sh-heading">Your library is empty</p>
          <p className="mt-2 max-w-md text-sm text-shasta-muted">Apps and games you install show up here, ready to launch. No account to create: your library lives on this device.</p>
          <Button className="mt-6 h-10 rounded-lg bg-shasta-accent px-4 text-shasta-accent-fg hover:bg-shasta-accent/85" onClick={() => go('/')}>Browse the Store</Button>
        </div>
      ) : (
        <>
          {updates.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-shasta-home px-4 py-3 ring-1 ring-shasta-line" role="status">
              <div className="text-sm">
                <p><span className="font-medium">{updates.length} update{updates.length > 1 ? 's' : ''} available:</span> {updates.map((u) => `${u.app.name} ${u.latestVersion}`).join(', ')}</p>
                <p className="mt-1 text-xs text-shasta-muted">
                  {optional.length === updates.length ? 'You can keep using your current versions: their developers still offer them.' : optional.length ? `${optional.length} of these are optional. The others had their old version retired and update when you next open them.` : 'The old versions were retired by their developers, so these update automatically when you next open them.'}
                </p>
              </div>
              <Button size="sm" className="bg-shasta-accent text-shasta-accent-fg hover:bg-shasta-accent/85" onClick={async () => { for (const u of updates) await useStore.getState().update(u.app.id) }}>Update all</Button>
            </div>
          )}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label className="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-lg bg-shasta-field px-3 ring-1 ring-shasta-line focus-within:ring-2 focus-within:ring-shasta-accent/60 sm:max-w-xs">
              <Search className="size-4 text-shasta-faint" aria-hidden />
              <input aria-label="Search your library" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-shasta-faint" />
            </label>
            <label className="flex items-center gap-2 text-sm text-shasta-muted">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-lg bg-shasta-field px-2 text-sm text-shasta-fg ring-1 ring-shasta-line">
                <option value="recent">Recently used</option>
                <option value="name">Name</option>
                <option value="category">Category</option>
              </select>
            </label>
          </div>
          {folders.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Folders">
              <Chip active={folder === 'all'} onClick={() => setFolder('all')}>All apps</Chip>
              {folders.map((f) => (
                <span key={f.id} className="inline-flex items-center">
                  <Chip active={folder === f.id} onClick={() => setFolder(f.id)}>{f.name}</Chip>
                  {folder === f.id && (
                    <>
                      <button aria-label={`Rename folder ${f.name}`} onClick={() => setFolderDlg(f)} className="ml-1 rounded-lg p-1.5 text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg"><Pencil className="size-3.5" /></button>
                      <button
                        aria-label={`Delete folder ${f.name}`}
                        onClick={async () => { await useStore.getState().deleteFolder(f.id).catch(() => undefined); setFolder('all'); refresh() }}
                        className="rounded-lg p-1.5 text-shasta-muted hover:bg-shasta-hover hover:text-shasta-danger"
                      ><Trash2 className="size-3.5" /></button>
                    </>
                  )}
                </span>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <Message title="No apps match" body="Try a different search or folder." action={<Button variant="secondary" onClick={() => (setQ(''), setFolder('all'))}>Clear filters</Button>} />
          ) : (
            <>
              {pinned.length > 0 && <Section title="Pinned"><div className={grid}>{pinned.map(tile)}</div></Section>}
              {recent.length > 0 && (
                <Section title="Recently used" subtitle={`Last opened ${timeAgo(recent[0].lastLaunchedAt)}`}>
                  <div className={grid}>{recent.map(tile)}</div>
                </Section>
              )}
              <Section title={pinned.length || recent.length ? 'All apps' : 'Apps'}><div className={grid}>{rest.map(tile)}</div></Section>
            </>
          )}
        </>
      )}

      <FolderDialog folder={folderDlg} onClose={() => setFolderDlg(null)} />
      {removing && <UninstallDialog app={{ id: removing.app.id, name: removing.app.name, kind: removing.app.kind }} open onClose={() => setRemoving(null)} />}
    </div>
  )
}


