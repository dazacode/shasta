// The new tab page as the person's "home": a grid of widgets they add, move, resize and share. Pure model (no React,
// no storage): the widget catalogue, sizes, starter templates, the share code and the small bits of logic the widgets
// need (class schedule, countdowns, the clock in words). State lives in stores/homeStore.ts.
//
// Two kinds of data, kept apart on purpose:
// - the LAYOUT (which widgets, their size, order and options): portable, can be shared as a code or link;
// - what the person WROTE in them (notes, to-dos, class times, timer state): device-only, never in a share code.
import { EVENTS, thanksgiving, winterBreakStart } from './events'
import { QUOTE_KINDS, type QuoteKind } from './quotes'

export type WidgetType = 'shortcuts' | 'apps' | 'live' | 'bookmarks' | 'recent' | 'clock' | 'notes' | 'todo' | 'focus' | 'countdown' | 'schedule' | 'quote'
/** s = a quarter of the row, m = half, l = the whole row (on a narrow window everything gets wider) */
export type WidgetSize = 's' | 'm' | 'l'

export type ClockFace = 'digital' | 'analog' | 'words'
export type NoteColor = 'plain' | 'yellow' | 'pink' | 'blue' | 'green'
export type CountdownMode = 'break' | 'date'

export interface WidgetConfig {
  // clock
  face?: ClockFace
  hour12?: boolean
  // notes
  color?: NoteColor
  // focus timer (minutes)
  work?: number
  rest?: number
  // countdown
  mode?: CountdownMode
  title?: string
  /** YYYY-MM-DD, local */
  date?: string
  // quote
  /** which kinds to draw from (none = all) */
  kinds?: QuoteKind[]
  /** a new one on every new tab, or one a day */
  every?: 'tab' | 'day'
  /** the person's own quote (never in a share code) */
  mine?: string
  mineBy?: string
  /** show only the person's own quote */
  onlyMine?: boolean
}

export interface Widget {
  id: string
  type: WidgetType
  size: WidgetSize
  config: WidgetConfig
}

export interface WidgetInfo {
  name: string
  /** one line for the "Add a widget" gallery */
  blurb: string
  sizes: WidgetSize[]
  size: WidgetSize
  /** only one on the page (it shows the same thing twice otherwise) */
  single?: true
  config?: WidgetConfig
  /** has options worth a settings dialog */
  options?: true
}

export const WIDGETS: Record<WidgetType, WidgetInfo> = {
  shortcuts: { name: 'Shortcuts', blurb: 'Your favourite sites, one click away.', sizes: ['m', 'l'], size: 'l', single: true },
  schedule: { name: 'Class schedule', blurb: 'Which class you are in, how long is left, and what is next.', sizes: ['m', 'l'], size: 'm', options: true },
  focus: { name: 'Focus timer', blurb: 'Work for a while, then take a break. It keeps going in the background.', sizes: ['s', 'm'], size: 's', config: { work: 25, rest: 5 }, options: true },
  todo: { name: 'To-do list', blurb: 'Homework and anything else to remember. Tick it off when it is done.', sizes: ['s', 'm', 'l'], size: 'm' },
  notes: { name: 'Sticky note', blurb: 'A note that stays on the page. Saved as you type.', sizes: ['s', 'm', 'l'], size: 's', config: { color: 'yellow' }, options: true },
  countdown: { name: 'Countdown', blurb: 'Days until the next break, or a date you pick.', sizes: ['s', 'm'], size: 's', config: { mode: 'break' }, options: true },
  clock: { name: 'Clock', blurb: 'The time as numbers, hands or words.', sizes: ['s', 'm', 'l'], size: 's', config: { face: 'analog', hour12: true }, options: true },
  quote: { name: 'Quote', blurb: 'Movies, anime, famous people, philosophy, motivation or a joke. Or your own.', sizes: ['m', 'l'], size: 'm', config: { every: 'tab' }, options: true },
  apps: { name: 'Your apps', blurb: 'Games and apps you installed from the Store.', sizes: ['m', 'l'], size: 'l', single: true },
  live: { name: 'Trending', blurb: 'What people on Shasta are opening right now.', sizes: ['m', 'l'], size: 'l', single: true },
  bookmarks: { name: 'Bookmarks', blurb: 'Your bookmarks bar, on the page.', sizes: ['m', 'l'], size: 'm', single: true },
  recent: { name: 'Recently visited', blurb: 'Pick up where you left off.', sizes: ['m', 'l'], size: 'm', single: true },
}

export const WIDGET_TYPES = Object.keys(WIDGETS) as WidgetType[]
export const MAX_WIDGETS = 16
const SIZES: WidgetSize[] = ['s', 'm', 'l']
const FACES: ClockFace[] = ['digital', 'analog', 'words']
export const NOTE_COLORS: NoteColor[] = ['yellow', 'pink', 'blue', 'green', 'plain']

export const newId = () => Math.random().toString(36).slice(2, 10)

export function makeWidget(type: WidgetType, size?: WidgetSize, config?: WidgetConfig): Widget {
  const info = WIDGETS[type]
  return { id: newId(), type, size: size && info.sizes.includes(size) ? size : info.size, config: sanitizeConfig(type, { ...info.config, ...config }) }
}

/** Can another widget of this type go on the page? */
export function canAdd(widgets: readonly Widget[], type: WidgetType): boolean {
  if (widgets.length >= MAX_WIDGETS) return false
  return !WIDGETS[type].single || !widgets.some((w) => w.type === type)
}

/** The next size in the widget's own list (S -> M -> L -> S). */
export function nextSize(w: Widget): WidgetSize {
  const sizes = WIDGETS[w.type].sizes
  return sizes[(sizes.indexOf(w.size) + 1) % sizes.length]
}

export function moveWidget(widgets: readonly Widget[], from: number, to: number): Widget[] {
  const next = [...widgets]
  if (from < 0 || from >= next.length) return next
  const [w] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, w)
  return next
}

// ---- validation: whatever comes from storage or a share code is checked, never trusted --------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d)
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)

export function sanitizeConfig(type: WidgetType, raw: unknown): WidgetConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = WIDGETS[type].config ?? {}
  switch (type) {
    case 'clock':
      return { face: FACES.includes(c.face as ClockFace) ? (c.face as ClockFace) : d.face, hour12: typeof c.hour12 === 'boolean' ? c.hour12 : true }
    case 'notes':
      return { color: NOTE_COLORS.includes(c.color as NoteColor) ? (c.color as NoteColor) : d.color }
    case 'focus':
      return { work: int(c.work, 1, 120, 25), rest: int(c.rest, 1, 60, 5) }
    case 'countdown': {
      const mode: CountdownMode = c.mode === 'date' && typeof c.date === 'string' && DATE.test(c.date) ? 'date' : 'break'
      return mode === 'date' ? { mode, date: c.date as string, title: text(c.title, 40)?.trim() || undefined } : { mode }
    }
    case 'quote': {
      const ids = QUOTE_KINDS.map((k) => k.id)
      const kinds = Array.isArray(c.kinds) ? [...new Set(c.kinds.filter((k): k is QuoteKind => ids.includes(k as QuoteKind)))] : []
      const mine = text(c.mine, 280)?.trim() || undefined
      return { kinds, every: c.every === 'day' ? 'day' : 'tab', mine, mineBy: mine ? text(c.mineBy, 60)?.trim() || undefined : undefined, onlyMine: !!mine && c.onlyMine === true }
    }
    default:
      return {}
  }
}

export function sanitizeWidget(raw: unknown): Widget | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type as WidgetType
  if (!WIDGET_TYPES.includes(type)) return null
  const info = WIDGETS[type]
  const size = SIZES.includes(r.size as WidgetSize) && info.sizes.includes(r.size as WidgetSize) ? (r.size as WidgetSize) : info.size
  const id = typeof r.id === 'string' && /^[a-z0-9]{1,16}$/i.test(r.id) ? r.id : newId()
  return { id, type, size, config: sanitizeConfig(type, r.config) }
}

/** Known widgets only, at most MAX_WIDGETS, single ones once, unique ids. */
export function sanitizeLayout(raw: unknown): Widget[] {
  const out: Widget[] = []
  const ids = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const w = sanitizeWidget(item)
    if (!w || !canAdd(out, w.type)) continue
    if (ids.has(w.id)) w.id = newId()
    ids.add(w.id)
    out.push(w)
  }
  return out
}

// ---- starting points ------------------------------------------------------------------------------------------

/** The page as it was before widgets: the old sections, in the person's order, only the ones they had on. */
export function layoutFromLegacy(order: readonly string[], on: Partial<Record<string, boolean>>): Widget[] {
  const legacy: WidgetType[] = ['shortcuts', 'apps', 'live', 'bookmarks', 'recent']
  return order.filter((k): k is WidgetType => legacy.includes(k as WidgetType) && on[k] !== false).map((t) => ({ ...makeWidget(t, 'l'), id: t }))
}

export interface Template {
  id: string
  name: string
  blurb: string
  widgets: [WidgetType, WidgetSize, WidgetConfig?][]
}

export const TEMPLATES: Template[] = [
  {
    id: 'study',
    name: 'School day',
    blurb: 'Your classes, a focus timer, homework and the days until the next break.',
    widgets: [['schedule', 'm'], ['focus', 's'], ['countdown', 's'], ['todo', 'm'], ['notes', 'm'], ['shortcuts', 'l']],
  },
  {
    id: 'play',
    name: 'Game night',
    blurb: 'Your games and apps up front, what is trending, and your sites.',
    widgets: [['apps', 'l'], ['live', 'l'], ['shortcuts', 'l'], ['countdown', 's'], ['clock', 's', { face: 'digital' }], ['recent', 'm']],
  },
  {
    id: 'calm',
    name: 'Calm',
    blurb: 'A clock, a quote and a note. Not much else.',
    widgets: [['clock', 'm', { face: 'words' }], ['quote', 'm'], ['notes', 'l', { color: 'plain' }]],
  },
  {
    id: 'classic',
    name: 'Shasta classic',
    blurb: 'The page as it always was: shortcuts, apps, trending, bookmarks, history.',
    widgets: [['shortcuts', 'l'], ['apps', 'l'], ['live', 'l'], ['bookmarks', 'l'], ['recent', 'l']],
  },
]

export const fromTemplate = (t: Template): Widget[] => t.widgets.map(([type, size, config]) => makeWidget(type, size, config))

// ---- share codes ----------------------------------------------------------------------------------------------

/** The look that travels with a shared home: only names from fixed lists and plain values (checked on import). */
export interface SharedLook {
  style?: string
  wallpaper?: string
  bg?: 'preset' | 'color'
  color?: string
  dim?: number
  clock?: string
  /** false = the search bar is hidden */
  search?: boolean
  greeting?: string
  headline?: string
}

export interface SharedHome {
  widgets: Widget[]
  look: SharedLook
  shortcuts?: { title: string; url: string }[]
}

const PREFIX = 'H1.'
const HEX = /^#[0-9a-f]{6}$/i

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): string {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** A compact code for a home: the layout and the look, never what was written in the widgets. */
export function encodeHome(home: SharedHome): string {
  const w = home.widgets.map((x) => {
    // what the person wrote never travels: their own quote stays on this device
    const c = Object.fromEntries(Object.entries(x.config).filter(([k, v]) => v !== undefined && k !== 'mine' && k !== 'mineBy' && k !== 'onlyMine' && !(Array.isArray(v) && !v.length)))
    return Object.keys(c).length ? [x.type, x.size, c] : [x.type, x.size]
  })
  const body: Record<string, unknown> = { w, l: home.look }
  if (home.shortcuts?.length) body.s = home.shortcuts.map((s) => [s.title, s.url])
  return PREFIX + b64urlEncode(JSON.stringify(body))
}

/** Reads a code (or a whole link with ?home=), checking every value. Null when it is not a valid home code. */
export function decodeHome(input: string, lists: { styles: readonly string[]; wallpapers: readonly string[]; clocks: readonly string[] }): SharedHome | null {
  let code = input.trim()
  try {
    const fromLink = /[?&]home=([^&#\s]+)/.exec(code)
    if (fromLink) code = decodeURIComponent(fromLink[1])
  } catch {
    return null
  }
  if (!code.startsWith(PREFIX) || code.length > 6000) return null
  let body: Record<string, unknown>
  try {
    body = JSON.parse(b64urlDecode(code.slice(PREFIX.length)))
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.w)) return null
  const widgets = sanitizeLayout((body.w as unknown[]).map((x) => (Array.isArray(x) ? { type: x[0], size: x[1], config: x[2] } : null)))
  if (!widgets.length) return null
  const l = (body.l && typeof body.l === 'object' ? body.l : {}) as Record<string, unknown>
  const look: SharedLook = {}
  if (lists.styles.includes(l.style as string)) look.style = l.style as string
  if (lists.wallpapers.includes(l.wallpaper as string)) look.wallpaper = l.wallpaper as string
  if (l.bg === 'preset' || l.bg === 'color') look.bg = l.bg
  if (typeof l.color === 'string' && HEX.test(l.color)) look.color = l.color
  if (typeof l.dim === 'number') look.dim = int(l.dim, 0, 80, 0)
  if (lists.clocks.includes(l.clock as string)) look.clock = l.clock as string
  if (l.search === false) look.search = false
  const words = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, 60) : undefined)
  if (words(l.greeting) !== undefined) look.greeting = words(l.greeting)
  if (words(l.headline) !== undefined) look.headline = words(l.headline)
  const shortcuts: { title: string; url: string }[] = []
  for (const s of Array.isArray(body.s) ? (body.s as unknown[]).slice(0, 12) : []) {
    if (!Array.isArray(s) || typeof s[0] !== 'string' || typeof s[1] !== 'string') continue
    if (!/^https?:\/\/[^\s]+$/i.test(s[1]) || s[1].length > 500) continue
    shortcuts.push({ title: s[0].slice(0, 30), url: s[1] })
  }
  return { widgets, look, ...(shortcuts.length ? { shortcuts } : {}) }
}

// ---- class schedule -------------------------------------------------------------------------------------------

export interface Period {
  name: string
  /** "HH:MM", 24-hour */
  start: string
  end: string
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/
export const minutesOf = (hm: string) => {
  const m = HM.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}
export const hmOf = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function sanitizePeriods(raw: unknown): Period[] {
  const out: Period[] = []
  for (const p of Array.isArray(raw) ? raw.slice(0, 14) : []) {
    if (!p || typeof p !== 'object') continue
    const { name, start, end } = p as Record<string, unknown>
    if (typeof start !== 'string' || typeof end !== 'string' || !HM.test(start) || !HM.test(end) || minutesOf(end) <= minutesOf(start)) continue
    out.push({ name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 30) : `Period ${out.length + 1}`, start, end })
  }
  return out.sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
}

/** A plain bell schedule to start from: `count` periods of `length` minutes with `gap` minutes between, lunch after the 4th. */
export function bellSchedule(start = '08:00', count = 7, length = 50, gap = 5, lunch = 30): Period[] {
  const out: Period[] = []
  let t = minutesOf(start)
  for (let i = 1; i <= count; i++) {
    out.push({ name: `Period ${i}`, start: hmOf(t), end: hmOf(t + length) })
    t += length + gap
    if (i === 4 && lunch > 0 && i < count) {
      out.push({ name: 'Lunch', start: hmOf(t), end: hmOf(t + lunch) })
      t += lunch + gap
    }
  }
  return out
}

export type ScheduleNow =
  | { kind: 'weekend' }
  | { kind: 'empty' }
  | { kind: 'before'; next: Period; inMin: number }
  | { kind: 'in'; now: Period; leftMin: number; progress: number; next: Period | null }
  | { kind: 'between'; next: Period; inMin: number }
  | { kind: 'after' }

/** Where the day is: in a class (minutes left, how far through), between two, before the first or after the last. */
export function scheduleNow(periods: readonly Period[], at: Date = new Date(), weekdaysOnly = true): ScheduleNow {
  if (!periods.length) return { kind: 'empty' }
  const day = at.getDay()
  if (weekdaysOnly && (day === 0 || day === 6)) return { kind: 'weekend' }
  const t = at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]
    const s = minutesOf(p.start)
    const e = minutesOf(p.end)
    if (t < s) return i === 0 ? { kind: 'before', next: p, inMin: Math.ceil(s - t) } : { kind: 'between', next: p, inMin: Math.ceil(s - t) }
    if (t < e) return { kind: 'in', now: p, leftMin: Math.ceil(e - t), progress: (t - s) / (e - s), next: periods[i + 1] ?? null }
  }
  return { kind: 'after' }
}

/** "8:05 AM" or "08:05", in the person's locale. */
export function formatHm(hm: string, hour12: boolean): string {
  const m = minutesOf(hm)
  const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 })
}

// ---- countdowns -----------------------------------------------------------------------------------------------

const DAY = 86_400_000
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export interface CountdownView {
  title: string
  /** whole days left; 0 = today */
  days: number
  /** the thing is on right now (a break that has started) */
  on: boolean
  date: Date
}

/** Days until the next school break (lib/events.ts rules) or a date the person picked. */
export function countdown(config: WidgetConfig, now: Date = new Date()): CountdownView | null {
  const today = midnight(now)
  if (config.mode === 'date' && config.date && DATE.test(config.date)) {
    const [y, m, d] = config.date.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return { title: config.title || 'The big day', days: Math.round((date.getTime() - today.getTime()) / DAY), on: false, date }
  }
  // a break that is on counts down to its end (back to school); otherwise to the start of the next one. Read from the
  // break rules directly: holiday looks start a week early, and New Year sits on top of winter break.
  const year = now.getFullYear()
  let next: { id: string; start: Date } | null = null
  for (const e of EVENTS) {
    if (!isBreak(e.id)) continue
    for (const y of [year - 1, year, year + 1]) {
      const start = breakStart(e.id, y)
      const end = e.window(y).end
      if (now >= start && now < end) return { title: BREAK[e.id], days: Math.round((end.getTime() - today.getTime()) / DAY), on: true, date: end }
      if (start > now && (!next || start < next.start)) next = { id: e.id, start }
    }
  }
  return next && { title: BREAK[next.id], days: Math.round((next.start.getTime() - today.getTime()) / DAY), on: false, date: next.start }
}

const BREAK: Record<string, string> = { thanksgiving: 'Thanksgiving break', winter: 'Winter break' }
const isBreak = (id: string) => id in BREAK

/** The first day off (same days as the "Happy ... break" greetings in events.ts): the Saturday before Thanksgiving
 *  week, and the Saturday on or before Dec 20. */
function breakStart(id: string, y: number): Date {
  if (id === 'winter') return winterBreakStart(y)
  const t = thanksgiving(y)
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - 5)
}

// ---- clock in words -------------------------------------------------------------------------------------------

const NUM = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven']

/** "It's quarter past three", rounded to the nearest five minutes. */
export function timeInWords(d: Date): string {
  let m = Math.round(d.getMinutes() / 5) * 5
  let h = d.getHours()
  if (m === 60) {
    m = 0
    h += 1
  }
  const hour = (x: number) => NUM[x % 12]
  if (m === 0) return h % 24 === 0 ? "It's midnight" : h % 24 === 12 ? "It's noon" : `It's ${hour(h)} o'clock`
  const past: Record<number, string> = { 5: 'five past', 10: 'ten past', 15: 'quarter past', 20: 'twenty past', 25: 'twenty-five past', 30: 'half past' }
  const to: Record<number, string> = { 35: 'twenty-five to', 40: 'twenty to', 45: 'quarter to', 50: 'ten to', 55: 'five to' }
  return m <= 30 ? `It's ${past[m]} ${hour(h)}` : `It's ${to[m]} ${hour(h + 1)}`
}

/** Part of the day, for a greeting. */
export function partOfDay(d: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = d.getHours()
  return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night'
}
/** Run once at start: a shared page link (?home=H1....) is handed over and taken out of the address bar. */
export function openSharedHome(show: (code: string) => void, loc: Location = location) {
  const code = new URLSearchParams(loc.search).get('home')
  if (!code) return
  const url = new URL(loc.href)
  url.searchParams.delete('home')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  if (code.startsWith(PREFIX)) show(code)
}
