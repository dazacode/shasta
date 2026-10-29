import { CheckCircle2, Download, FileWarning, Trash2, X, ExternalLink } from 'lucide-react'
import { PageShell, EmptyState } from './PageShell'
import { Button } from '@/components/ui/button'
import { useDownloads, formatBytes, type DownloadItem } from '@/stores/downloadsStore'
import { useTabs } from '@/stores/tabsStore'
import { displayUrl } from '@/lib/url'

function Row({ d }: { d: DownloadItem }) {
  const remove = useDownloads((s) => s.remove)
  const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : null
  return (
    <li className="flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-shasta-hover">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-shasta-field">
        {d.state === 'complete' ? <CheckCircle2 className="size-5 text-shasta-accent" /> : d.state === 'interrupted' ? <FileWarning className="size-5 text-shasta-warn" /> : <Download className="size-5 text-shasta-muted" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{d.filename}</p>
        <p className="truncate text-xs text-shasta-muted">{displayUrl(d.url)}</p>
        {d.state === 'downloading' && (
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-shasta-field" role="progressbar" aria-label={`Downloading ${d.filename}`} aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
              <div className={pct === null ? 'sh-progress h-full w-full bg-shasta-accent' : 'h-full bg-shasta-accent transition-[width]'} style={pct === null ? undefined : { width: `${pct}%` }} />
            </div>
            <span className="text-xs text-shasta-muted tabular-nums">{formatBytes(d.received)}{d.total ? ` of ${formatBytes(d.total)}` : ''}</span>
          </div>
        )}
        {d.state === 'complete' && <p className="mt-0.5 text-xs text-shasta-muted">{formatBytes(d.received)} · {new Date(d.endedAt ?? d.startedAt).toLocaleString()}</p>}
        {d.state === 'interrupted' && <p className="mt-0.5 text-xs text-shasta-warn">Interrupted{d.error ? `: ${d.error}` : ' before it finished'}</p>}
      </div>
      <Button variant="ghost" size="icon" aria-label={`Open ${d.filename} source page in a new tab`} title="Open source address" onClick={() => useTabs.getState().newTab(d.url)}>
        <ExternalLink />
      </Button>
      <Button variant="ghost" size="icon" aria-label={d.state === 'downloading' ? `Hide ${d.filename}` : `Remove ${d.filename} from the list`} onClick={() => remove(d.id)}>
        {d.state === 'downloading' ? <X /> : <Trash2 />}
      </Button>
    </li>
  )
}

export default function DownloadsPage() {
  const items = useDownloads((s) => s.items)
  const clearFinished = useDownloads((s) => s.clearFinished)
  return (
    <PageShell
      title="Downloads"
      subtitle="Files sent to you through Shasta's proxy."
      actions={
        <Button variant="outline" disabled={!items.some((d) => d.state !== 'downloading')} onClick={clearFinished}>
          Clear finished
        </Button>
      }
    >
      <p className="mb-5 rounded-xl bg-shasta-field px-4 py-3 text-sm text-shasta-muted">
        Shasta shows downloads that pass through its proxy. Your browser saves the file itself, so its location, the folder it went to and whether you later moved or deleted it are managed by your browser (usually Ctrl/⌘+J there).
      </p>
      {items.length === 0 ? (
        <EmptyState icon={<Download className="size-6" />} title="No downloads yet" body="When a site offers a file to download, you'll see its progress here." />
      ) : (
        <ul>{items.map((d) => <Row key={d.id} d={d} />)}</ul>
      )}
    </PageShell>
  )
}
