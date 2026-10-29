import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Link2, PackageOpen, Plus, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useTabs } from '@/stores/tabsStore'
import { api, errorMessage } from './api'
import { AppIcon, LoadError, Message, StatusBadge, TileSkeletons } from './components'
import { useApi, formatDate } from './hooks'
import { useStoreNav } from './nav'
import { useStore } from './storeStore'
import type { Credit, DevApp } from './types'
import { ArtworkPanel } from './dev/ArtworkPanel'
import { MetadataImport } from './dev/MetadataImport'
import { HistoryPanel, LifecyclePanel, ReviewPanel, StatsPanel } from './dev/ReviewPanel'
import { Card, Field, ok, selectClass, textareaClass } from './dev/shared'
import { VersionPanel } from './dev/VersionPanel'
import { StorefrontEditor } from './dev/StorefrontEditor'
import { CreditsEditor } from './dev/CreditsEditor'

// ---- new app --------------------------------------------------------------------------------------------

function NewAppDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { go } = useStoreNav()
  const [kind, setKind] = useState<'package' | 'linked'>('package')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const app = await api.post<DevApp>('/api/dev/apps', { name: name.trim(), kind })
      onClose()
      setName('')
      go(`/develop/${app.id}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const option = (k: 'package' | 'linked', icon: React.ReactNode, title: string, body: string) => (
    <label className={cn('flex cursor-pointer gap-3 rounded-xl p-3 ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-shasta-accent', kind === k ? 'bg-shasta-accent/10 ring-shasta-accent' : 'ring-shasta-line hover:bg-shasta-hover')}>
      <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
      <span className="mt-0.5 text-shasta-accent">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-shasta-muted">{body}</span>
      </span>
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New app</DialogTitle>
          <DialogDescription>You can change the details later. Nothing is public until you publish.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), name.trim().length >= 2 && void create())}>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">What are you adding?</legend>
            {option('package', <PackageOpen className="size-5" />, 'Upload a package', 'A ZIP with an index.html: an HTML5 game or web app. Shasta stores it and runs it in an isolated sandbox.')}
            {option('linked', <Link2 className="size-5" />, 'Link to a web app', 'Hosted by you. Nothing is uploaded: people open it in a Shasta tab through the proxy. It is labelled “Linked web app” in the Store.')}
          </fieldset>
          <Field label="App name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="My Game" autoFocus />
          </Field>
          {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'Creating…' : 'Create draft'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- list ---------------------------------------------------------------------------------------------------

function AppListItem({ app, showOwner }: { app: DevApp; showOwner: boolean }) {
  const { go } = useStoreNav()
  const pending = app.versions.find((v) => v.state === 'pending')
  const s = app.stats
  return (
    <li>
      <button onClick={() => go(`/develop/${app.id}`)} className="flex w-full flex-wrap items-center gap-4 rounded-2xl bg-shasta-home p-4 text-left ring-1 ring-shasta-line hover:ring-shasta-accent/50">
        <AppIcon app={app} size={56} />
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{app.name}</p>
            <StatusBadge status={app.status} />
            {pending && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-shasta-warn">v{pending.version} in review</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-shasta-muted">
            {app.kind === 'linked' ? 'Linked web app' : 'Uploaded package'} · {app.version ? `live v${app.version}` : 'not released'} · updated {formatDate(app.updatedAt)}
            {showOwner && ` · ${app.ownerName}`}
          </p>
          {app.rejectReason && app.status === 'rejected' && <p className="mt-1 text-xs text-shasta-danger">Rejected: {app.rejectReason}</p>}
        </div>
        <dl className="flex gap-5 text-xs text-shasta-muted" aria-label="Real usage statistics">
          {[['Installed', s.installed], ['Installs', s.totalInstalls], ['Launches', s.launches], ['Launches 7d', s.launchesLast7Days]].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="text-base font-semibold text-shasta-fg tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </button>
    </li>
  )
}

function AppList() {
  const { go } = useStoreNav()
  const user = useStore((s) => s.user)
  const [all, setAll] = useState(false)
  const [creating, setCreating] = useState(false)
  const data = useApi<{ apps: DevApp[]; canPublishDirectly: boolean }>(`/api/dev/apps${all ? '?all=1' : ''}`)
  const owner = user?.role === 'owner'

  return (
    <div className="mx-auto max-w-4xl py-2">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Develop</h1>
          <p className="text-sm text-shasta-muted">{data.data?.canPublishDirectly ? 'You can publish directly.' : 'New versions are reviewed by the Store owner before they go live.'}</p>
        </div>
        <div className="flex items-center gap-4">
          {owner && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={all} onCheckedChange={setAll} aria-label="Show all apps" /> All apps
            </label>
          )}
          <Button variant="secondary" onClick={() => go('/develop/storefront')}><Store /> My storefront</Button>
          <Button onClick={() => setCreating(true)}><Plus /> New app</Button>
        </div>
      </header>
      {data.loading && !data.data && <TileSkeletons n={3} />}
      {data.error && !data.data && <LoadError message={data.error} offline={data.offline} onRetry={data.reload} />}
      {data.data && data.data.apps.length === 0 && (
        <Message icon={<PackageOpen className="size-5" />} title={all ? 'No apps in the Store yet' : "You haven't added anything yet"} body="Upload an HTML5 game or app as a ZIP, or link to a web app you host. You'll be guided through details, artwork, a version and publishing." action={<Button onClick={() => setCreating(true)}><Plus /> New app</Button>} />
      )}
      {data.data && data.data.apps.length > 0 && (
        <ul className="grid gap-3">
          {data.data.apps.map((a) => <AppListItem key={a.id} app={a} showOwner={all} />)}
        </ul>
      )}
      <NewAppDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

// ---- editor -----------------------------------------------------------------------------------------------------

interface Form {
  name: string
  credits: Credit[]
  summary: string
  description: string
  category: string
  tags: string
}
const toForm = (a: DevApp): Form => ({ name: a.name, credits: a.credits ?? [], summary: a.summary, description: a.description, category: a.category?.id ?? '', tags: a.tags.join(', ') })

function DetailsPanel({ app, draft, onApp }: { app: DevApp; draft: DevApp['versions'][number] | null; onApp: (a: DevApp) => void }) {
  const cats = useApi<{ categories: { id: string; name: string }[] }>('/api/catalog/categories', { live: false })
  const [form, setForm] = useState<Form>(() => toForm(app))
  const [base, setBase] = useState<Form>(() => toForm(app))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(base), [form, base])

  // follow changes made elsewhere (an import) unless there are unsaved edits
  useEffect(() => {
    const next = toForm(app)
    if (!dirty) (setForm(next), setBase(next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.updatedAt, app.id])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      const updated = await api.patch<DevApp>(`/api/dev/apps/${app.id}`, { name: form.name, credits: form.credits.filter((c) => c.name.trim()).map((c) => ({ ...c, name: c.name.trim(), url: c.url?.trim() || undefined })), summary: form.summary, description: form.description, category: form.category || null, tags })
      const next = toForm(updated)
      setForm(next)
      setBase(next)
      onApp(updated)
      ok('Details saved.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <MetadataImport app={app} draft={draft} onApplied={onApp} />
      <Card id="details" title="1 · Details" subtitle="This is what people see on your listing.">
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), void save())}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} required /></Field>
          </div>
          <Field label="Short summary" counter={`${form.summary.length}/120`} hint="One line, shown on cards.">
            <Input value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Description" counter={`${form.description.length}/5000`} hint="At least 20 characters to publish.">
            <textarea className={cn(textareaClass, 'min-h-40')} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </Field>
          <CreditsEditor value={form.credits} onChange={(credits) => set('credits', credits)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <select className={selectClass} value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Choose…</option>
                {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Tags" hint="Up to 10, separated by commas. Letters, numbers and dashes.">
              <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="puzzle, arcade, multiplayer" />
            </Field>
          </div>
          {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save details'}</Button>
            {dirty && <span className="text-xs text-shasta-muted" aria-live="polite">Unsaved changes</span>}
          </div>
        </form>
      </Card>
    </>
  )
}

function Editor({ id }: { id: string }) {
  const { go } = useStoreNav()
  const loaded = useApi<DevApp>(`/api/dev/apps/${id}`, { live: false })
  const [app, setApp] = useState<DevApp | null>(null)
  useEffect(() => { if (loaded.data) setApp(loaded.data) }, [loaded.data])
  const current = app?.id === id ? app : null
  const { tabId } = useStoreNav()
  useEffect(() => {
    if (current) useTabs.getState().setInternalTitle(tabId, `${current.name} – Develop`)
  }, [current?.name, tabId])

  const back = (
    <Button variant="ghost" size="sm" onClick={() => go('/develop')} className="mb-3 -ml-2"><ArrowLeft /> All apps</Button>
  )
  if (!current) {
    return (
      <div className="mx-auto max-w-3xl py-2">
        {back}
        {loaded.error ? <LoadError message={loaded.error} offline={loaded.offline} onRetry={loaded.reload} /> : <TileSkeletons n={2} />}
      </div>
    )
  }
  const draft = current.versions.find((v) => v.state === 'draft') ?? null
  const onApp = (a: DevApp) => setApp(a)
  const steps = [['details', 'Details'], ['artwork', 'Artwork'], ['version', 'Version'], ['review', 'Publish'], ['stats', 'Usage'], ['history', 'History']]

  return (
    <div className="mx-auto grid max-w-3xl gap-5 py-2">
      <div>
        {back}
        <div className="flex flex-wrap items-center gap-4">
          <AppIcon app={current} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{current.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-shasta-muted">
              <StatusBadge status={current.status} />
              {current.kind === 'linked' ? 'Linked web app' : 'Uploaded package'}
              {current.version && <span>· live v{current.version}</span>}
            </p>
          </div>
        </div>
        <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-1.5">
          {steps.map(([k, label]) => (
            <button key={k} onClick={() => document.getElementById(k)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-full bg-shasta-field px-3 py-1 text-xs hover:bg-shasta-hover">{label}</button>
          ))}
        </nav>
      </div>
      {current.status === 'removed' ? (
        <LifecyclePanel app={current} onApp={onApp} />
      ) : (
        <>
          <DetailsPanel app={current} draft={draft} onApp={onApp} />
          <ArtworkPanel app={current} onApp={onApp} />
          <VersionPanel app={current} onApp={onApp} />
          <ReviewPanel app={current} onApp={onApp} />
          <StatsPanel app={current} />
          <HistoryPanel app={current} onApp={onApp} />
          <LifecyclePanel app={current} onApp={onApp} />
        </>
      )}
    </div>
  )
}

// ---- entry -------------------------------------------------------------------------------------------------------------

export default function DeveloperDashboard() {
  const { route, go } = useStoreNav()
  const user = useStore((s) => s.user)
  const booted = useStore((s) => s.booted)
  const developer = user?.role === 'contributor' || user?.role === 'owner'

  if (!developer) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Message
          title={user || booted ? 'Developing is for approved contributors' : 'Checking your account…'}
          body="Anyone can apply to publish: the Store owner reads every application. If you already have an invite code, enter it under Account → “I have a code”."
          action={
            <>
              <Button onClick={() => go('/apply')}>Apply to publish</Button>
              <Button variant="secondary" onClick={() => go('/account')}>Go to Account</Button>
            </>
          }
        />
      </div>
    )
  }
  const id = route.segments[1]
  if (id === 'storefront') return <StorefrontEditor />
  return id ? <Editor key={id} id={id} /> : <AppList />
}
