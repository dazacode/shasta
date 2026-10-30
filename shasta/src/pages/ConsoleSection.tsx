import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConsole, consoleText, type ConsoleEntry } from '@/lib/consoleCapture'
import { useUi } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { Segmented } from './settingsParts'

type Filter = 'all' | 'error' | 'warn' | 'log'

const matches = (e: ConsoleEntry, f: Filter) => f === 'all' || (f === 'error' ? e.level === 'error' : f === 'warn' ? e.level === 'error' || e.level === 'warn' : e.level !== 'error' && e.level !== 'warn')

const tone: Record<ConsoleEntry['level'], string> = {
  error: 'text-shasta-danger',
  warn: 'text-amber-600 dark:text-amber-400',
  info: '',
  log: '',
  debug: 'text-shasta-muted',
}

/** Settings -> Advanced -> Console: lib/consoleCapture.ts, for people whose school blocks DevTools */
export function ConsoleSection() {
  const entries = useConsole((x) => x.entries)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => matches(e, filter) && (!q || e.text.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)))
  }, [entries, filter, query])
  const errors = useMemo(() => entries.filter((e) => e.level === 'error').length, [entries])

  // follow new lines like DevTools does, unless the person scrolled up to read
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown])

  const copy = () => {
    void navigator.clipboard.writeText(consoleText(shown)).then(
      () => useUi.getState().toast(`Copied ${shown.length} console line${shown.length === 1 ? '' : 's'}`),
      () => useUi.getState().toast('Could not copy the console', { tone: 'error' }),
    )
  }
  const save = () => {
    const url = URL.createObjectURL(new Blob([consoleText(shown)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `shasta-console-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="border-t border-shasta-line py-4" aria-label="Console">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Console{errors > 0 && <span className="ml-2 rounded-full bg-shasta-danger/15 px-2 py-0.5 text-xs text-shasta-danger">{errors} error{errors === 1 ? '' : 's'}</span>}</h2>
          <p className="max-w-xl text-xs text-shasta-muted">
            What the browser's developer console would show: messages and errors from Shasta and from the pages you open. Use it to send a bug report when developer tools are blocked. Kept in memory only and cleared when Shasta closes; it can contain addresses from the pages you visited, so check it before sharing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!shown.length} onClick={copy}>Copy</Button>
          <Button variant="outline" size="sm" disabled={!shown.length} onClick={save}>Save</Button>
          <Button variant="outline" size="sm" disabled={!entries.length} onClick={() => useConsole.getState().clear()}>Clear</Button>
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'error', label: 'Errors' }, { value: 'warn', label: 'Warnings' }, { value: 'log', label: 'Messages' }]} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" aria-label="Filter console" className="h-8 w-48" spellCheck={false} />
      </div>
      <div
        ref={box}
        tabIndex={0}
        role="log"
        aria-label="Console output"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="max-h-80 overflow-auto rounded-xl bg-shasta-field p-2 font-mono text-xs leading-relaxed"
      >
        {shown.length ? (
          shown.map((e) => (
            <div key={e.id} className={cn('flex gap-2 border-b border-shasta-line/50 px-1 py-0.5 last:border-0', tone[e.level], e.level === 'error' && 'bg-shasta-danger/5')}>
              <span className="shrink-0 text-shasta-muted">{new Date(e.at).toLocaleTimeString()}</span>
              <span className="shrink-0 max-w-40 truncate text-shasta-muted" title={e.source}>{e.source}</span>
              <span className="min-w-0 whitespace-pre-wrap break-all">{e.text}</span>
            </div>
          ))
        ) : (
          <p className="p-1 text-shasta-muted">{entries.length ? 'Nothing matches.' : 'Nothing logged yet. Open the page that has the problem, then come back here.'}</p>
        )}
      </div>
    </section>
  )
}
