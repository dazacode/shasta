// Dialogs for the new tab home: adding widgets and templates, one widget's options, sharing and opening a shared home.
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Link as LinkIcon, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented, Toggle } from '@/pages/settingsParts'
import { useHome } from '@/stores/homeStore'
import { NEW_TAB_CLOCKS, NEW_TAB_STYLES, useSettings, type NewTabClock, type NewTabStyle, type Settings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { WALLPAPERS, isWallpaper, wallpaperBackground, type WallpaperName } from '@/lib/wallpaper'
import { siteOrigin } from '@/lib/shareLink'
import { uid } from '@/lib/tabModel'
import {
  MAX_WIDGETS, NOTE_COLORS, TEMPLATES, WIDGETS, WIDGET_TYPES, bellSchedule, canAdd, countdown, decodeHome, encodeHome, fromTemplate, hmOf, minutesOf, sanitizePeriods,
  type ClockFace, type NoteColor, type Period, type SharedHome, type SharedLook, type Widget, type WidgetType,
} from '@/lib/home'
import { cn } from '@/lib/utils'
import { QUOTE_KINDS, QUOTE_SOURCES, type QuoteKind } from '@/lib/quotes'
import { WIDGET_ICON } from './widgets'

const NO_WIDGETS: Widget[] = []
const PAPER: Record<string, string> = { yellow: 'bg-[#f3e7c4]', pink: 'bg-[#f2d3d8]', blue: 'bg-[#d5e3ee]', green: 'bg-[#d7e8d3]' }

// ---- add a widget / start from a template ---------------------------------------------------------------------

export function AddWidgetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const widgets = useHome((s) => s.widgets) ?? NO_WIDGETS
  const add = useHome((s) => s.add)
  const [tab, setTab] = useState<'widgets' | 'templates'>('widgets')
  const full = widgets.length >= MAX_WIDGETS
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add to your page</DialogTitle>
          <DialogDescription>{full ? `That is ${MAX_WIDGETS} widgets, the most a page holds. Remove one to add another.` : 'Pick a widget, or start from a ready-made page'}</DialogDescription>
        </DialogHeader>
        <Segmented<'widgets' | 'templates'> label="Add" value={tab} onChange={setTab} options={[{ value: 'widgets', label: 'Widgets' }, { value: 'templates', label: 'Ready-made pages' }]} />
        {tab === 'widgets' ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {WIDGET_TYPES.map((type) => {
              const Icon = WIDGET_ICON[type]
              const ok = canAdd(widgets, type)
              const info = WIDGETS[type]
              return (
                <li key={type}>
                  <button
                    disabled={!ok}
                    onClick={() => {
                      const id = add(type)
                      if (!id) return
                      onClose()
                      useUi.getState().toast(`${info.name} added at the bottom`)
                      requestAnimationFrame(() => document.querySelector(`[data-widget="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
                    }}
                    className="flex h-full w-full items-start gap-3 rounded-xl p-3 text-left ring-1 ring-shasta-line transition-colors duration-150 ease-shasta hover:bg-shasta-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-shasta-field">
                      <Icon className="size-4.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {info.name}
                        {!ok && !full && <span className="text-xs font-normal text-shasta-muted">On your page</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-shasta-muted">{info.blurb}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <TemplateList onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Ready-made pages. Picking one replaces the widgets (with Undo); notes and to-dos of removed widgets go with them. */
export function TemplateList({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const pick = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) return
    const home = useHome.getState()
    const before = home.widgets ?? []
    home.setWidgets(fromTemplate(t))
    home.finishIntro()
    onDone?.()
    useUi.getState().toast(`Switched to ${t.name}`, { action: { label: 'Undo', run: () => useHome.getState().setWidgets(before) }, ms: 8000 })
  }
  return (
    <ul className={cn('grid gap-3', compact ? 'grid-cols-2 sm:grid-cols-4' : 'sm:grid-cols-2')}>
      {TEMPLATES.map((t) => (
        <li key={t.id}>
          <button onClick={() => pick(t.id)} className="flex h-full w-full flex-col gap-3 rounded-xl p-2 pb-3 text-left ring-1 ring-shasta-line transition-colors duration-150 ease-shasta hover:bg-shasta-hover focus-visible:ring-2 focus-visible:ring-shasta-accent">
            <TemplatePreview widgets={t.widgets.map(([type, size]) => ({ type, size }))} />
            <span className="px-1">
              <span className="block text-sm leading-5 font-medium">{t.name}</span>
              <span className={cn('block text-sm leading-5 text-shasta-muted', compact && 'line-clamp-2')}>{t.blurb}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A small drawing of a layout, drawn like the page: one block per widget at its size, in a fixed-height frame. */
function TemplatePreview({ widgets }: { widgets: { type: WidgetType; size: string }[] }) {
  return (
    <span className="grid h-24 grid-cols-4 content-start gap-1 overflow-hidden rounded-lg bg-shasta-field p-2" aria-hidden>
      {widgets.map((w, i) => (
        <span
          key={i}
          className={cn('rounded-[3px] bg-shasta-fg/12', w.size === 's' ? 'col-span-1 h-6' : w.size === 'm' ? 'col-span-2 h-6' : 'col-span-4 h-3', w.type === 'notes' && 'bg-[#f3e7c4]/80')}
        />
      ))}
    </span>
  )
}

// ---- one widget's options -------------------------------------------------------------------------------------

export function WidgetOptionsDialog({ widget, onClose }: { widget: Widget | null; onClose: () => void }) {
  return (
    <Dialog open={!!widget} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{widget ? WIDGETS[widget.type].name : ''}</DialogTitle>
        </DialogHeader>
        {widget && <WidgetOptions key={widget.id} widget={widget} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-1.5">
    <span className="text-xs text-shasta-muted">{label}</span>
    {children}
  </div>
)

const timeCls = 'h-9 rounded-lg border border-shasta-line bg-shasta-field px-2 text-sm text-shasta-fg tabular-nums'

function WidgetOptions({ widget: w, onClose }: { widget: Widget; onClose: () => void }) {
  const configure = useHome((s) => s.configure)
  const set = (c: Widget['config']) => configure(w.id, c)
  switch (w.type) {
    case 'clock':
      return (
        <div className="grid gap-4">
          <Field label="Style">
            <Segmented<ClockFace> label="Clock style" value={w.config.face ?? 'analog'} onChange={(face) => set({ face })} options={[{ value: 'analog', label: 'Hands' }, { value: 'digital', label: 'Numbers' }, { value: 'words', label: 'Words' }]} />
          </Field>
          {w.config.face === 'digital' && (
            <label className="flex items-center justify-between gap-3 text-sm" htmlFor={`h12-${w.id}`}>
              12-hour time
              <Toggle id={`h12-${w.id}`} label="12-hour time" checked={w.config.hour12 ?? true} onChange={(hour12) => set({ hour12 })} />
            </label>
          )}
        </div>
      )
    case 'notes':
      return (
        <Field label="Colour">
          <div className="flex gap-2" role="radiogroup" aria-label="Note colour">
            {NOTE_COLORS.map((c: NoteColor) => (
              <button
                key={c}
                role="radio"
                aria-checked={(w.config.color ?? 'yellow') === c}
                aria-label={c === 'plain' ? 'Plain' : c}
                onClick={() => set({ color: c })}
                className={cn('size-9 rounded-full ring-1 ring-shasta-line ring-offset-2 ring-offset-shasta-bg', c === 'plain' ? 'bg-shasta-home' : PAPER[c], (w.config.color ?? 'yellow') === c && 'ring-2 ring-shasta-fg')}
              />
            ))}
          </div>
        </Field>
      )
    case 'focus':
      return (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Focus for (minutes)">
            <Input type="number" min={1} max={120} value={w.config.work ?? 25} onChange={(e) => set({ work: Number(e.target.value) })} />
          </Field>
          <Field label="Break for (minutes)">
            <Input type="number" min={1} max={60} value={w.config.rest ?? 5} onChange={(e) => set({ rest: Number(e.target.value) })} />
          </Field>
          <p className="col-span-2 text-xs text-shasta-muted">When time is up, Shasta shows a message wherever you are in the browser and plays a short sound.</p>
        </div>
      )
    case 'countdown':
      return <CountdownOptions w={w} set={set} />
    case 'quote':
      return <QuoteOptions w={w} set={set} />
    case 'schedule':
      return <ScheduleEditor id={w.id} onClose={onClose} />
    default:
      return <p className="text-sm text-shasta-muted">This widget has no options.</p>
  }
}

function CountdownOptions({ w, set }: { w: Widget; set: (c: Widget['config']) => void }) {
  const auto = countdown({ mode: 'break' })
  const [want, setWant] = useState<'break' | 'date'>(w.config.mode ?? 'break')
  const [title, setTitle] = useState(w.config.title ?? '')
  const [date, setDate] = useState(w.config.date ?? '')
  const save = (d = date, t = title) => d && set({ mode: 'date', date: d, title: t })
  return (
    <div className="grid gap-4">
      <Segmented<'break' | 'date'>
        label="Count down to"
        value={want}
        onChange={(m) => {
          setWant(m)
          if (m === 'break') set({ mode: 'break' })
          else save()
        }}
        options={[{ value: 'break', label: 'Next school break' }, { value: 'date', label: 'A date I pick' }]}
      />
      {want === 'break' ? (
        auto && <p className="text-sm text-shasta-muted">Right now: {auto.title}, {auto.date.toLocaleDateString([], { month: 'long', day: 'numeric' })}. Breaks follow the usual US school calendar.</p>
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="What is it?">
            <Input value={title} maxLength={40} placeholder="My birthday" onChange={(e) => setTitle(e.target.value)} onBlur={() => save()} />
          </Field>
          <Field label="Date">
            <input type="date" aria-label="Date" className={timeCls} value={date} onChange={(e) => { setDate(e.target.value); save(e.target.value) }} />
          </Field>
        </div>
      )}
    </div>
  )
}

function QuoteOptions({ w, set }: { w: Widget; set: (c: Widget['config']) => void }) {
  const kinds = w.config.kinds ?? []
  const all = kinds.length === 0
  const [mine, setMine] = useState(w.config.mine ?? '')
  const [by, setBy] = useState(w.config.mineBy ?? '')
  const toggle = (k: QuoteKind) => {
    const on = all ? QUOTE_KINDS.map((x) => x.id).filter((x) => x !== k) : kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]
    // every kind on (or none left) means "all of them"
    set({ kinds: on.length === QUOTE_KINDS.length ? [] : on.length ? on : [] })
  }
  const saveMine = () => set({ mine, mineBy: by, onlyMine: !!mine.trim() && (w.config.onlyMine ?? false) })
  return (
    <div className="grid gap-5">
      <Field label="Show quotes from">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Kinds of quotes">
          {QUOTE_KINDS.map((k) => {
            const on = all || kinds.includes(k.id)
            return (
              <button
                key={k.id}
                aria-pressed={on}
                disabled={!!w.config.onlyMine}
                onClick={() => toggle(k.id)}
                className={cn('flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm ring-1 transition-colors duration-150 ease-shasta disabled:opacity-50', on ? 'bg-shasta-fg text-shasta-bg ring-shasta-fg' : 'text-shasta-muted ring-shasta-line hover:text-shasta-fg')}
              >
                {on && <Check className="size-3.5" />}
                {k.label}
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="A new one">
        <Segmented<'tab' | 'day'> label="How often" value={w.config.every ?? 'tab'} onChange={(every) => set({ every })} options={[{ value: 'tab', label: 'Every new tab' }, { value: 'day', label: 'Once a day' }]} />
      </Field>
      <div className="grid gap-3 border-t border-shasta-line pt-4">
        <Field label="Your own quote">
          <textarea value={mine} maxLength={280} rows={3} onChange={(e) => setMine(e.target.value)} onBlur={saveMine} placeholder="A line you want to see every day" className="w-full resize-none rounded-lg border border-shasta-line bg-shasta-field px-3 py-2 text-sm outline-none focus:border-shasta-accent" />
        </Field>
        <Field label="Who said it (optional)">
          <Input value={by} maxLength={60} onChange={(e) => setBy(e.target.value)} onBlur={saveMine} placeholder="Me" />
        </Field>
        <label className="flex items-center justify-between gap-3 text-sm" htmlFor={`only-${w.id}`}>
          Show only my quote
          <Toggle id={`only-${w.id}`} label="Show only my quote" checked={!!w.config.onlyMine} disabled={!mine.trim()} onChange={(onlyMine) => set({ mine, mineBy: by, onlyMine })} />
        </label>
        <p className="text-xs text-shasta-muted">Your quote stays on this device. Sharing your page never includes it.</p>
      </div>
      <p className="border-t border-shasta-line pt-4 text-xs leading-5 text-shasta-muted">
        Quotes and jokes come from open datasets on GitHub (MIT licence):{' '}
        {QUOTE_SOURCES.map((src, i) => (
          <span key={src.url}>
            {i > 0 && ', '}
            <a href={src.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-shasta-fg">{src.name}</a>
            {src.by ? ` by ${src.by}` : ''} ({src.what})
          </span>
        ))}
        .
      </p>
    </div>
  )
}

function ScheduleEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const saved = useHome((s) => s.schedules[id])
  const setSchedule = useHome((s) => s.setSchedule)
  const [rows, setRows] = useState<Period[]>(() => (saved?.length ? saved : []))
  const [fill, setFill] = useState({ start: '08:00', count: 7, length: 50, gap: 5 })
  const valid = useMemo(() => sanitizePeriods(rows), [rows])
  const bad = rows.length - valid.length
  const setRow = (i: number, patch: Partial<Period>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const last = rows[rows.length - 1]
  return (
    <div className="grid gap-4">
      <p className="text-sm text-shasta-muted">Monday to Friday. Saved on this device only, never shared.</p>
      {rows.length === 0 ? (
        <div className="grid gap-3 rounded-xl bg-shasta-field p-3">
          <p className="text-sm font-medium">Start with a usual bell schedule</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="First class">
              <input type="time" className={timeCls} value={fill.start} onChange={(e) => setFill({ ...fill, start: e.target.value || '08:00' })} />
            </Field>
            <Field label="Classes">
              <Input type="number" min={1} max={12} value={fill.count} onChange={(e) => setFill({ ...fill, count: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="Minutes each">
              <Input type="number" min={5} max={180} value={fill.length} onChange={(e) => setFill({ ...fill, length: Math.max(5, Math.min(180, Number(e.target.value) || 50)) })} />
            </Field>
            <Field label="Minutes between">
              <Input type="number" min={0} max={30} value={fill.gap} onChange={(e) => setFill({ ...fill, gap: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />
            </Field>
          </div>
          <Button variant="outline" className="justify-self-start" onClick={() => setRows(bellSchedule(fill.start, fill.count, fill.length, fill.gap))}>
            Fill in my day
          </Button>
          <p className="text-xs text-shasta-muted">You can rename each class and fix the times after.</p>
        </div>
      ) : (
        <ol className="grid gap-2">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
              <Input aria-label={`Class ${i + 1} name`} value={r.name} maxLength={30} onChange={(e) => setRow(i, { name: e.target.value })} />
              <input aria-label={`${r.name || `Class ${i + 1}`} starts`} type="time" className={timeCls} value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} />
              <input aria-label={`${r.name || `Class ${i + 1}`} ends`} type="time" className={cn(timeCls, minutesOf(r.end) <= minutesOf(r.start) && 'border-shasta-danger')} value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} />
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${r.name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length >= 14}
            onClick={() => {
              const s = last ? minutesOf(last.end) + 5 : 480
              setRows([...rows, { name: `Period ${rows.length + 1}`, start: hmOf(Math.min(s, 23 * 60)), end: hmOf(Math.min(s + 50, 23 * 60 + 59)) }])
            }}
          >
            <Plus className="size-4" /> Add a class
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRows([])}>Start over</Button>
        </div>
      )}
      {bad > 0 && <p className="text-sm text-shasta-danger">{bad === 1 ? 'One class ends' : `${bad} classes end`} before {bad === 1 ? 'it starts' : 'they start'} and will be left out.</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => {
            setSchedule(id, rows)
            onClose()
          }}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

// ---- share ----------------------------------------------------------------------------------------------------

const LISTS = { styles: NEW_TAB_STYLES, wallpapers: (Object.keys(WALLPAPERS) as WallpaperName[]).filter((w) => !WALLPAPERS[w].claim), clocks: NEW_TAB_CLOCKS }

/** The look of this page as it would travel in a share code (never the person's own picture). */
export function lookOf(s: Settings): SharedLook {
  return {
    style: s.newTabStyle,
    wallpaper: WALLPAPERS[s.wallpaper]?.claim ? 'none' : s.wallpaper,
    bg: s.newTabBg === 'color' ? 'color' : 'preset',
    ...(s.newTabBg === 'color' ? { color: s.newTabBgColor, dim: s.newTabBgDim } : {}),
    clock: s.newTabClock,
    ...(s.newTabSearch ? {} : { search: false }),
    ...(s.newTabGreetingText.trim() ? { greeting: s.newTabGreetingText.trim() } : {}),
    ...(s.newTabHeadlineText.trim() ? { headline: s.newTabHeadlineText.trim() } : {}),
  }
}

export const decodeShared = (code: string) => decodeHome(code, LISTS)

export function ShareHomeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const widgets = useHome((s) => s.widgets) ?? NO_WIDGETS
  const settings = useSettings((s) => s.settings)
  const [withShortcuts, setWithShortcuts] = useState(false)
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const [paste, setPaste] = useState('')
  const [pasteError, setPasteError] = useState('')
  const code = useMemo(
    () => encodeHome({ widgets, look: lookOf(settings), shortcuts: withShortcuts ? settings.shortcuts.map((s) => ({ title: s.title, url: s.url })) : undefined }),
    [widgets, settings, withShortcuts],
  )
  const origin = siteOrigin()
  const link = origin ? `${origin}/?home=${code}` : null
  const copy = async (what: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(what === 'link' && link ? link : code)
      setCopied(what)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      useUi.getState().toast('Could not copy. Select the text and copy it yourself.', { tone: 'error' })
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share your page</DialogTitle>
          <DialogDescription>Friends get your widgets, their sizes and your look. Never what you wrote in them: notes, to-dos and class times stay on this device, and so does a picture of your own.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center justify-between gap-3 text-sm" htmlFor="share-shortcuts">
          Include my shortcuts ({settings.shortcuts.length})
          <Toggle id="share-shortcuts" label="Include my shortcuts" checked={withShortcuts} onChange={setWithShortcuts} />
        </label>
        <div className="grid gap-2">
          {link && (
            <Button onClick={() => void copy('link')} className="justify-center gap-2">
              {copied === 'link' ? <Check className="size-4" /> : <LinkIcon className="size-4" />}
              {copied === 'link' ? 'Link copied' : 'Copy link'}
            </Button>
          )}
          <div className="flex gap-2">
            <Input readOnly value={code} aria-label="Page code" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" onClick={() => void copy('code')} aria-label="Copy code" className="gap-2">
              {copied === 'code' ? <Check className="size-4" /> : <Copy className="size-4" />}
              Code
            </Button>
          </div>
        </div>
        <div className="mt-2 grid gap-2 border-t border-shasta-line pt-4">
          <p className="text-sm font-medium">Got a code from someone?</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!decodeShared(paste)) return setPasteError('That is not a Shasta page code.')
              useHome.getState().setPendingImport(paste.trim())
              setPaste('')
              onClose()
            }}
          >
            <Input value={paste} onChange={(e) => { setPaste(e.target.value); setPasteError('') }} placeholder="Paste a code or link" aria-label="Paste a page code" aria-invalid={!!pasteError} spellCheck={false} />
            <Button type="submit" variant="outline">Look</Button>
          </form>
          {pasteError && <p className="text-sm text-shasta-danger">{pasteError}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A shared page, shown before it replaces anything. */
export function ImportHomeDialog() {
  const pending = useHome((s) => s.pendingImport)
  const shared = useMemo(() => (pending ? decodeShared(pending) : null), [pending])
  const close = () => useHome.getState().setPendingImport(null)
  useEffect(() => {
    if (!pending || shared) return
    useHome.getState().setPendingImport(null)
    useUi.getState().toast('That page link is broken or from a newer Shasta.', { tone: 'error' })
  }, [pending, shared])
  const look = shared?.look
  const wall = look?.wallpaper && isWallpaper(look.wallpaper) ? (look.wallpaper as WallpaperName) : null
  return (
    <Dialog open={!!shared} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use this page?</DialogTitle>
          <DialogDescription>Someone shared their new tab page. It replaces your widgets and look; you can undo it right after.</DialogDescription>
        </DialogHeader>
        {shared && (
          <div className="grid gap-3">
            <div className="relative overflow-hidden rounded-xl p-3 ring-1 ring-shasta-line" style={{ background: look?.bg === 'color' && look.color ? look.color : wall ? wallpaperBackground(wall) : undefined }}>
              <TemplatePreview widgets={shared.widgets} />
            </div>
            <ul className="flex flex-wrap gap-1.5 text-xs">
              {shared.widgets.map((w) => (
                <li key={w.id} className="rounded-full bg-shasta-field px-2.5 py-1">{WIDGETS[w.type].name}</li>
              ))}
            </ul>
            {shared.shortcuts && <p className="text-xs text-shasta-muted">Also adds {shared.shortcuts.length} shortcut{shared.shortcuts.length === 1 ? '' : 's'} to yours.</p>}
            {(look?.greeting || look?.headline) && <p className="text-xs text-shasta-muted">With the words: “{[look.greeting, look.headline].filter(Boolean).join(' / ')}”</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>No thanks</Button>
              <Button
                onClick={() => {
                  applyShared(shared)
                  close()
                }}
              >
                Use this page
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Puts a shared page in place, with an Undo that restores the widgets and look from before. */
export function applyShared(shared: SharedHome) {
  const home = useHome.getState()
  const { settings, update } = useSettings.getState()
  const beforeWidgets = home.widgets ?? []
  const beforeLook: Partial<Settings> = {
    newTabStyle: settings.newTabStyle, wallpaper: settings.wallpaper, newTabBg: settings.newTabBg, newTabBgColor: settings.newTabBgColor, newTabBgDim: settings.newTabBgDim,
    newTabClock: settings.newTabClock, newTabSearch: settings.newTabSearch, newTabGreetingText: settings.newTabGreetingText, newTabHeadlineText: settings.newTabHeadlineText, shortcuts: settings.shortcuts,
  }
  const l = shared.look
  const patch: Partial<Settings> = {}
  if (l.style) patch.newTabStyle = l.style as NewTabStyle
  if (l.wallpaper && isWallpaper(l.wallpaper)) patch.wallpaper = l.wallpaper
  // a picture of the person's own stays theirs: a shared look never removes it
  if (l.bg && settings.newTabBg !== 'image') patch.newTabBg = l.bg
  if (l.color) patch.newTabBgColor = l.color
  if (l.dim !== undefined) patch.newTabBgDim = l.dim
  if (l.clock) patch.newTabClock = l.clock as NewTabClock
  patch.newTabSearch = l.search !== false
  patch.newTabGreetingText = l.greeting ?? ''
  patch.newTabHeadlineText = l.headline ?? ''
  if (shared.shortcuts) {
    const have = new Set(settings.shortcuts.map((s) => s.url))
    const extra = shared.shortcuts.filter((s) => !have.has(s.url)).map((s) => ({ id: uid(), title: s.title, url: s.url }))
    patch.shortcuts = [...settings.shortcuts, ...extra].slice(0, 12)
  }
  update(patch)
  home.setWidgets(shared.widgets)
  home.finishIntro()
  useUi.getState().toast('Done. This is your page now.', {
    ms: 10_000,
    action: {
      label: 'Undo',
      run: () => {
        useSettings.getState().update(beforeLook)
        useHome.getState().setWidgets(beforeWidgets)
      },
    },
  })
}
