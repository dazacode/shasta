// The bodies of the new tab widgets (lib/home.ts). The frame around them, editing and dragging live in Home.tsx.
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  Bookmark as BookmarkIcon, CalendarClock, Check, Clock as ClockIcon, Film, Flame, History, Hourglass, LayoutGrid, ListChecks, Pause, Pencil, Play, Plus, Quote, RotateCcw, SkipForward, StickyNote, Store, Timer, Trash2, X,
} from 'lucide-react'
import { Favicon } from '@/components/browser/Favicon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LivePulse } from '@/components/LivePulse'
import { useTabs } from '@/stores/tabsStore'
import { useLibrary, childrenOf } from '@/stores/libraryStore'
import { useSettings, type Shortcut } from '@/stores/settingsStore'
import { useHome, type Todo } from '@/stores/homeStore'
import { useStore } from '@/store/storeStore'
import { useStoreBoot } from '@/store/hooks'
import { AppIcon } from '@/store/components'
import { displayUrl, hostOf, originOf, resolveInput } from '@/lib/url'
import { uid } from '@/lib/tabModel'
import { countdown, formatHm, newId, scheduleNow, timeInWords, type Widget, type WidgetType } from '@/lib/home'
import { QUOTE_KINDS, loadQuotes, pickQuote, quotesOf, type Quote as QuoteItem, type QuoteKind } from '@/lib/quotes'
import { cn } from '@/lib/utils'

export const WIDGET_ICON: Record<WidgetType, ComponentType<{ className?: string }>> = {
  shortcuts: LayoutGrid,
  schedule: CalendarClock,
  focus: Timer,
  todo: ListChecks,
  notes: StickyNote,
  countdown: Hourglass,
  clock: ClockIcon,
  quote: Quote,
  apps: Store,
  live: Flame,
  bookmarks: BookmarkIcon,
  recent: History,
}

export interface WidgetProps {
  w: Widget
  tabId: string
  isPrivate: boolean
  /** opens this widget's options (schedule set-up, countdown date...) */
  onOptions: () => void
}

/** The person's own clock preference, as the browser reports it for their locale. */
export const localeHour12 = () => new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12 ?? true

/** The current time, refreshed every `ms` (null = not ticking). */
export function useNow(ms: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (ms == null) return
    // a timer that just started must not show the time from when it was last paused
    const first = setTimeout(() => setNow(Date.now()), 0)
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [ms])
  return now
}

const Empty = ({ children }: { children: React.ReactNode }) => <div className="flex h-full min-h-16 items-end text-sm leading-5 text-shasta-muted">{children}</div>

// ---- shortcuts --------------------------------------------------------------------------------------------------

function ShortcutTile({ s, onEdit, onRemove, onOpen }: { s: Shortcut; onEdit: () => void; onRemove: () => void; onOpen: () => void }) {
  return (
    <div className="group relative flex w-24 flex-col items-center gap-2">
      <button onClick={onOpen} className="flex w-full flex-col items-center gap-2 rounded-2xl p-2 text-sm text-shasta-muted transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg" title={s.url}>
        <span className="grid size-14 place-items-center rounded-xl bg-shasta-home ring-1 ring-shasta-line">
          <Favicon url={s.url} className="size-7" />
        </span>
        <span className="w-full truncate text-center">{s.title}</span>
      </button>
      <div className="absolute top-0 right-0 flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <button aria-label={`Edit ${s.title}`} onClick={onEdit} className="grid size-6 place-items-center rounded-full bg-shasta-field text-shasta-muted hover:text-shasta-fg">
          <Pencil className="size-3" />
        </button>
        <button aria-label={`Remove ${s.title}`} onClick={onRemove} className="grid size-6 place-items-center rounded-full bg-shasta-field text-shasta-muted hover:text-shasta-danger">
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  )
}

function ShortcutDialog({ editing, onClose }: { editing: Shortcut | 'new' | null; onClose: () => void }) {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [seed, setSeed] = useState<unknown>(null)
  if (editing !== seed) {
    setSeed(editing)
    setTitle(editing && editing !== 'new' ? editing.title : '')
    setUrl(editing && editing !== 'new' ? editing.url : '')
    setError('')
  }

  const save = () => {
    const r = resolveInput(url, settings.searchEngine)
    if (r.kind !== 'url') return setError('Enter a web address such as example.com')
    const entry: Shortcut = { id: editing && editing !== 'new' ? editing.id : uid(), title: title.trim() || hostOf(r.url), url: r.url }
    update({ shortcuts: editing === 'new' ? [...settings.shortcuts, entry] : settings.shortcuts.map((s) => (s.id === entry.id ? entry : s)) })
    onClose()
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing === 'new' ? 'Add shortcut' : 'Edit shortcut'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="grid gap-1 text-xs text-muted-foreground">
            Name
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Example" maxLength={30} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Address
            <Input value={url} onChange={(e) => { setUrl(e.target.value); setError('') }} placeholder="https://example.com" aria-invalid={!!error} spellCheck={false} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const plainTile = 'flex w-24 flex-col items-center gap-2 rounded-2xl p-2 text-sm text-shasta-muted transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg'

function ShortcutsWidget({ tabId }: WidgetProps) {
  const shortcuts = useSettings((s) => s.settings.shortcuts)
  const update = useSettings((s) => s.update)
  const navigateTo = useTabs((s) => s.navigateTo)
  const openInternal = useTabs((s) => s.openInternal)
  const [editing, setEditing] = useState<Shortcut | 'new' | null>(null)
  return (
    <div className="flex flex-wrap justify-center gap-x-1 gap-y-3">
      {shortcuts.map((s) => (
        <ShortcutTile key={s.id} s={s} onOpen={() => navigateTo(tabId, s.url)} onEdit={() => setEditing(s)} onRemove={() => update({ shortcuts: shortcuts.filter((x) => x.id !== s.id) })} />
      ))}
      <button onClick={() => openInternal('store')} className={plainTile}>
        <span className="grid size-14 place-items-center rounded-xl bg-shasta-home ring-1 ring-shasta-line">
          <Store className="size-6" strokeWidth={1.5} />
        </span>
        Store
      </button>
      <button onClick={() => openInternal('watch')} className={plainTile}>
        <span className="grid size-14 place-items-center rounded-xl bg-shasta-home ring-1 ring-shasta-line">
          <Film className="size-6" strokeWidth={1.5} />
        </span>
        Watch
      </button>
      {shortcuts.length < 12 && (
        <button onClick={() => setEditing('new')} className={plainTile}>
          <span className="grid size-14 place-items-center rounded-xl border border-dashed border-shasta-line">
            <Plus className="size-6" strokeWidth={1.5} />
          </span>
          Add shortcut
        </button>
      )}
      <ShortcutDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

// ---- Store apps, trending, bookmarks, history -------------------------------------------------------------------

function AppsWidget() {
  useStoreBoot()
  const library = useStore((s) => s.library)
  const launch = useStore((s) => s.launch)
  const openInternal = useTabs((s) => s.openInternal)
  const items = useMemo(() => {
    const ok = (library?.installed ?? []).filter((i) => i.available)
    return [...ok].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastLaunchedAt ?? b.installedAt) - (a.lastLaunchedAt ?? a.installedAt)).slice(0, 12)
  }, [library])
  if (!items.length)
    return (
      <Empty>
        <span>
          Games and apps you install show up here.{' '}
          <button onClick={() => openInternal('store')} className="text-shasta-fg underline-offset-4 hover:underline">Open the Store</button>
        </span>
      </Empty>
    )
  return (
    <ul className="flex flex-wrap gap-x-1 gap-y-2">
      {items.map((i) => (
        <li key={i.app.id} className="w-24">
          <button onClick={() => void launch(i.app.id)} className="relative flex w-full flex-col items-center gap-1.5 rounded-2xl p-2 text-xs text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg" title={i.updateAvailable ? `${i.app.name} (update available)` : i.app.name}>
            <AppIcon app={i.app} size={52} />
            {i.updateAvailable && <span className="absolute top-1 right-3 size-2 rounded-full bg-shasta-accent ring-2 ring-shasta-bg" aria-label="Update available" />}
            <span className="w-full truncate text-center">{i.app.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function LiveWidget({ tabId, isPrivate }: WidgetProps) {
  const navigateTo = useTabs((s) => s.navigateTo)
  if (isPrivate) return <Empty>Hidden in private tabs</Empty>
  return <LivePulse embedded onOpenSite={(url) => navigateTo(tabId, url)} />
}

function BookmarksWidget({ tabId }: WidgetProps) {
  const bookmarks = useLibrary((s) => s.bookmarks)
  const navigateTo = useTabs((s) => s.navigateTo)
  const top = useMemo(() => childrenOf(bookmarks, null).filter((b) => b.type === 'bookmark').slice(0, 8), [bookmarks])
  if (!top.length) return <Empty>Press the star in the address bar to bookmark a page</Empty>
  return (
    <ul className="grid gap-0.5 @md/w:grid-cols-2">
      {top.map((b) =>
        b.type === 'bookmark' ? (
          <li key={b.id}>
            <button onClick={() => navigateTo(tabId, b.url)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-shasta-hover">
              <Favicon url={b.url} />
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
            </button>
          </li>
        ) : null,
      )}
    </ul>
  )
}

function RecentWidget({ tabId, isPrivate }: WidgetProps) {
  const history = useLibrary((s) => s.history)
  const saveHistory = useSettings((s) => s.settings.saveHistory)
  const navigateTo = useTabs((s) => s.navigateTo)
  const recent = useMemo(() => {
    const seen = new Set<string>()
    const out = []
    for (const h of history) {
      const o = originOf(h.url)
      if (!o || seen.has(o)) continue
      seen.add(o)
      out.push(h)
      if (out.length === 6) break
    }
    return out
  }, [history])
  if (isPrivate) return <Empty>Hidden in private tabs</Empty>
  if (!recent.length) return <Empty>{saveHistory ? 'Sites you visit show up here' : 'History saving is off in Settings'}</Empty>
  return (
    <ul className="grid gap-0.5 @md/w:grid-cols-2">
      {recent.map((h) => (
        <li key={h.id}>
          <button onClick={() => navigateTo(tabId, h.url)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-shasta-hover">
            <Favicon url={h.url} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{h.title}</span>
              <span className="block truncate text-xs text-shasta-muted">{displayUrl(h.url)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---- clock ------------------------------------------------------------------------------------------------------

function AnalogClock({ d }: { d: Date }) {
  const s = d.getSeconds()
  const m = d.getMinutes() + s / 60
  const h = (d.getHours() % 12) + m / 60
  return (
    <svg viewBox="0 0 100 100" className="aspect-square h-full max-h-40 w-auto" role="img" aria-label={d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}>
      <circle cx="50" cy="50" r="47" className="fill-shasta-field stroke-shasta-line" strokeWidth="1" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="7" x2="50" y2={i % 3 === 0 ? 14 : 11} className="stroke-shasta-muted" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round" transform={`rotate(${i * 30} 50 50)`} />
      ))}
      <line x1="50" y1="50" x2="50" y2="27" className="stroke-shasta-fg" strokeWidth="3.5" strokeLinecap="round" transform={`rotate(${h * 30} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="15" className="stroke-shasta-fg" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${m * 6} 50 50)`} />
      <line x1="50" y1="56" x2="50" y2="13" className="stroke-shasta-accent" strokeWidth="1" strokeLinecap="round" transform={`rotate(${s * 6} 50 50)`} />
      <circle cx="50" cy="50" r="2.4" className="fill-shasta-accent" />
    </svg>
  )
}

function ClockWidget({ w }: WidgetProps) {
  const face = w.config.face ?? 'analog'
  const now = new Date(useNow(face === 'analog' ? 1000 : 5000))
  const hour12 = w.config.hour12 ?? true
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  if (face === 'analog')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <AnalogClock d={now} />
        <p className="text-sm leading-5 text-shasta-muted">{date}</p>
      </div>
    )
  if (face === 'words')
    return (
      <div className="flex h-full flex-col justify-center">
        <p className="text-2xl leading-8 font-medium tracking-[-0.02em] text-balance @md/w:text-3xl @md/w:leading-9">{timeInWords(now)}</p>
        <p className="mt-2 text-sm leading-5 text-shasta-muted">{date}</p>
      </div>
    )
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <p className="home-fig text-4xl font-normal @md/w:text-5xl">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 })}</p>
      <p className="mt-2 text-sm leading-5 text-shasta-muted">{date}</p>
    </div>
  )
}

// ---- sticky note ------------------------------------------------------------------------------------------------

function NotesWidget({ w, isPrivate }: WidgetProps) {
  const note = useHome((s) => s.notes[w.id] ?? '')
  const setNote = useHome((s) => s.setNote)
  const tinted = (w.config.color ?? 'yellow') !== 'plain'
  return (
    <textarea
      aria-label="Sticky note"
      value={note}
      onChange={(e) => setNote(w.id, e.target.value)}
      placeholder={isPrivate ? 'Saved on this device, even in a private tab' : 'Write something down'}
      spellCheck
      maxLength={5000}
      className={cn('relative h-full min-h-32 w-full resize-none bg-transparent text-[15px] leading-6 outline-none', !tinted && 'placeholder:text-shasta-muted')}
    />
  )
}

// ---- to-do ------------------------------------------------------------------------------------------------------

function TodoWidget({ w }: WidgetProps) {
  const todos = useHome((s) => s.todos[w.id])
  const setTodos = useHome((s) => s.setTodos)
  const list = todos ?? []
  const [draft, setDraft] = useState('')
  const done = list.filter((t) => t.done).length
  const add = () => {
    const text = draft.trim()
    if (!text) return
    setTodos(w.id, [...list, { id: newId(), text: text.slice(0, 200), done: false }])
    setDraft('')
  }
  const set = (id: string, patch: Partial<Todo>) => setTodos(w.id, list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  return (
    <div className="flex h-full flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="flex items-center gap-2 rounded-xl bg-shasta-field px-3 ring-1 ring-shasta-line focus-within:ring-shasta-accent/60"
      >
        <Plus className="size-4 shrink-0 text-shasta-muted" />
        <input aria-label="Add a task" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task" maxLength={200} className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-shasta-muted" />
      </form>
      {list.length === 0 ? (
        <p className="py-2 text-sm leading-5 text-shasta-muted">Nothing on the list</p>
      ) : (
        <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
          {list.map((t) => (
            <li key={t.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-shasta-hover">
              <button
                role="checkbox"
                aria-checked={t.done}
                aria-label={t.text}
                onClick={() => set(t.id, { done: !t.done })}
                className={cn('grid size-5 shrink-0 place-items-center rounded-md ring-1 transition-colors duration-150 ease-shasta', t.done ? 'bg-shasta-accent text-shasta-accent-fg ring-shasta-accent' : 'ring-shasta-muted/50 hover:ring-shasta-fg')}
              >
                {t.done && <Check className="size-3.5" strokeWidth={3} />}
              </button>
              <span className={cn('min-w-0 flex-1 text-sm break-words', t.done && 'text-shasta-muted line-through')}>{t.text}</span>
              <button aria-label={`Delete ${t.text}`} onClick={() => setTodos(w.id, list.filter((x) => x.id !== t.id))} className="grid size-6 place-items-center rounded text-shasta-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-shasta-danger">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {done > 0 && (
        <button onClick={() => setTodos(w.id, list.filter((t) => !t.done))} className="self-start text-xs text-shasta-muted hover:text-shasta-fg">
          Clear {done} done
        </button>
      )}
    </div>
  )
}

// ---- focus timer ------------------------------------------------------------------------------------------------

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function FocusWidget({ w }: WidgetProps) {
  const st = useHome((s) => s.focus[w.id])
  const setFocus = useHome((s) => s.setFocus)
  const phase = st?.phase ?? 'work'
  const total = ((phase === 'work' ? w.config.work : w.config.rest) ?? (phase === 'work' ? 25 : 5)) * 60_000
  const running = st?.endsAt != null
  const now = useNow(running ? 250 : null)
  const left = Math.min(total, running ? Math.max(0, st!.endsAt! - now) : (st?.leftMs ?? total))
  const progress = 1 - left / total
  return (
    <div className="flex h-full flex-col">
      <p className="home-label">{phase === 'work' ? 'Focus' : 'Break'}{st && !running && <span>Paused</span>}</p>
      <p className="home-fig text-4xl leading-10" aria-live="off">{mmss(left)}</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-shasta-field" aria-hidden>
        <div className={cn('h-full rounded-full', phase === 'work' ? 'bg-shasta-accent' : 'bg-shasta-muted')} style={{ width: `${progress * 100}%`, transition: running ? 'width 250ms linear' : undefined }} />
      </div>
      <div className="mt-auto flex items-center gap-1 pt-4">
        <Button
          size="sm"
          onClick={() => setFocus(w.id, running ? { phase, endsAt: null, leftMs: left } : { phase, endsAt: Date.now() + left, leftMs: null })}
          className="gap-1.5"
        >
          {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {running ? 'Pause' : st ? 'Resume' : 'Start'}
        </Button>
        <Button size="icon" variant="ghost" className="size-8" aria-label={phase === 'work' ? 'Skip to the break' : 'Skip the break'} title={phase === 'work' ? 'Skip to the break' : 'Skip the break'} onClick={() => setFocus(w.id, { phase: phase === 'work' ? 'rest' : 'work', endsAt: null, leftMs: null })}>
          <SkipForward className="size-4" strokeWidth={1.5} />
        </Button>
        {st && (
          <Button size="icon" variant="ghost" className="size-8" aria-label="Reset" title="Reset" onClick={() => setFocus(w.id, null)}>
            <RotateCcw className="size-4" strokeWidth={1.5} />
          </Button>
        )}
      </div>
    </div>
  )
}

// ---- countdown --------------------------------------------------------------------------------------------------

function CountdownWidget({ w, onOptions }: WidgetProps) {
  const now = useNow(60_000)
  const view = countdown(w.config, new Date(now))
  if (!view) return <Empty><button onClick={onOptions} className="underline-offset-4 hover:underline">Pick a date</button></Empty>
  const n = Math.abs(view.days)
  const when = view.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const label = view.on ? `${view.title}, left` : view.days < 0 ? `Since ${view.title}` : view.title
  return (
    <div className="flex h-full flex-col">
      <p className="home-label"><span className="truncate">{label}</span></p>
      <p className="mt-auto flex items-baseline gap-2">
        <span className="home-fig text-5xl leading-none">{view.days === 0 && !view.on ? 'Today' : n}</span>
        {!(view.days === 0 && !view.on) && <span className="text-sm text-shasta-muted">{n === 1 ? 'day' : 'days'}</span>}
      </p>
      <p className="mt-2 text-sm leading-5 text-shasta-muted">{view.on ? `Back on ${when}` : when}</p>
    </div>
  )
}

// ---- class schedule ---------------------------------------------------------------------------------------------

function ScheduleWidget({ w, onOptions }: WidgetProps) {
  const periods = useHome((s) => s.schedules[w.id])
  const now = useNow(15_000)
  const hour12 = useMemo(() => localeHour12(), [])
  const list = periods ?? []
  const at = new Date(now)
  const state = scheduleNow(list, at)
  if (state.kind === 'empty')
    return (
      <div className="flex h-full flex-col items-start justify-end gap-3">
        <p className="text-sm leading-5 text-shasta-muted">Add your class times once. Then you see which class you are in and how long is left.</p>
        <Button size="sm" variant="outline" onClick={onOptions}>Add my classes</Button>
      </div>
    )
  const at12 = (hm: string) => formatHm(hm, hour12)
  let title: string
  let line: string
  let bar: number | null = null
  let nextLine: string | null = null
  switch (state.kind) {
    case 'in':
      title = state.now.name
      line = `${state.leftMin} min left · ends ${at12(state.now.end)}`
      bar = state.progress
      nextLine = state.next ? `Next: ${state.next.name} at ${at12(state.next.start)}` : 'Last one today'
      break
    case 'between':
      title = `${state.next.name} next`
      line = `Starts in ${state.inMin} min, at ${at12(state.next.start)}`
      break
    case 'before':
      title = `${state.next.name} first`
      line = state.inMin <= 120 ? `Starts in ${state.inMin} min, at ${at12(state.next.start)}` : `Starts at ${at12(state.next.start)}`
      break
    case 'after':
      title = 'Done for today'
      line = `Tomorrow starts at ${at12(list[0].start)}`
      break
    case 'weekend':
      title = 'No classes today'
      line = 'Enjoy the weekend.'
      break
  }
  return (
    <div className="flex h-full flex-col justify-end">
      <p className="text-sm leading-5 text-shasta-muted">{state.kind === 'in' ? 'Now' : at.toLocaleDateString([], { weekday: 'long' })}</p>
      <p className="truncate text-2xl leading-8 font-medium tracking-[-0.02em]">{title}</p>
      <p className="mt-1 text-sm leading-5 text-shasta-muted tabular-nums">{line}</p>
      {bar !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-shasta-field" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bar * 100)} aria-label="Class progress">
          <div className="h-full rounded-full bg-shasta-accent transition-[width] duration-500 ease-shasta" style={{ width: `${bar * 100}%` }} />
        </div>
      )}
      {nextLine && <p className="mt-3 text-sm leading-5 text-shasta-muted tabular-nums">{nextLine}</p>}
    </div>
  )
}

// ---- quote ------------------------------------------------------------------------------------------------------

function QuoteWidget({ w }: WidgetProps) {
  const kinds = w.config.kinds ?? []
  const every = w.config.every ?? 'tab'
  const [library, setLibrary] = useState<QuoteItem[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadQuotes().then((q) => alive && setLibrary(q))
    return () => {
      alive = false
    }
  }, [])
  const kindsKey = kinds.join()
  const pool = useMemo(() => (library ? quotesOf(library, kindsKey ? (kindsKey.split(',') as QuoteKind[]) : []) : []), [library, kindsKey])
  // a fresh pick each time the page opens (or one a day); "Another" steps along the list
  const [seed] = useState(() => Math.random())
  const [skip, setSkip] = useState(0)
  const [shown, setShown] = useState(false)
  const now = useNow(every === 'day' ? 60 * 60_000 : null)
  const mine = w.config.onlyMine && w.config.mine ? w.config.mine : null
  const pick = mine ? null : pickQuote(pool, every, seed, skip, new Date(now))
  const kind = pick ? QUOTE_KINDS.find((k) => k.id === pick.kind)?.label : null
  const next = () => {
    setShown(false)
    setSkip((n) => n + 1)
  }

  if (mine)
    return (
      <figure className="flex h-full flex-col justify-between gap-4">
        <blockquote className="text-lg leading-7 text-balance">“{mine}”</blockquote>
        {w.config.mineBy && <figcaption className="text-sm leading-5 text-shasta-muted">{w.config.mineBy}</figcaption>}
      </figure>
    )
  if (!pick) return <div className="h-full min-h-24" aria-busy={!library} />
  return (
    <figure className="flex h-full flex-col gap-3">
      <p className="home-label mb-0">
        <span>{kind}</span>
        <button onClick={next} className="pr-8 transition-colors duration-150 ease-shasta hover:text-shasta-fg">Another</button>
      </p>
      {pick.answer ? (
        <>
          <blockquote className="text-lg leading-7 text-balance">{pick.text}</blockquote>
          {shown ? (
            <p className="text-lg leading-7 text-shasta-muted">{pick.answer}</p>
          ) : (
            <button onClick={() => setShown(true)} className="self-start text-sm leading-5 text-shasta-muted underline-offset-4 hover:text-shasta-fg hover:underline">
              Show the answer
            </button>
          )}
        </>
      ) : (
        <>
          <blockquote className="text-lg leading-7 text-balance">“{pick.text}”</blockquote>
          <figcaption className="mt-auto text-sm leading-5 text-shasta-muted">{pick.by}</figcaption>
        </>
      )}
    </figure>
  )
}

export const WIDGET_BODY: Record<WidgetType, ComponentType<WidgetProps>> = {
  shortcuts: ShortcutsWidget,
  apps: AppsWidget,
  live: LiveWidget,
  bookmarks: BookmarksWidget,
  recent: RecentWidget,
  clock: ClockWidget,
  notes: NotesWidget,
  todo: TodoWidget,
  focus: FocusWidget,
  countdown: CountdownWidget,
  schedule: ScheduleWidget,
  quote: QuoteWidget,
}

/** "See all" links in a widget's header. */
export const WIDGET_LINK: Partial<Record<WidgetType, { label: string; page: 'library' | 'bookmarks' | 'history' }>> = {
  apps: { label: 'Library', page: 'library' },
  bookmarks: { label: 'View all', page: 'bookmarks' },
  recent: { label: 'History', page: 'history' },
}
