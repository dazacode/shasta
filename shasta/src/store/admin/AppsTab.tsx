import { useState } from 'react'
import { History, MoreHorizontal, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '../api'
import { useApi, formatDate } from '../hooks'
import { appPath, useStoreNav } from '../nav'
import { AppIcon, Chip, LoadError, Message, StatusBadge } from '../components'
import type { AppStatus, DevApp } from '../types'
import { Card, ConfirmDialog, ListSkeleton, useAction } from './common'

const FILTERS: ('all' | AppStatus)[] = ['all', 'published', 'pending', 'unpublished', 'draft', 'rejected', 'removed']

type Dialogs = { kind: 'unpublish' | 'remove'; app: DevApp } | { kind: 'history'; app: DevApp } | { kind: 'rollback'; app: DevApp; versionId: string; version: string } | null

export function AppsTab() {
  const [filter, setFilter] = useState<'all' | AppStatus>('all')
  const q = useApi<{ apps: DevApp[] }>(`/api/admin/apps${filter === 'all' ? '' : `?status=${filter}`}`)
  const { busy, run } = useAction()
  const { go } = useStoreNav()
  const [dialog, setDialog] = useState<Dialogs>(null)

  const act = async (key: string, path: string, body: unknown, ok: string) => {
    const done = await run(key, () => api.post(`/api/admin/apps/${path}`, body), ok)
    if (done) q.reload()
    return done
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)} className="capitalize">
            {f}
          </Chip>
        ))}
      </div>

      {q.error && !q.data ? (
        <LoadError message={q.error} offline={q.offline} onRetry={q.reload} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : !q.data.apps.length ? (
        <Message icon={<Package className="size-5" />} title={filter === 'all' ? 'No apps yet' : `No ${filter} apps`} body="Apps appear here as contributors create them." />
      ) : (
        <div className="grid gap-2">
          {q.data.apps.map((app) => (
            <Card key={app.id} className="flex flex-wrap items-center gap-3 !p-3">
              <AppIcon app={app} size={44} />
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{app.name}</span>
                  <StatusBadge status={app.status} />
                  {app.featured && <span className="rounded-full bg-shasta-accent/15 px-2 py-0.5 text-[11px] font-medium text-shasta-accent">Featured</span>}
                </div>
                <p className="truncate text-xs text-shasta-muted">
                  {app.ownerName} · {app.version ? `v${app.version}` : 'no live version'}
                  {app.pendingVersion ? ` · ${app.pendingVersion} pending` : ''} · updated {formatDate(app.updatedAt)}
                </p>
                {app.rejectReason && (app.status === 'rejected' || app.status === 'removed' || app.status === 'unpublished') && <p className="truncate text-xs text-shasta-danger">Reason: {app.rejectReason}</p>}
              </div>
              <div className="hidden gap-4 text-center text-xs text-shasta-muted sm:flex" aria-label="Statistics">
                <span>
                  <b className="block text-sm text-shasta-fg tabular-nums">{app.stats.installed}</b> installed
                </span>
                <span>
                  <b className="block text-sm text-shasta-fg tabular-nums">{app.stats.launchesLast7Days}</b> launches / 7d
                </span>
                <span>
                  <b className={`block text-sm tabular-nums ${app.stats.openReports ? 'text-shasta-danger' : 'text-shasta-fg'}`}>{app.stats.openReports}</b> reports
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger aria-label={`Actions for ${app.name}`} disabled={!!busy} className="grid size-8 place-items-center rounded-full text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {app.status === 'published' && <DropdownMenuItem onClick={() => go(appPath(app.slug))}>View in Store</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => setDialog({ kind: 'history', app })}>
                    <History /> Version history &amp; rollback
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {app.status === 'published' && (
                    <DropdownMenuItem onClick={() => void act(`feature-${app.id}`, `${app.id}/${app.featured ? 'unfeature' : 'feature'}`, {}, app.featured ? `${app.name} is no longer featured.` : `${app.name} is featured on the home page.`)}>
                      {app.featured ? 'Remove from featured' : 'Feature on home page'}
                    </DropdownMenuItem>
                  )}
                  {app.status === 'published' && <DropdownMenuItem onClick={() => setDialog({ kind: 'unpublish', app })}>Unpublish…</DropdownMenuItem>}
                  {app.status === 'removed' ? (
                    <DropdownMenuItem onClick={() => void act(`restore-${app.id}`, `${app.id}/restore`, {}, `${app.name} was restored (unpublished).`)}>Restore</DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem className="text-shasta-danger" onClick={() => setDialog({ kind: 'remove', app })}>
                      Remove from the Store…
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={dialog?.kind === 'unpublish'}
        title={`Unpublish ${dialog?.app.name ?? ''}?`}
        body="It disappears from the Store and can't be launched. People who installed it keep it in their library, marked unavailable. You can bring it back later."
        reason={{ label: 'Reason', placeholder: 'Recorded in the audit log' }}
        confirmLabel="Unpublish"
        destructive
        busy={busy?.startsWith('unpublish')}
        onCancel={() => setDialog(null)}
        onConfirm={async (reason) => {
          if (dialog?.kind === 'unpublish' && (await act(`unpublish-${dialog.app.id}`, `${dialog.app.id}/unpublish`, { reason }, `${dialog.app.name} was unpublished.`))) setDialog(null)
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'remove'}
        title={`Remove ${dialog?.app.name ?? ''} from the Store?`}
        body="Use this for broken or inappropriate content. The app is hidden from everyone, including its developer, until you restore it."
        reason={{ label: 'Reason', placeholder: 'Recorded in the audit log and shown to the developer' }}
        confirmLabel="Remove"
        destructive
        busy={busy?.startsWith('remove')}
        onCancel={() => setDialog(null)}
        onConfirm={async (reason) => {
          if (dialog?.kind === 'remove' && (await act(`remove-${dialog.app.id}`, `${dialog.app.id}/remove`, { reason }, `${dialog.app.name} was removed.`))) setDialog(null)
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'rollback'}
        title={dialog?.kind === 'rollback' ? `Restore version ${dialog.version}?` : ''}
        body={dialog?.kind === 'rollback' ? `${dialog.app.name} goes back to version ${dialog.version} for everyone. The current version is kept and can be restored again. People who installed it will see a version change.` : undefined}
        confirmLabel="Restore this version"
        busy={busy?.startsWith('rollback')}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog?.kind === 'rollback' && (await act(`rollback-${dialog.app.id}`, `${dialog.app.id}/rollback`, { versionId: dialog.versionId }, `Restored version ${dialog.version}.`))) setDialog(null)
        }}
      />

      <Dialog open={dialog?.kind === 'history'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{dialog?.app.name} — versions</DialogTitle>
            <DialogDescription>Published versions are immutable. Restoring an older one only moves the pointer.</DialogDescription>
          </DialogHeader>
          <ul className="grid max-h-[60vh] gap-2 overflow-y-auto">
            {(dialog?.kind === 'history' ? (q.data?.apps.find((a) => a.id === dialog.app.id) ?? dialog.app) : null)?.versions.map((v) => (
              <li key={v.id} className="rounded-xl bg-shasta-field p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">v{v.version}</span>
                  <StatusBadge status={v.state} />
                  <span className="text-xs text-shasta-muted">{v.publishedAt ? `published ${formatDate(v.publishedAt)}` : `created ${formatDate(v.createdAt)}`}</span>
                  {v.state === 'archived' && dialog?.kind === 'history' && (
                    <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setDialog({ kind: 'rollback', app: dialog.app, versionId: v.id, version: v.version })}>
                      Restore this version
                    </Button>
                  )}
                </div>
                {v.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-shasta-muted">{v.notes}</p>}
                {v.rejectReason && <p className="mt-1 text-xs text-shasta-danger">Rejected: {v.rejectReason}</p>}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}
