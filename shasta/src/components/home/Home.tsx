// The new tab "home": the person's widgets in a grid they can add to, rearrange, resize and share (lib/home.ts).
// Edit mode is explicit (an "Edit page" button), like a phone's home screen: outside it the page is just the page.
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { GripVertical, Plus, Settings2, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHome } from '@/stores/homeStore'
import { useSettings } from '@/stores/settingsStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { WIDGETS, layoutFromLegacy, type Widget, type WidgetSize, type WidgetType } from '@/lib/home'
import { cn } from '@/lib/utils'
import { WIDGET_BODY, WIDGET_LINK } from './widgets'
import { AddWidgetDialog, ShareHomeDialog, TemplateList, WidgetOptionsDialog } from './HomeDialogs'

/** Widgets whose content needs a title to make sense; the others (a clock, a note, a timer) speak for themselves. */
const HEADED: WidgetType[] = ['apps', 'live', 'bookmarks', 'recent', 'todo', 'schedule']
const SIZE_LABEL: Record<WidgetSize, string> = { s: 'Small', m: 'Medium', l: 'Wide' }

/** The widgets on the page; the first time, the page the person already had (the old new tab sections). */
export function useHomeWidgets(): Widget[] {
  const widgets = useHome((s) => s.widgets)
  const settings = useSettings((s) => s.settings)
  const legacy = () =>
    layoutFromLegacy(settings.newTabOrder, { shortcuts: settings.newTabShortcuts, apps: settings.newTabApps, live: settings.newTabLive, bookmarks: settings.newTabBookmarks, recent: settings.newTabRecent })
  useEffect(() => {
    if (widgets === null) useHome.getState().setWidgets(legacy())
  }, [widgets])
  return widgets ?? legacy()
}

interface HomeProps {
  tabId: string
  isPrivate: boolean
  editing: boolean
  setEditing: (v: boolean) => void
}

export function Home({ tabId, isPrivate, editing, setEditing }: HomeProps) {
  const widgets = useHomeWidgets()
  const introDone = useHome((s) => s.introDone)
  const move = useHome((s) => s.move)
  const [options, setOptions] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const lastTarget = useRef<string | null>(null)
  const optionsWidget = widgets.find((w) => w.id === options) ?? null

  // Escape leaves edit mode (when no dialog is open: dialogs take Escape first)
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [editing, setEditing])

  // Dragging by the grip: the widget under the pointer swaps places; the same target is not swapped back until the
  // pointer leaves it (widgets of different sizes would otherwise flip back and forth).
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragId) return
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-widget]')
    const target = el?.dataset.widget ?? null
    if (!target || target === dragId) {
      lastTarget.current = null
      return
    }
    if (target === lastTarget.current) return
    lastTarget.current = target
    const list = useHome.getState().widgets ?? []
    move(list.findIndex((w) => w.id === dragId), list.findIndex((w) => w.id === target))
  }

  const remove = (w: Widget) => {
    const undo = useHome.getState().remove(w.id)
    useUi.getState().toast(`${WIDGETS[w.type].name} removed.`, { action: { label: 'Undo', run: undo }, ms: 7000 })
  }

  return (
    <div className="home-wrap">
      {!introDone && !isPrivate && !editing && (
        <section className="home-intro" aria-label="Make this page yours">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 className="text-[15px] leading-6 font-medium">Make this page yours</h2>
              <p className="text-sm leading-5 text-shasta-muted">Pick a starting point. You can move, resize or remove anything later.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => useHome.getState().finishIntro()}>Not now</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  useHome.getState().finishIntro()
                  setEditing(true)
                }}
              >
                Build my own
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <TemplateList compact />
          </div>
        </section>
      )}

      <div className="home-grid" data-editing={editing || undefined} onPointerMove={onDragMove}>
        {widgets.map((w, i) => (
          <Cell
            key={w.id}
            w={w}
            index={i}
            count={widgets.length}
            tabId={tabId}
            isPrivate={isPrivate}
            editing={editing}
            dragging={dragId === w.id}
            onDragStart={() => {
              lastTarget.current = null
              setDragId(w.id)
            }}
            onDragEnd={() => setDragId(null)}
            onOptions={() => setOptions(w.id)}
            onRemove={() => remove(w)}
          />
        ))}
        {editing && (
          <button onClick={() => setAdding(true)} className="home-cell home-add" data-size="s">
            <Plus className="size-5" strokeWidth={1.5} />
            Add a widget
          </button>
        )}
      </div>
      {!editing && widgets.length === 0 && (
        <button onClick={() => setEditing(true)} className="mx-auto flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-shasta-muted ring-1 ring-shasta-line transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg">
          <Plus className="size-4" strokeWidth={1.5} /> Add widgets
        </button>
      )}

      {editing && (
        <div className="home-editbar" role="toolbar" aria-label="Edit page">
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)} className="gap-2">
            <Plus className="size-4" strokeWidth={1.5} /> Add widget
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSharing(true)} className="gap-2">
            <Share2 className="size-4" strokeWidth={1.5} /> Share
          </Button>
          <span className="mx-1 h-5 w-px bg-shasta-line" aria-hidden />
          <Button size="sm" onClick={() => setEditing(false)}>Done</Button>
        </div>
      )}

      <AddWidgetDialog open={adding} onClose={() => setAdding(false)} />
      <ShareHomeDialog open={sharing} onClose={() => setSharing(false)} />
      <WidgetOptionsDialog widget={optionsWidget} onClose={() => setOptions(null)} />
    </div>
  )
}

interface CellProps {
  w: Widget
  index: number
  count: number
  tabId: string
  isPrivate: boolean
  editing: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOptions: () => void
  onRemove: () => void
}

function Cell({ w, index, count, tabId, isPrivate, editing, dragging, onDragStart, onDragEnd, onOptions, onRemove }: CellProps) {
  const info = WIDGETS[w.type]
  const Body = WIDGET_BODY[w.type]
  const link = WIDGET_LINK[w.type]
  const openInternal = useTabs((s) => s.openInternal)
  const resize = useHome((s) => s.resize)
  const move = useHome((s) => s.move)
  const bare = w.type === 'shortcuts'
  const paper = w.type === 'notes' && (w.config.color ?? 'yellow') !== 'plain' ? (w.config.color ?? 'yellow') : null
  const headed = HEADED.includes(w.type)

  return (
    <motion.div layout transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} data-widget={w.id} data-size={w.size} className={cn('home-cell', dragging && 'home-dragging')}>
      <section aria-label={info.name} className={cn('@container/w group/cell', bare ? 'home-bare' : 'home-card', paper && 'home-paper')} data-tone={paper ?? undefined}>
        {editing ? (
          <div className="home-edit-head">
            <button
              className="home-grip"
              aria-label={`Move ${info.name}. Drag, or use the arrow keys`}
              title="Drag to move"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                onDragStart()
              }}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
                if (!d) return
                e.preventDefault()
                const to = index + d
                if (to < 0 || to >= count) return
                move(index, to)
                // keep the keyboard on the grip after the move
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget="${w.id}"] .home-grip`)?.focus())
              }}
            >
              <GripVertical className="size-4" strokeWidth={1.5} />
            </button>
            <span className="min-w-0 flex-1 truncate px-1 text-[13px] leading-5 opacity-70">{w.size !== 's' ? info.name : ''}</span>
            {info.sizes.length > 1 && (
              <div className="home-sizes" role="radiogroup" aria-label={`${info.name} size`}>
                {info.sizes.map((s) => (
                  <button key={s} role="radio" aria-checked={w.size === s} aria-label={SIZE_LABEL[s]} title={SIZE_LABEL[s]} onClick={() => resize(w.id, s)}>
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            {info.options && (
              <button className="home-icon-btn" aria-label={`${info.name} options`} title="Options" onClick={onOptions}>
                <Settings2 className="size-4" strokeWidth={1.5} />
              </button>
            )}
            <button className="home-icon-btn" aria-label={`Remove ${info.name}`} title="Remove" onClick={onRemove}>
              <X className="size-4" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <>
            {headed && (
              <header className="home-label">
                <h2>{w.type === 'live' ? 'Trending now' : info.name}</h2>
                {link && (
                  <button onClick={() => openInternal(link.page)} className="transition-colors duration-150 ease-shasta hover:text-shasta-fg">
                    {link.label}
                  </button>
                )}
              </header>
            )}
            {info.options && (
              <button
                className="home-icon-btn absolute top-3 right-3 z-10 opacity-0 group-focus-within/cell:opacity-60 group-hover/cell:opacity-60 hover:opacity-100"
                aria-label={`${info.name} options`}
                title="Options"
                onClick={onOptions}
              >
                <Settings2 className="size-4" strokeWidth={1.5} />
              </button>
            )}
          </>
        )}
        <div className={cn('min-h-0 flex-1', editing && 'opacity-80')} inert={editing && w.type !== 'notes' && w.type !== 'todo' ? true : undefined}>
          <Body w={w} tabId={tabId} isPrivate={isPrivate} onOptions={onOptions} />
        </div>
      </section>
    </motion.div>
  )
}

// ---- focus timer alarms: wherever the person is in the browser --------------------------------------------------

function chime() {
  try {
    const ctx = new AudioContext()
    const t = ctx.currentTime
    ;[660, 880].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const at = t + i * 0.18
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.14, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.5)
      o.connect(g).connect(ctx.destination)
      o.start(at)
      o.stop(at + 0.55)
    })
    setTimeout(() => void ctx.close(), 1500)
  } catch {
    /* no sound here */
  }
}

/** Mounted once (App): when a focus timer runs out it flips to the next phase, says so and plays a short sound. */
export function useFocusAlarms() {
  const focus = useHome((s) => s.focus)
  const widgets = useHome((s) => s.widgets)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const [id, st] of Object.entries(focus)) {
      const endsAt = st.endsAt
      if (endsAt == null) continue
      const w = widgets?.find((x) => x.id === id)
      if (!w) continue
      const next = st.phase === 'work' ? 'rest' : 'work'
      const late = Date.now() - endsAt
      const fire = () => {
        const home = useHome.getState()
        const cur = home.focus[id]
        if (!cur || cur.endsAt !== endsAt) return
        home.setFocus(id, { phase: next, endsAt: null, leftMs: null })
        // only announce what just happened, not a timer that ran out while Shasta was closed
        if (Date.now() - endsAt > 60_000) return
        chime()
        const mins = (next === 'rest' ? w.config.rest : w.config.work) ?? (next === 'rest' ? 5 : 25)
        useUi.getState().toast(next === 'rest' ? `Focus time is up. Take a ${mins}-minute break.` : 'Break is over. Ready to focus again?', {
          tone: 'success',
          ms: 15_000,
          action: {
            label: next === 'rest' ? 'Start break' : 'Start focus',
            run: () => useHome.getState().setFocus(id, { phase: next, endsAt: Date.now() + mins * 60_000, leftMs: null }),
          },
        })
      }
      if (late >= 0) fire()
      else timers.push(setTimeout(fire, -late))
    }
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [focus, widgets])
}
