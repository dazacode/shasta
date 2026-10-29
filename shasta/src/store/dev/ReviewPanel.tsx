import { useState } from 'react'
import { Check, Circle, ExternalLink, Eye, Send, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useTabs } from '@/stores/tabsStore'
import { api, ApiError } from '../api'
import { formatDate, formatBytes } from '../hooks'
import { StatusBadge, Stat } from '../components'
import { useStoreNav } from '../nav'
import type { DevApp, DevVersion } from '../types'
import { Card, ProblemList, fail, ok } from './shared'

export function ReviewPanel({ app, onApp }: { app: DevApp; onApp: (a: DevApp) => void }) {
  const draft = app.versions.find((v) => v.state === 'draft') ?? null
  const pending = app.versions.find((v) => v.state === 'pending') ?? null
  const target = draft ?? pending
  const [busy, setBusy] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const direct = app.canPublishDirectly
  // an update replaces the live version for everybody unless the old one is kept; a first release has nothing to keep
  const replaces = app.status === 'published' && !!draft && app.versions.some((v) => v.current)
  const [keepPrevious, setKeepPrevious] = useState(false)

  const preview = async () => {
    if (!target) return
    setBusy('preview')
    try {
      const r = await api.post<{ url: string; expiresInMinutes: number }>(`/api/dev/versions/${target.id}/preview`)
      if (!r.url) throw new Error('No preview address was returned.')
      useTabs.getState().newTab(r.url)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    if (!draft) return
    setBusy('submit')
    setProblems([])
    try {
      const r = await api.post<{ outcome: 'published' | 'pending'; app: DevApp }>(`/api/dev/versions/${draft.id}/submit`, { keepPrevious: replaces && keepPrevious })
      onApp(r.app)
      ok(r.outcome === 'published' ? `Version ${draft.version} is live in the Store.` : `Version ${draft.version} was sent to the Store owner for review.`)
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) setProblems(e.details.map(String))
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const withdraw = async () => {
    if (!pending) return
    setBusy('withdraw')
    try {
      onApp(await api.post<DevApp>(`/api/dev/versions/${pending.id}/withdraw`))
      ok('Withdrawn. The version is a draft again.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const checks = draft ? app.readiness : []
  return (
    <Card id="review" title="4 · Review & publish" subtitle={direct ? 'You can publish directly. The version goes live as soon as you confirm.' : 'The Store owner reviews new versions before they go live.'}>
      {!target && <p className="text-sm text-shasta-muted">Create a draft version in step 3 to preview and publish it.</p>}
      {draft && (
        <ul className="mb-4 grid gap-1.5 text-sm" aria-label="Readiness checklist">
          {checks.length === 0 && <li className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400"><Check className="size-4" /> Everything required is in place.</li>}
          {checks.map((c) => (
            <li key={c} className="flex items-center gap-2 text-shasta-muted"><Circle className="size-3.5 text-shasta-warn" /> {c}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && !checks.length && <ProblemList title="Not ready to submit" items={problems} />}
      {replaces && (
        <fieldset className="mb-4 grid gap-2 rounded-xl bg-shasta-field p-3 text-sm">
          <legend className="sr-only">What happens to version {app.version}</legend>
          <p><strong>This is an update.</strong> Once {draft!.version} is {direct ? 'published' : 'approved'}, version {app.version} stops working and everyone who has it moves to {draft!.version} the next time they open the app.</p>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--shasta-accent)]" checked={keepPrevious} onChange={(e) => setKeepPrevious(e.target.checked)} />
            <span>
              Keep version {app.version} available, so updating is optional
              <span className="mt-0.5 block text-xs text-shasta-muted">
                People on {app.version} are told about {draft!.version} and can stay or update when they like. {app.kind === 'package' ? 'Each kept version stores its saved data separately, so progress made before now is not shown on the kept copy. ' : ''}You can retire it later from Version history.
              </span>
            </span>
          </label>
        </fieldset>
      )}
      {pending && <p role="status" className="mb-3 rounded-xl bg-shasta-warn/10 p-3 text-sm text-shasta-warn">Version {pending.version} is waiting for the Store owner. {app.status === 'published' ? `Version ${app.version} keeps running in the meantime.` : ''}{pending.keepPrevious ? ` Version ${app.version} will stay available to the people who have it.` : ''}</p>}
      <div className="flex flex-wrap gap-2">
        {target && (
          <Button variant="secondary" disabled={busy === 'preview' || (app.kind === 'package' && !target.hasPackage)} onClick={() => void preview()}>
            <Eye /> Preview {target.version}
          </Button>
        )}
        {draft && (
          <Button disabled={busy === 'submit' || checks.length > 0} onClick={() => void submit()} className="bg-shasta-accent text-shasta-accent-fg hover:bg-shasta-accent/85">
            <Send /> {busy === 'submit' ? 'Working…' : direct ? `Publish ${draft.version}` : 'Submit for review'}
          </Button>
        )}
        {pending && <Button variant="secondary" disabled={busy === 'withdraw'} onClick={() => void withdraw()}><Undo2 /> Withdraw</Button>}
      </div>
      {target && <p className="mt-3 text-xs text-shasta-muted">{app.kind === 'package' ? 'Previews open in a new tab and run on their own isolated origin, exactly as users will see them. The link expires after 30 minutes.' : 'A preview opens the linked address in a new tab through the proxy.'}</p>}
    </Card>
  )
}

export function HistoryPanel({ app, onApp }: { app: DevApp; onApp: (a: DevApp) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const keep = async (v: DevVersion, on: boolean) => {
    setBusy(v.id)
    try {
      onApp(await api.post<DevApp>(`/api/dev/versions/${v.id}/keep`, { keep: on }))
      ok(on ? `Version ${v.version} is available again to the people who have it.` : `Version ${v.version} was retired. People on it move to ${app.version} the next time they open the app.`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card id="history" title="Version history" subtitle="Published versions are immutable. Replaced versions stop working for everyone unless you keep them available.">
      {app.versions.length === 0 ? (
        <p className="text-sm text-shasta-muted">No versions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-xs text-shasta-muted">
              <tr><th className="py-1.5 pr-3 font-medium">Version</th><th className="pr-3 font-medium">State</th><th className="pr-3 font-medium">Created</th><th className="pr-3 font-medium">Published</th><th className="font-medium">Notes</th></tr>
            </thead>
            <tbody className="divide-y divide-shasta-line">
              {app.versions.map((v) => (
                <tr key={v.id} className="align-top">
                  <td className="py-2 pr-3 font-medium tabular-nums">{v.version}{v.current && <span className="ml-1.5 text-xs font-normal text-shasta-muted">current</span>}</td>
                  <td className="pr-3"><StatusBadge status={v.state} /></td>
                  <td className="pr-3 text-shasta-muted">{formatDate(v.createdAt)}</td>
                  <td className="pr-3 text-shasta-muted">{formatDate(v.publishedAt)}</td>
                  <td className="max-w-xs text-shasta-muted">
                    <span className="line-clamp-2 whitespace-pre-wrap">{v.notes || '—'}</span>
                    {v.rejectReason && <span className="mt-1 block text-shasta-danger">Rejected: {v.rejectReason}</span>}
                    {v.hasPackage && <span className="block text-xs">{v.fileCount} files · {formatBytes(v.sizeBytes)}</span>}
                    {v.state === 'archived' && (
                      <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className={v.keepAvailable ? 'text-emerald-600 dark:text-emerald-400' : ''}>{v.keepAvailable ? 'Kept available: people on it can stay' : 'Retired: people on it were moved up'}</span>
                        <Button size="xs" variant="secondary" disabled={busy === v.id} onClick={() => void keep(v, !v.keepAvailable)}>{v.keepAvailable ? 'Retire' : 'Keep available'}</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function StatsPanel({ app }: { app: DevApp }) {
  const s = app.stats
  const none = s.totalInstalls === 0 && s.launches === 0
  return (
    <Card id="stats" title="Usage" subtitle="Real counts recorded by the Store from installs and launches. Nothing is estimated.">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        <Stat label="Installed now" value={s.installed} />
        <Stat label="Total installs" value={s.totalInstalls} hint={`${s.installsLast7Days} in the last 7 days`} />
        <Stat label="Uninstalls" value={s.uninstalls} />
        <Stat label="Launches" value={s.launches} hint={`${s.launchesLast7Days} in the last 7 days`} />
        <Stat label="Open reports" value={s.openReports} />
      </div>
      {none && <p className="mt-3 text-sm text-shasta-muted">{app.status === 'published' ? 'Nobody has installed or launched this yet. Numbers appear here as people use it.' : 'Statistics start once the app is published and people install it.'}</p>}
    </Card>
  )
}

export function LifecyclePanel({ app, onApp }: { app: DevApp; onApp: (a: DevApp) => void }) {
  const { go } = useStoreNav()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const act = async (path: string, done: (r: unknown) => string) => {
    setBusy(true)
    try {
      const r = await api.post<unknown>(`/api/dev/apps/${app.id}/${path}`)
      onApp(await api.get<DevApp>(`/api/dev/apps/${app.id}`))
      ok(done(r))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api.del(`/api/dev/apps/${app.id}?reason=${encodeURIComponent(reason)}`)
      ok(`${app.name} was removed.`)
      go('/develop')
    } catch (e) {
      fail(e)
      setBusy(false)
    }
  }
  if (app.status === 'removed') return <Card title="Removed"><p className="text-sm text-shasta-muted">This app was removed{app.rejectReason ? `: ${app.rejectReason}` : ''}. Only the Store owner can restore it.</p></Card>
  return (
    <Card title="Listing" subtitle={`Currently ${app.status}.`}>
      {app.rejectReason && app.status !== 'published' && <p role="alert" className="mb-3 rounded-xl bg-shasta-danger/10 p-3 text-sm text-shasta-danger">Reviewer note: {app.rejectReason}</p>}
      <div className="flex flex-wrap gap-2">
        {app.status === 'published' && <Button variant="secondary" onClick={() => go(`/app/${encodeURIComponent(app.slug)}`)}><ExternalLink /> View in Store</Button>}
        {app.status === 'published' && <Button variant="secondary" disabled={busy} onClick={() => void act('unpublish', () => 'Unpublished. It is hidden from the Store; installed copies stop launching.')}>Unpublish</Button>}
        {app.status === 'unpublished' && <Button variant="secondary" disabled={busy} onClick={() => void act('republish', (r) => ((r as { outcome: string }).outcome === 'published' ? 'Published again.' : 'Sent to the Store owner for review.'))}>{app.canPublishDirectly ? 'Republish' : 'Request republish'}</Button>}
        <Button variant="destructive" disabled={busy} onClick={() => setConfirm(true)}>Remove app</Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {app.name}?</DialogTitle>
            <DialogDescription>It disappears from the Store and from everyone's launcher. Only the Store owner can bring it back.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
