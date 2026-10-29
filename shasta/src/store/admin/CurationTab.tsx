import { useState } from 'react'
import { ArrowDown, ArrowUp, Megaphone, Plus, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { useApi, formatDate } from '../hooks'
import { AppIcon, LoadError } from '../components'
import type { DevApp } from '../types'
import { Card, ConfirmDialog, Field, ListSkeleton, textarea, useAction } from './common'

interface Collection {
  id: string
  title: string
  description: string
  visible: boolean
  apps: { id: string; name: string }[]
}
interface Announcement {
  id: string
  title: string
  body: string
  appId: string | null
  active: number
  createdAt: number
}

function CollectionDialog({ target, published, onClose, onSaved }: { target: Collection | 'new' | null; published: DevApp[]; onClose: () => void; onSaved: () => void }) {
  const existing = target && target !== 'new' ? target : null
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visible, setVisible] = useState(true)
  const [ids, setIds] = useState<string[]>([])
  const [seed, setSeed] = useState<unknown>(null)
  const { busy, run } = useAction()
  if (target !== seed) {
    setSeed(target)
    setTitle(existing?.title ?? '')
    setDescription(existing?.description ?? '')
    setVisible(existing?.visible ?? true)
    setIds(existing?.apps.map((a) => a.id) ?? [])
  }
  const names = new Map(published.map((a) => [a.id, a]))
  const available = published.filter((a) => !ids.includes(a.id))
  const move = (i: number, d: -1 | 1) =>
    setIds((cur) => {
      const next = cur.slice()
      ;[next[i], next[i + d]] = [next[i + d], next[i]]
      return next
    })

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit collection' : 'New collection'}</DialogTitle>
          <DialogDescription>Collections are editorial shelves on the Store home page. Only published apps are shown to visitors.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const body = { title, description, visible, appIds: ids }
            const ok = await run('save', () => (existing ? api.patch(`/api/admin/collections/${existing.id}`, body) : api.post('/api/admin/collections', body)), 'Collection saved.')
            if (ok) (onSaved(), onClose())
          }}
        >
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required autoFocus />
          </Field>
          <Field label="Description (optional)">
            <textarea className={textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium">Apps, in order</p>
            {ids.length === 0 && <p className="text-xs text-shasta-muted">No apps yet. Add some below.</p>}
            <ol className="grid gap-1">
              {ids.map((id, i) => (
                <li key={id} className="flex items-center gap-2 rounded-lg bg-shasta-field px-2 py-1.5 text-sm">
                  <span className="w-5 text-center text-xs text-shasta-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{names.get(id)?.name ?? 'App no longer published'}</span>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove from collection" onClick={() => setIds(ids.filter((x) => x !== id))}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ol>
          </div>
          {available.length > 0 && ids.length < 24 && (
            <Field label="Add an app">
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
                value=""
                onChange={(e) => e.target.value && setIds([...ids, e.target.value])}
              >
                <option value="">Choose a published app…</option>
                {available.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="flex items-center justify-between gap-3 text-sm">
            Show on the home page <Switch checked={visible} onCheckedChange={setVisible} aria-label="Show on the home page" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || busy === 'save'}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CurationTab() {
  const apps = useApi<{ apps: DevApp[] }>('/api/admin/apps?status=published')
  const collections = useApi<{ collections: Collection[] }>('/api/admin/collections')
  const news = useApi<{ announcements: Announcement[] }>('/api/admin/announcements')
  const { busy, run } = useAction()
  const [editing, setEditing] = useState<Collection | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Collection | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [appId, setAppId] = useState('')

  const published = apps.data?.apps ?? []
  const featured = published.filter((a) => a.featured)

  return (
    <div className="grid gap-9">
      <p className="rounded-2xl bg-shasta-home px-4 py-3 text-sm text-shasta-muted ring-1 ring-shasta-line">Everything on this page appears on the Store home page: featured apps in the banner, collections as shelves, and the newest active announcement above them.</p>

      <section aria-label="Featured apps">
        <h2 className="mb-3 text-lg font-semibold">Featured apps</h2>
        {apps.error && !apps.data ? (
          <LoadError message={apps.error} offline={apps.offline} onRetry={apps.reload} />
        ) : !apps.data ? (
          <ListSkeleton rows={2} />
        ) : !published.length ? (
          <p className="text-sm text-shasta-muted">No published apps yet. Only published apps can be featured.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {published.map((a) => (
              <Card key={a.id} className="flex items-center gap-3 !p-3">
                <AppIcon app={a} size={40} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                <Button
                  size="sm"
                  variant={a.featured ? 'default' : 'secondary'}
                  disabled={busy === `f-${a.id}`}
                  aria-pressed={a.featured}
                  onClick={async () => (await run(`f-${a.id}`, () => api.post(`/api/admin/apps/${a.id}/${a.featured ? 'unfeature' : 'feature'}`), a.featured ? 'Removed from featured.' : 'Featured on the home page.')) && apps.reload()}
                >
                  <Star className={a.featured ? 'fill-current' : ''} /> {a.featured ? 'Featured' : 'Feature'}
                </Button>
              </Card>
            ))}
          </div>
        )}
        {featured.length > 0 && <p className="mt-2 text-xs text-shasta-muted">{featured.length} featured. The most recently featured app comes first.</p>}
      </section>

      <section aria-label="Collections">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Collections</h2>
          <Button onClick={() => setEditing('new')}>
            <Plus /> New collection
          </Button>
        </div>
        {collections.error && !collections.data ? (
          <LoadError message={collections.error} offline={collections.offline} onRetry={collections.reload} />
        ) : !collections.data ? (
          <ListSkeleton rows={2} />
        ) : !collections.data.collections.length ? (
          <p className="text-sm text-shasta-muted">No collections yet. Create one to group apps like “Back to school” or “Puzzle night”.</p>
        ) : (
          <div className="grid gap-2">
            {collections.data.collections.map((c) => (
              <Card key={c.id} className="flex flex-wrap items-center gap-3 !p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-medium">
                    {c.title} {!c.visible && <span className="ml-1 rounded-full bg-shasta-field px-2 py-0.5 text-[11px] font-normal text-shasta-muted">Hidden</span>}
                  </p>
                  <p className="truncate text-xs text-shasta-muted">{c.apps.length ? c.apps.map((a) => a.name).join(', ') : 'No apps'}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-shasta-danger" onClick={() => setDeleting(c)}>
                  Delete
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Announcements">
        <h2 className="mb-3 text-lg font-semibold">Announcements</h2>
        <Card className="mb-3">
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await run('news', () => api.post('/api/admin/announcements', { title, body, appId: appId || null }), 'Announcement published.')) {
                setTitle('')
                setBody('')
                setAppId('')
                news.reload()
              }
            }}
          >
            <Field label="Headline">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
            </Field>
            <Field label="Text (optional)">
              <textarea className={textarea} value={body} onChange={(e) => setBody(e.target.value)} maxLength={400} />
            </Field>
            <Field label="Link to an app (optional)">
              <select className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30" value={appId} onChange={(e) => setAppId(e.target.value)}>
                <option value="">No link</option>
                {published.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <Button type="submit" disabled={!title.trim() || busy === 'news'}>
                <Megaphone /> Publish announcement
              </Button>
            </div>
          </form>
        </Card>
        {news.error && !news.data ? (
          <LoadError message={news.error} offline={news.offline} onRetry={news.reload} />
        ) : !news.data ? null : news.data.announcements.length === 0 ? (
          <p className="text-sm text-shasta-muted">No announcements yet.</p>
        ) : (
          <ul className="grid gap-2">
            {news.data.announcements.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-shasta-home px-4 py-2.5 ring-1 ring-shasta-line">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="truncate text-xs text-shasta-muted">
                    {formatDate(n.createdAt)}
                    {n.body ? ` · ${n.body}` : ''}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-shasta-muted">
                  <Switch size="sm" checked={!!n.active} disabled={busy === `n-${n.id}`} aria-label={`${n.title} is shown`} onCheckedChange={async (v) => (await run(`n-${n.id}`, () => api.patch(`/api/admin/announcements/${n.id}`, { active: v }))) && news.reload()} />
                  Shown
                </label>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${n.title}`} disabled={busy === `n-${n.id}`} onClick={async () => (await run(`n-${n.id}`, () => api.del(`/api/admin/announcements/${n.id}`), 'Announcement deleted.')) && news.reload()}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CollectionDialog target={editing} published={published} onClose={() => setEditing(null)} onSaved={collections.reload} />
      <ConfirmDialog
        open={!!deleting}
        title={`Delete “${deleting?.title ?? ''}”?`}
        body="The apps in it are not affected."
        confirmLabel="Delete collection"
        destructive
        busy={busy === 'del-collection'}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting && (await run('del-collection', () => api.del(`/api/admin/collections/${deleting.id}`), 'Collection deleted.'))) {
            setDeleting(null)
            collections.reload()
          }
        }}
      />
    </div>
  )
}
