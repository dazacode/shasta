// The new tab "home" (lib/home.ts): the widget layout plus what the person wrote in the widgets. Device-only
// (localStorage `shasta-home`): not in profile exports; the layout travels only through a share code the person makes.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { canAdd, makeWidget, moveWidget, sanitizeConfig, sanitizeLayout, sanitizePeriods, type Period, type Widget, type WidgetConfig, type WidgetSize, type WidgetType } from '@/lib/home'

export interface Todo {
  id: string
  text: string
  done: boolean
}

export interface FocusState {
  phase: 'work' | 'rest'
  /** ms timestamp when the running phase ends, or null while paused */
  endsAt: number | null
  /** ms left while paused (or before the first start) */
  leftMs: number | null
}

interface HomeData {
  /** null = never set up: the page builds it from the old new tab settings */
  widgets: Widget[] | null
  notes: Record<string, string>
  todos: Record<string, Todo[]>
  schedules: Record<string, Period[]>
  focus: Record<string, FocusState>
  /** the "make this page yours" card was answered */
  introDone: boolean
}

interface HomeState extends HomeData {
  /** a shared home waiting to be looked at (from a ?home= link); never persisted */
  pendingImport: string | null
  setWidgets: (widgets: Widget[]) => void
  add: (type: WidgetType, size?: WidgetSize, config?: WidgetConfig) => string | null
  /** removes a widget and returns a function that puts it (and what was written in it) back */
  remove: (id: string) => () => void
  resize: (id: string, size: WidgetSize) => void
  configure: (id: string, config: WidgetConfig) => void
  move: (from: number, to: number) => void
  setNote: (id: string, text: string) => void
  setTodos: (id: string, todos: Todo[]) => void
  setSchedule: (id: string, periods: Period[]) => void
  setFocus: (id: string, state: FocusState | null) => void
  finishIntro: () => void
  setPendingImport: (code: string | null) => void
}

const strip = <T,>(rec: Record<string, T>, id: string) => {
  const next = { ...rec }
  delete next[id]
  return next
}

export const useHome = create<HomeState>()(
  persist(
    (set, get) => ({
      widgets: null,
      notes: {},
      todos: {},
      schedules: {},
      focus: {},
      introDone: false,
      pendingImport: null,
      setWidgets: (widgets) => set({ widgets: sanitizeLayout(widgets) }),
      add: (type, size, config) => {
        const widgets = get().widgets ?? []
        if (!canAdd(widgets, type)) return null
        const w = makeWidget(type, size, config)
        set({ widgets: [...widgets, w] })
        return w.id
      },
      remove: (id) => {
        const before = get()
        const index = (before.widgets ?? []).findIndex((w) => w.id === id)
        const widget = before.widgets?.[index]
        const saved = { note: before.notes[id], todos: before.todos[id], schedule: before.schedules[id] }
        set((s) => ({ widgets: (s.widgets ?? []).filter((w) => w.id !== id), notes: strip(s.notes, id), todos: strip(s.todos, id), schedules: strip(s.schedules, id), focus: strip(s.focus, id) }))
        return () => {
          if (!widget) return
          set((s) => {
            const list = [...(s.widgets ?? [])]
            if (list.some((w) => w.id === id)) return {}
            list.splice(Math.min(index, list.length), 0, widget)
            return {
              widgets: list,
              notes: saved.note !== undefined ? { ...s.notes, [id]: saved.note } : s.notes,
              todos: saved.todos ? { ...s.todos, [id]: saved.todos } : s.todos,
              schedules: saved.schedule ? { ...s.schedules, [id]: saved.schedule } : s.schedules,
            }
          })
        }
      },
      resize: (id, size) => set((s) => ({ widgets: (s.widgets ?? []).map((w) => (w.id === id ? { ...w, size } : w)) })),
      configure: (id, config) => set((s) => ({ widgets: (s.widgets ?? []).map((w) => (w.id === id ? { ...w, config: sanitizeConfig(w.type, { ...w.config, ...config }) } : w)) })),
      move: (from, to) => set((s) => ({ widgets: moveWidget(s.widgets ?? [], from, to) })),
      setNote: (id, text) => set((s) => ({ notes: { ...s.notes, [id]: text.slice(0, 5000) } })),
      setTodos: (id, todos) => set((s) => ({ todos: { ...s.todos, [id]: todos.slice(0, 100) } })),
      setSchedule: (id, periods) => set((s) => ({ schedules: { ...s.schedules, [id]: sanitizePeriods(periods) } })),
      setFocus: (id, state) => set((s) => ({ focus: state ? { ...s.focus, [id]: state } : strip(s.focus, id) })),
      finishIntro: () => set({ introDone: true }),
      setPendingImport: (pendingImport) => set({ pendingImport }),
    }),
    {
      name: 'shasta-home',
      version: 1,
      partialize: ({ widgets, notes, todos, schedules, focus, introDone }): HomeData => ({ widgets, notes, todos, schedules, focus, introDone }),
      // whatever is stored is checked again on load
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<HomeData>
        const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
        const notes: Record<string, string> = {}
        for (const [k, v] of Object.entries(rec(p.notes))) if (typeof v === 'string') notes[k] = v.slice(0, 5000)
        const todos: Record<string, Todo[]> = {}
        for (const [k, v] of Object.entries(rec(p.todos)))
          if (Array.isArray(v)) todos[k] = v.filter((t): t is Todo => !!t && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.done === 'boolean').slice(0, 100)
        const schedules: Record<string, Period[]> = {}
        for (const [k, v] of Object.entries(rec(p.schedules))) schedules[k] = sanitizePeriods(v)
        const focus: Record<string, FocusState> = {}
        for (const [k, v] of Object.entries(rec(p.focus))) {
          const f = v as Partial<FocusState>
          if (f && (f.phase === 'work' || f.phase === 'rest')) focus[k] = { phase: f.phase, endsAt: typeof f.endsAt === 'number' ? f.endsAt : null, leftMs: typeof f.leftMs === 'number' ? f.leftMs : null }
        }
        return { ...current, widgets: p.widgets == null ? null : sanitizeLayout(p.widgets), notes, todos, schedules, focus, introDone: p.introDone === true }
      },
    },
  ),
)
