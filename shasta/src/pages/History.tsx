import { useMemo, useState } from 'react'
import { History as HistoryIcon, Search, Trash2 } from 'lucide-react'
import { PageShell, EmptyState } from './PageShell'
import { Favicon } from '@/components/browser/Favicon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLibrary, type ClearRange, type HistoryEntry } from '@/stores/libraryStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { useSettings } from '@/stores/settingsStore'
import { displayUrl, hostOf } from '@/lib/url'

const PAGE = 150

function dayLabel(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400e3)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export default function HistoryPage() {
  const history = useLibrary((s) => s.history)
  const del = useLibrary((s) => s.deleteHistory)
  const clear = useLibrary((s) => s.clearHistory)
  const saveHistory = useSettings((s) => s.settings.saveHistory)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [clearing, setClearing] = useState(false)
  const [range, setRange] = useState<ClearRange>('day')

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return terms.length ? history.filter((h) => terms.every((t) => h.title.toLowerCase().includes(t) || h.url.toLowerCase().includes(t))) : history
  }, [history, query])

  const groups = useMemo(() => {
    const out: { label: string; items: HistoryEntry[] }[] = []
    for (const h of filtered.slice(0, limit)) {
      const label = dayLabel(h.visitedAt)
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(h)
      else out.push({ label, items: [h] })
    }
    return out
  }, [filtered, limit])

  const open = (e: React.MouseEvent, url: string) => {
    const tabs = useTabs.getState()
    if (e.metaKey || e.ctrlKey) tabs.newTab(url, { background: true })
    else tabs.navigateTo(tabs.activeId, url)
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })

  return (
    <PageShell
      title="History"
      subtitle={saveHistory ? `${history.length} page${history.length === 1 ? '' : 's'} visited on this device` : 'History saving is turned off in Settings → Privacy'}
      actions={
        <>
          {selected.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => {
                del([...selected])
                setSelected(new Set())
              }}
            >
              <Trash2 /> Delete {selected.size}
            </Button>
          )}
          <Button variant="outline" disabled={!history.length} onClick={() => setClearing(true)}>
            Clear browsing data…
          </Button>
        </>
      }
    >
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-shasta-muted" />
        <input
          type="search"
          aria-label="Search history"
          placeholder="Search history"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE)
          }}
          className="h-10 w-full rounded-[10px] border border-shasta-line bg-shasta-field pr-4 pl-10 text-sm placeholder:text-shasta-faint outline-none transition-[border-color,box-shadow] duration-150 ease-shasta focus-visible:border-shasta-accent/50 focus-visible:ring-2 focus-visible:ring-shasta-accent/20"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<HistoryIcon className="size-6" />} title={query ? 'No matching history' : 'No history yet'} body={query ? 'Try a different search term.' : 'Pages you visit show up here so you can find them again.'} />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.label} className="mb-6" aria-label={g.label}>
              <h2 className="mb-2 px-2 text-sm font-medium text-shasta-muted">{g.label}</h2>
              <ul>
                {g.items.map((h) => (
                  <li key={h.id} className="group flex h-10 items-center gap-3 rounded-lg px-2 transition-colors duration-150 ease-shasta hover:bg-shasta-hover">
                    <input type="checkbox" aria-label={`Select ${h.title}`} checked={selected.has(h.id)} onChange={() => toggle(h.id)} className="size-4 accent-[var(--sh-accent)]" />
                    <span className="sh-meta w-16 shrink-0">{new Date(h.visitedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    <button onClick={(e) => open(e, h.url)} onAuxClick={(e) => e.button === 1 && useTabs.getState().newTab(h.url, { background: true })} className="flex h-full min-w-0 flex-1 items-center gap-3 text-left text-sm" title={h.url}>
                      <Favicon url={h.url} />
                      <span className="min-w-0 flex-1 truncate">{h.title || hostOf(h.url)}</span>
                      <span className="sh-meta hidden max-w-[40%] truncate sm:block">{displayUrl(h.url)}</span>
                    </button>
                    <button aria-label={`Remove ${h.title} from history`} onClick={() => del([h.id])} className="grid size-7 place-items-center rounded-md text-shasta-faint opacity-0 transition-[opacity,color,background-color] duration-150 ease-shasta group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-shasta-line hover:text-shasta-fg">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {filtered.length > limit && (
            <Button variant="outline" className="mx-auto flex" onClick={() => setLimit((l) => l + PAGE)}>
              Show more
            </Button>
          )}
        </>
      )}

      <Dialog open={clearing} onOpenChange={setClearing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear browsing history</DialogTitle>
            <DialogDescription>This removes the list of pages you visited. Bookmarks, cookies and downloads are not affected.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Time range
            <select value={range} onChange={(e) => setRange(e.target.value as ClearRange)} className="h-9 rounded-md border border-input bg-popover px-2 text-sm text-foreground">
              <option value="hour">Last hour</option>
              <option value="day">Last 24 hours</option>
              <option value="week">Last 7 days</option>
              <option value="all">All time</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClearing(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await clear(range)
                setClearing(false)
                setSelected(new Set())
                useUi.getState().toast('History cleared')
              }}
            >
              Clear history
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
