import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '../api'
import { LoadError, Message } from '../components'
import type { AuditEntry } from '../types'
import { ListSkeleton } from './common'

const VERBS: Record<string, string> = {
  'app.create': 'created an app',
  'app.update': 'edited listing details of',
  'app.unpublish': 'unpublished',
  'app.republish-request': 'asked to republish',
  'app.remove': 'removed',
  'app.restore': 'restored',
  'app.reject': 'rejected',
  'app.feature': 'featured',
  'app.unfeature': 'stopped featuring',
  'version.create': 'started a new version of',
  'version.submit': 'submitted a version of',
  'version.withdraw': 'withdrew a version of',
  'version.delete': 'deleted a draft of',
  'version.publish': 'published a version of',
  'version.rollback': 'rolled back',
  'package.upload': 'uploaded a package for',
  'package.rejected': 'had a package rejected for',
  'metadata.import': 'imported listing details for',
  'invite.create': 'created a contributor invite',
  'invite.revoke': 'revoked an invite',
  'invite.redeem': 'redeemed an invite',
  'user.grant': 'granted contributor access to',
  'user.role': 'changed the role of',
  'user.can-publish': 'changed publish rights of',
  'user.disable': 'disabled',
  'user.enable': 'enabled',
  'report.resolved': 'resolved a report',
  'report.dismissed': 'dismissed a report',
}

/** The few details worth reading in a log line. */
function summarize(e: AuditEntry): string {
  const d = e.details
  const parts: string[] = []
  const name = d.app ?? d.name ?? d.username ?? d.publicId
  if (name) parts.push(String(name))
  if (d.version) parts.push(`v${String(d.version)}`)
  if (d.from && d.to) parts.push(`${String(d.from)} → ${String(d.to)}`)
  if (d.canPublish !== undefined) parts.push(d.canPublish ? 'may publish' : 'needs review')
  if (d.reason) parts.push(`“${String(d.reason)}”`)
  if (Array.isArray(d.applied) && d.applied.length) parts.push(`imported ${d.applied.join(', ')}`)
  if (Array.isArray(d.errors) && d.errors.length) parts.push(String(d.errors[0]))
  if (d.note) parts.push(String(d.note))
  return parts.join(' · ')
}

export function ActivityTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async (before?: number) => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get<{ entries: AuditEntry[] }>(`/api/admin/audit${before ? `?before=${before}` : ''}`)
      setEntries((cur) => (before ? [...cur, ...r.entries] : r.entries))
      setMore(r.entries.length >= 100)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase()
    if (!t) return entries
    return entries.filter((e) => `${e.actor} ${e.action} ${VERBS[e.action] ?? ''} ${summarize(e)} ${e.targetType}`.toLowerCase().includes(t))
  }, [entries, filter])

  if (error && !entries.length) return <LoadError message={error} onRetry={() => void load()} />
  if (loading && !entries.length) return <ListSkeleton rows={5} />

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-shasta-muted">Every sensitive action is recorded here.</p>
        <Input className="max-w-64" aria-label="Filter the activity log" placeholder="Filter by person, action or app" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {!shown.length ? (
        <Message icon={<ScrollText className="size-5" />} title={filter ? 'Nothing matches that filter' : 'No activity yet'} body={filter && more ? 'Older entries may match. Load more to search further back.' : undefined} />
      ) : (
        <ol className="divide-y divide-shasta-line overflow-hidden rounded-2xl bg-shasta-home ring-1 ring-shasta-line">
          {shown.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
              <time className="w-40 shrink-0 text-xs text-shasta-muted tabular-nums" dateTime={new Date(e.at).toISOString()}>
                {new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
              <span className="min-w-0 flex-1 basis-64">
                <b className="font-medium">{e.actor}</b> {VERBS[e.action] ?? e.action} <span className="text-shasta-muted">{summarize(e)}</span>
              </span>
              <code className="text-[11px] text-shasta-muted">{e.action}</code>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="mt-3 text-sm text-shasta-danger">{error}</p>}
      {more && entries.length > 0 && (
        <div className="mt-4 text-center">
          <Button variant="secondary" disabled={loading} onClick={() => void load(entries[entries.length - 1].id)}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
