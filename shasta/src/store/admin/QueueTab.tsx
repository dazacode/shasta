import { useState } from 'react'
import { Check, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'
import { api } from '../api'
import { useApi, formatBytes, formatDate, timeAgo } from '../hooks'
import { AppIcon, LoadError, Message, StatusBadge } from '../components'
import type { DevApp } from '../types'
import { Card, ConfirmDialog, KIND_LABEL, ListSkeleton, useAction } from './common'
import { ShieldCheck } from 'lucide-react'

export function QueueTab() {
  const q = useApi<{ items: DevApp[] }>('/api/admin/queue')
  const { busy, run } = useAction()
  const [rejecting, setRejecting] = useState<DevApp | null>(null)

  if (q.error && !q.data) return <LoadError message={q.error} offline={q.offline} onRetry={q.reload} />
  if (!q.data) return <ListSkeleton />
  if (!q.data.items.length) return <Message icon={<ShieldCheck className="size-5" />} title="Nothing is waiting for review" body="New apps and updates from contributors who need approval appear here." />

  const preview = (app: DevApp) =>
    run(`preview-${app.id}`, async () => {
      const v = app.versions.find((x) => x.state === 'pending')
      if (!v) throw new Error('This app has no version waiting for review.')
      const r = await api.post<{ url: string }>(`/api/dev/versions/${v.id}/preview`)
      useTabs.getState().newTab(r.url)
    })

  return (
    <div className="grid gap-4">
      {q.data.items.map((app) => {
        const pending = app.versions.find((v) => v.state === 'pending')
        const live = app.versions.find((v) => v.current)
        const isUpdate = !!app.version && app.status === 'published'
        const report = pending?.validation
        return (
          <Card key={app.id}>
            <div className="flex flex-wrap items-start gap-4">
              <AppIcon app={app} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="sh-heading">{app.name}</h3>
                  <StatusBadge status={app.status} />
                  <span className="rounded-full bg-shasta-field px-2 py-0.5 text-[11px] text-shasta-muted">{isUpdate ? `Update ${live?.version ?? app.version} → ${pending?.version ?? '?'}` : 'New app'}</span>
                </div>
                <p className="text-sm text-shasta-muted">
                  {app.developer}
                  {app.category ? ` · ${app.category.name}` : ' · No category'} · {KIND_LABEL[app.kind]}
                </p>
                <p className="text-xs text-shasta-muted">
                  Submitted by {app.ownerName}
                  {pending?.submittedAt ? ` · ${timeAgo(pending.submittedAt)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void preview(app)} disabled={busy === `preview-${app.id}` || !pending}>
                  <ExternalLink /> Preview
                </Button>
                <Button
                  disabled={busy === `approve-${app.id}`}
                  onClick={async () => {
                    if (await run(`approve-${app.id}`, () => api.post(`/api/admin/apps/${app.id}/approve`), `${app.name} is now live.`)) q.reload()
                  }}
                >
                  <Check /> Approve
                </Button>
                <Button variant="destructive" onClick={() => setRejecting(app)}>
                  <X /> Reject
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="grid gap-3 text-sm">
                {app.summary && <p className="font-medium">{app.summary}</p>}
                <p className="whitespace-pre-wrap text-shasta-muted">{app.description || 'No description.'}</p>
                {app.tags.length > 0 && <p className="text-xs text-shasta-muted">Tags: {app.tags.join(', ')}</p>}
              </div>
              <div className="grid gap-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-shasta-muted">Release notes{pending ? ` for ${pending.version}` : ''}</p>
                  <p className="whitespace-pre-wrap">{pending?.notes || 'None provided.'}</p>
                </div>
                {pending && (
                  <div>
                    <p className="text-xs font-medium text-shasta-muted">Contents</p>
                    {app.kind === 'package' ? (
                      <p>
                        {pending.fileCount} files · {formatBytes(pending.sizeBytes)}
                      </p>
                    ) : (
                      <p className="break-all">{pending.linkedUrl}</p>
                    )}
                    {report && (
                      <p className={report.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-shasta-danger'}>
                        Validation {report.ok ? 'passed' : 'failed'}
                        {report.warnings.length ? ` with ${report.warnings.length} warning${report.warnings.length > 1 ? 's' : ''}` : ''}
                      </p>
                    )}
                    {report?.warnings.map((w) => (
                      <p key={w} className="text-xs text-shasta-warn">
                        {w}
                      </p>
                    ))}
                    {report?.errors.map((w) => (
                      <p key={w} className="text-xs text-shasta-danger">
                        {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {app.screenshots.length > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {app.screenshots.map((s) => (
                  <img key={s.file} src={s.url} alt={`${app.name} screenshot`} className="h-32 shrink-0 rounded-lg ring-1 ring-shasta-line" loading="lazy" />
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-shasta-muted">Created {formatDate(app.createdAt)}</p>
          </Card>
        )
      })}

      <ConfirmDialog
        open={!!rejecting}
        title={`Reject ${rejecting?.name ?? ''}`}
        body="The contributor sees this reason on their dashboard and can fix the problem and submit again."
        reason={{ label: 'Reason', required: true, placeholder: 'What needs to change?' }}
        confirmLabel="Reject"
        destructive
        busy={busy === 'reject'}
        onCancel={() => setRejecting(null)}
        onConfirm={async (reason) => {
          if (!rejecting) return
          if (await run('reject', () => api.post(`/api/admin/apps/${rejecting.id}/reject`, { reason }), `${rejecting.name} was rejected.`)) {
            setRejecting(null)
            q.reload()
          }
        }}
      />
    </div>
  )
}
