import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConsole, consoleText, type ConsoleEntry } from '@/lib/consoleCapture'
import { useNetLog, netText, type NetEntry } from '@/lib/netLog'
import { gatherDeviceInfo, deviceText, type InfoSection } from '@/lib/deviceInfo'
import { useUi } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { Segmented } from './settingsParts'

type Tab = 'console' | 'network' | 'device'
type Filter = 'all' | 'error' | 'warn' | 'log'
type NetFilter = 'all' | 'failed' | 'document' | 'script' | 'wasm' | 'worker' | 'fetch' | 'media'

const matches = (e: ConsoleEntry, f: Filter) => f === 'all' || (f === 'error' ? e.level === 'error' : f === 'warn' ? e.level === 'error' || e.level === 'warn' : e.level !== 'error' && e.level !== 'warn')

const failed = (e: NetEntry) => !!e.error || (e.status ?? 0) >= 400
const netMatches = (e: NetEntry, f: NetFilter) => {
  switch (f) {
    case 'all':
      return true
    case 'failed':
      return failed(e)
    case 'document':
      return e.type === 'document' || e.type === 'iframe' || e.type === 'frame'
    case 'script':
      return e.type === 'script' || e.type === 'style'
    case 'wasm':
      return e.mime === 'application/wasm' || /\.wasm(\?|$)/.test(e.url)
    case 'worker':
      return e.type === 'worker' || e.type === 'sharedworker'
    case 'fetch':
      return e.type === '' || e.type === 'empty'
    case 'media':
      return e.type === 'image' || e.type === 'audio' || e.type === 'video' || e.type === 'font' || e.type === 'track'
  }
}

const tone: Record<ConsoleEntry['level'], string> = {
  error: 'text-shasta-danger',
  warn: 'text-amber-600 dark:text-amber-400',
  info: '',
  log: '',
  debug: 'text-shasta-muted',
}

const size = (n?: number) => (n === undefined ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
const time = (ms?: number) => (ms === undefined ? '…' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)

function toast(ok: boolean, what: string) {
  useUi.getState().toast(ok ? `Copied ${what}` : `Could not copy ${what}`, ok ? undefined : { tone: 'error' })
}
function copyText(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(() => toast(true, what), () => toast(false, what))
}
function saveText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** a follow-the-bottom scroll box, like DevTools: stops following while the person scrolls up to read */
function useFollow(deps: unknown) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [deps])
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  return { box, onScroll }
}

/**
 * Settings -> Advanced -> Developer tools: what DevTools would show, for people whose school blocks DevTools.
 * Console (Shasta, every proxied page AND its workers: lib/consoleCapture.ts), Network (proxied requests: lib/netLog.ts)
 * and Device (what this browser can do: lib/deviceInfo.ts). Memory only; nothing is sent anywhere.
 */
export function ConsoleSection() {
  const [tab, setTab] = useState<Tab>('console')
  const entries = useConsole((x) => x.entries)
  const net = useNetLog((x) => x.entries)
  const errors = useMemo(() => entries.filter((e) => e.level === 'error').length, [entries])
  const netFailed = useMemo(() => net.filter(failed).length, [net])
  const [device, setDevice] = useState<InfoSection[] | null>(null)
  const [reading, setReading] = useState(false)

  const readDevice = useCallback(async () => {
    setReading(true)
    try {
      const d = await gatherDeviceInfo()
      setDevice(d)
      return d
    } finally {
      setReading(false)
    }
  }, [])
  useEffect(() => {
    if (tab === 'device' && !device && !reading) void readDevice()
  }, [tab, device, reading, readDevice])

  const report = async () => {
    const d = device ?? (await readDevice())
    return [`Shasta developer report, ${new Date().toISOString()}`, '', '# Device', deviceText(d), '', `# Console (${entries.length} lines)`, consoleText(entries), '', `# Network (${net.length} requests)`, netText(net)].join('\n')
  }

  return (
    <section className="border-t border-shasta-line py-4" aria-label="Developer tools">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Developer tools</h2>
          <p className="max-w-xl text-xs text-shasta-muted">
            What the browser's developer tools would show: messages and errors from Shasta, the pages you open and the games running in them, the requests they make, and what this device can do. Use it to report a bug when developer tools are blocked. Kept in memory only and cleared when Shasta closes; nothing is sent anywhere. It can contain addresses of the pages you visited (never from private tabs), so check it before sharing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void report().then((t) => copyText(t, 'the report'))}>Copy report</Button>
          <Button variant="outline" size="sm" onClick={() => void report().then((t) => saveText(t, 'shasta-report'))}>Save report</Button>
        </div>
      </div>
      <div className="mb-3">
        <Segmented
          label="Developer tools"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'console', label: errors ? `Console · ${errors} error${errors === 1 ? '' : 's'}` : 'Console' },
            { value: 'network', label: netFailed ? `Network · ${netFailed} failed` : `Network${net.length ? ` · ${net.length}` : ''}` },
            { value: 'device', label: 'Device' },
          ]}
        />
      </div>
      {tab === 'console' && <ConsolePane entries={entries} />}
      {tab === 'network' && <NetworkPane entries={net} />}
      {tab === 'device' && <DevicePane sections={device} reading={reading} refresh={() => void readDevice()} />}
    </section>
  )
}

function ConsolePane({ entries }: { entries: ConsoleEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => matches(e, filter) && (!q || e.text.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)))
  }, [entries, filter, query])
  const { box, onScroll } = useFollow(shown)
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'error', label: 'Errors' }, { value: 'warn', label: 'Warnings' }, { value: 'log', label: 'Messages' }]} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter (text or source)" aria-label="Filter console" className="h-8 w-52" spellCheck={false} />
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" disabled={!shown.length} onClick={() => copyText(consoleText(shown), `${shown.length} console line${shown.length === 1 ? '' : 's'}`)}>Copy</Button>
          <Button variant="ghost" size="sm" disabled={!shown.length} onClick={() => saveText(consoleText(shown), 'shasta-console')}>Save</Button>
          <Button variant="ghost" size="sm" disabled={!entries.length} onClick={() => useConsole.getState().clear()}>Clear</Button>
        </div>
      </div>
      <div ref={box} tabIndex={0} role="log" aria-label="Console output" onScroll={onScroll} className="max-h-96 overflow-auto rounded-xl bg-shasta-field p-2 font-mono text-xs leading-relaxed">
        {shown.length ? (
          shown.map((e) => (
            <div key={e.id} className={cn('flex gap-2 border-b border-shasta-line/50 px-1 py-0.5 last:border-0', tone[e.level], e.level === 'error' && 'bg-shasta-danger/5')}>
              <span className="shrink-0 text-shasta-muted">{new Date(e.at).toLocaleTimeString()}</span>
              <span className="max-w-48 shrink-0 truncate text-shasta-muted" title={e.source}>{e.source}</span>
              <span className="min-w-0 whitespace-pre-wrap break-all">{e.text}</span>
            </div>
          ))
        ) : (
          <p className="p-1 text-shasta-muted">{entries.length ? 'Nothing matches.' : 'Nothing logged yet. Open the page that has the problem, then come back here.'}</p>
        )}
      </div>
    </>
  )
}

function NetworkPane({ entries }: { entries: NetEntry[] }) {
  const [filter, setFilter] = useState<NetFilter>('all')
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => netMatches(e, filter) && (!q || e.url.toLowerCase().includes(q) || (e.note ?? '').toLowerCase().includes(q)))
  }, [entries, filter, query])
  const { box, onScroll } = useFollow(shown)
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Segmented
          label="Request type"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'failed', label: 'Failed' },
            { value: 'document', label: 'Pages' },
            { value: 'script', label: 'Scripts' },
            { value: 'wasm', label: 'Wasm' },
            { value: 'worker', label: 'Workers' },
            { value: 'fetch', label: 'Fetch' },
            { value: 'media', label: 'Media' },
          ]}
        />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter address" aria-label="Filter requests" className="h-8 w-48" spellCheck={false} />
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" disabled={!shown.length} onClick={() => copyText(netText(shown), `${shown.length} request${shown.length === 1 ? '' : 's'}`)}>Copy</Button>
          <Button variant="ghost" size="sm" disabled={!entries.length} onClick={() => useNetLog.getState().clear()}>Clear</Button>
        </div>
      </div>
      <div ref={box} tabIndex={0} role="log" aria-label="Network requests" onScroll={onScroll} className="max-h-96 overflow-auto rounded-xl bg-shasta-field p-2 font-mono text-xs leading-relaxed">
        {shown.length ? (
          shown.map((e) => (
            <div key={e.id} className={cn('grid grid-cols-[3rem_3.5rem_4.5rem_1fr_4.5rem_4rem] gap-2 border-b border-shasta-line/50 px-1 py-0.5 last:border-0', failed(e) && 'bg-shasta-danger/5 text-shasta-danger')}>
              <span className="tabular-nums">{e.status ?? (e.error ? 'ERR' : '…')}</span>
              <span className="text-shasta-muted">{e.method}</span>
              <span className="truncate text-shasta-muted" title={e.mime ?? e.type}>{e.type || 'fetch'}</span>
              <span className="min-w-0 break-all" title={e.url}>
                {e.url}
                {e.error && <span className="block text-shasta-danger">{e.error}</span>}
                {e.note && <span className="block text-shasta-muted">{e.note}</span>}
              </span>
              <span className="text-right tabular-nums text-shasta-muted">{size(e.size)}</span>
              <span className="text-right tabular-nums text-shasta-muted">{time(e.ms)}</span>
            </div>
          ))
        ) : (
          <p className="p-1 text-shasta-muted">{entries.length ? 'Nothing matches.' : 'No requests yet. Open a page, then come back here. Private tabs are never recorded.'}</p>
        )}
      </div>
      <p className="mt-1 text-xs text-shasta-muted">Addresses are shown without their query strings. Sizes come from the server; a dash means it did not say.</p>
    </>
  )
}

function DevicePane({ sections, reading, refresh }: { sections: InfoSection[] | null; reading: boolean; refresh: () => void }) {
  if (!sections) return <p className="text-sm text-shasta-muted">{reading ? 'Reading what this device can do…' : 'Not read yet.'}</p>
  const notes = sections.flatMap((s) => s.notes ?? [])
  return (
    <div className="space-y-4">
      {notes.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {sections.map((s) => (
        <div key={s.title}>
          <h3 className="mb-1 text-xs font-medium text-shasta-muted">{s.title}</h3>
          <dl className="grid grid-cols-[minmax(10rem,16rem)_1fr] gap-x-4 gap-y-0.5 rounded-xl bg-shasta-field p-2 font-mono text-xs">
            {s.rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-shasta-muted">{k}</dt>
                <dd className="min-w-0 break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={reading} onClick={refresh}>{reading ? 'Reading…' : 'Read again'}</Button>
        <Button variant="ghost" size="sm" onClick={() => copyText(deviceText(sections), 'the device details')}>Copy</Button>
      </div>
    </div>
  )
}
