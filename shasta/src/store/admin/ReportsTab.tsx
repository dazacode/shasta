import { useState } from 'react'
import { Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '../api'
import { useApi, timeAgo } from '../hooks'
import { appPath, useStoreNav } from '../nav'
import { Chip, LoadError, Message, StatusBadge } from '../components'
import type { AppStatus, Report } from '../types'
import { Card, ConfirmDialog, ListSkeleton, useAction } from './common'

const PROBLEM: Record<string, string> = { 'wont-load': "Won't load", 'stuck-loading': 'Stuck loading', crash: 'Crashes or freezes', controls: "Controls don't work", sound: 'No sound', slow: 'Slow', dead: 'Dead link', outdated: 'Needs an update', other: 'Broken (other)' }
const INFO: Record<string, string> = { shasta: 'Shasta', browser: 'Browser', os: 'System', engine: 'Engine', appVersion: 'App', error: 'Error' }
const REASON: Record<string, string> = { broken: 'Broken or needs an update', inappropriate: 'Inappropriate content', malicious: 'Malicious or deceptive', copyright: 'Copyright', other: 'Other' }
const STATES = ['open', 'resolved', 'dismissed'] as const

export function ReportsTab() {
  const [status, setStatus] = useState<(typeof STATES)[number]>('open')
  const q = useApi<{ reports: Report[] }>(`/api/admin/reports?status=${status}`, { live: false })
  const { busy, run } = useAction()
  const { go } = useStoreNav()
  const [closing, setClosing] = useState<{ report: Report; as: 'resolved' | 'dismissed'; all?: boolean } | null>(null)
  const [unpublishing, setUnpublishing] = useState<Report | null>(null)

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Report status">
        {STATES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)} className="capitalize">
            {s}
          </Chip>
        ))}
      </div>
      {q.error && !q.data ? (
        <LoadError message={q.error} offline={q.offline} onRetry={q.reload} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : !q.data.reports.length ? (
        <Message icon={<Flag className="size-5" />} title={status === 'open' ? 'No open reports' : `No ${status} reports`} body={status === 'open' ? 'When people report a broken or inappropriate app, it shows up here.' : undefined} />
      ) : (
        <div className="grid gap-3">
          {q.data.reports.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.appStatus === 'published' ? (
                      <button className="font-semibold text-shasta-accent hover:underline" onClick={() => go(appPath(r.appSlug))}>
                        {r.appName}
                      </button>
                    ) : (
                      <span className="font-semibold">{r.appName}</span>
                    )}
                    <StatusBadge status={r.appStatus as AppStatus} />
                    <span className="rounded-full bg-shasta-field px-2 py-0.5 text-[11px]">{(r.problem && PROBLEM[r.problem]) || REASON[r.reason] || r.reason}</span>
                    {r.status === 'open' && r.appOpen > 1 && <span className="rounded-full bg-shasta-warn/15 px-2 py-0.5 text-[11px] font-medium text-shasta-warn">{r.appOpen} open reports</span>}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{r.details || <span className="text-shasta-muted">No details given.</span>}</p>
                  <p className="mt-1 text-xs text-shasta-muted">
                    Reported {timeAgo(r.createdAt)} (reports are anonymous)
                  </p>
                  {r.info && Object.keys(r.info).length > 0 && (
                    <p className="mt-1 text-xs break-all text-shasta-muted">
                      {Object.entries(r.info).map(([k, v]) => `${INFO[k] ?? k}: ${v}`).join(' · ')}
                    </p>
                  )}
                  {r.resolution && <p className="mt-1 text-xs text-shasta-muted">Note: {r.resolution}</p>}
                </div>
                {r.status === 'open' && (
                  <div className="flex flex-wrap gap-2">
                    {r.appStatus === 'published' && (
                      <Button size="sm" variant="destructive" onClick={() => setUnpublishing(r)}>
                        Unpublish app
                      </Button>
                    )}
                    {r.appOpen > 1 && (
                      <Button size="sm" onClick={() => setClosing({ report: r, as: 'resolved', all: true })}>
                        Fixed, close all {r.appOpen}
                      </Button>
                    )}
                    <Button size="sm" variant={r.appOpen > 1 ? 'secondary' : 'default'} onClick={() => setClosing({ report: r, as: 'resolved' })}>
                      Resolve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setClosing({ report: r, as: 'dismissed' })}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!closing}
        title={closing?.all ? `Close all ${closing.report.appOpen} reports about ${closing.report.appName}` : closing?.as === 'resolved' ? 'Resolve this report' : 'Dismiss this report'}
        body={closing?.all ? 'Every open report about this app is marked fixed (its Discord post too).' : closing?.as === 'resolved' ? 'Mark the problem as dealt with.' : 'The report needs no action.'}
        reason={{ label: 'Note', placeholder: 'What was done?' }}
        confirmLabel={closing?.as === 'resolved' ? 'Resolve' : 'Dismiss'}
        busy={busy === 'close'}
        onCancel={() => setClosing(null)}
        onConfirm={async (resolution) => {
          const done = closing?.all
            ? () => api.post(`/api/admin/reports/app/${closing.report.appId}/close`, { status: closing.as, resolution })
            : () => api.patch(`/api/admin/reports/${closing!.report.id}`, { status: closing!.as, resolution })
          if (closing && (await run('close', done, closing.all ? 'Reports closed.' : `Report ${closing.as}.`))) {
            setClosing(null)
            q.reload()
          }
        }}
      />
      <ConfirmDialog
        open={!!unpublishing}
        title={`Unpublish ${unpublishing?.appName ?? ''}?`}
        body="It leaves the Store immediately. The report stays open until you resolve it."
        reason={{ label: 'Reason', placeholder: 'Recorded in the audit log' }}
        confirmLabel="Unpublish"
        destructive
        busy={busy === 'unpublish'}
        onCancel={() => setUnpublishing(null)}
        onConfirm={async (reason) => {
          if (unpublishing && (await run('unpublish', () => api.post(`/api/admin/apps/${unpublishing.appId}/unpublish`, { reason }), `${unpublishing.appName} was unpublished.`))) {
            setUnpublishing(null)
            q.reload()
          }
        }}
      />
    </div>
  )
}
