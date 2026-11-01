// Holiday events: ONE recurring calendar that the new tab, the Store and Watch all read (through lib/seasonal.ts).
// Every window is a RULE computed for the current year (fixed date, "4th Thursday of November", "first Monday after
// New Year"), never a hard-coded year, so the looks come back on their own every year and switch themselves off at
// local midnight on their end date without a release. Pure (no imports): the server keeps the same rules in
// server/src/services/seasons.ts for Watch's seasonal rows, and server/test/seasons.test.ts checks both agree.
//
// Adding an event = one entry in EVENTS + its photo (lib/seasonalPhotos.ts, `bun run build:seasonal`) + its wallpaper
// (lib/wallpaper.ts); a new theme also needs copy/shelves in components/seasonal/Season.tsx and rows on the server.

/** The Store shelves, Watch rows and colours an event uses. Several events share one (New Year uses winter's). */
export type ThemeId = 'halloween' | 'harvest' | 'winter'

export interface EventWindow {
  /** inclusive, local time */
  start: Date
  /** exclusive, local time */
  end: Date
}

/** A greeting for part of an event (e.g. the days the school break has really started). */
export interface Phase {
  from: (start: Date, year: number) => Date
  greeting: string
  /** `{year}` = the year the event ends in (New Year 2027) */
  headline: string
}

export interface HolidayEvent {
  /** also its photo (lib/seasonalPhotos.ts) and its claimable wallpaper (lib/wallpaper.ts) */
  id: 'halloween' | 'thanksgiving' | 'newyear' | 'winter'
  /** what people call it, used in copy ("Keep it after Thanksgiving") */
  name: string
  theme: ThemeId
  /** the window for the event that STARTS in `year` */
  window: (year: number) => EventWindow
  /** later phases win; the first one starts with the event */
  phases: Phase[]
}

const DAY = 86_400_000
const day = (y: number, m: number, d: number) => new Date(y, m, d)
/** whole days, safe across daylight-saving changes (local midnight to local midnight) */
const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
/** the nth (1-based) weekday (0 = Sunday) of a month */
export function nthWeekday(y: number, m: number, weekday: number, n: number) {
  const first = day(y, m, 1)
  return addDays(first, ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7)
}
/** the first `weekday` on or after `date` */
const onOrAfter = (date: Date, weekday: number) => addDays(date, (weekday - date.getDay() + 7) % 7)
/** the last `weekday` on or before `date` */
const onOrBefore = (date: Date, weekday: number) => addDays(date, -((date.getDay() - weekday + 7) % 7))

const MON = 1
const THU = 4
const SAT = 6
const NOV = 10
const DEC = 11

/** US Thanksgiving: the 4th Thursday of November. */
export const thanksgiving = (y: number) => nthWeekday(y, NOV, THU, 4)
/** School winter break starts: the last Saturday on or before Dec 20 (most US districts are out from then). */
export const winterBreakStart = (y: number) => onOrBefore(day(y, DEC, 20), SAT)
/** Back to school after New Year: the first Monday on or after Jan 2. */
export const backToSchool = (y: number) => onOrAfter(day(y + 1, 0, 2), MON)

const fixed = (greeting: string, headline: string): Phase => ({ from: (start) => start, greeting, headline })

/** In priority order: when two overlap, the earlier entry wins (New Year inside winter break). */
export const EVENTS: HolidayEvent[] = [
  {
    id: 'halloween',
    name: 'Halloween',
    theme: 'halloween',
    window: (y) => ({ start: day(y, 9, 24), end: day(y, NOV, 1) }),
    phases: [fixed('Happy Halloween from Shasta', 'Trick or treat? Ask away.')],
  },
  {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    theme: 'harvest',
    // from the Monday of the week before (Thursday - 10 days) until the Monday after (Thursday + 4 days)
    window: (y) => ({ start: addDays(thanksgiving(y), -10), end: addDays(thanksgiving(y), 4) }),
    phases: [
      fixed('Thanksgiving break is almost here', 'Plans for the long weekend? Ask away.'),
      { from: (_s, y) => addDays(thanksgiving(y), -5), greeting: 'Happy Thanksgiving break', headline: 'No homework today. What are we doing?' },
      { from: (_s, y) => thanksgiving(y), greeting: 'Happy Thanksgiving from Shasta', headline: 'Grateful you are here. Ask away.' },
      { from: (_s, y) => addDays(thanksgiving(y), 1), greeting: 'Happy Thanksgiving break', headline: 'Leftovers and a long weekend. What next?' },
    ],
  },
  {
    id: 'newyear',
    name: 'New Year',
    theme: 'winter',
    window: (y) => ({ start: day(y, DEC, 31), end: day(y + 1, 0, 2) }),
    phases: [fixed('Happy New Year from Shasta', '{year} starts here. Ask away.')],
  },
  {
    id: 'winter',
    name: 'winter break',
    theme: 'winter',
    window: (y) => ({ start: day(y, DEC, 1), end: backToSchool(y) }),
    phases: [
      fixed('Winter break is on its way', 'Snow day mood. Ask away.'),
      { from: (_s, y) => winterBreakStart(y), greeting: 'Happy winter break', headline: 'No alarms tomorrow. What are we doing?' },
      { from: (_s, y) => day(y, DEC, 24), greeting: 'Happy holidays from Shasta', headline: 'Cozy up. Ask away.' },
      { from: (_s, y) => day(y, DEC, 26), greeting: 'Happy winter break', headline: 'Still on break. What next?' },
      { from: (_s, y) => day(y + 1, 0, 1), greeting: 'Welcome to {year}', headline: 'Last days of the break. Make them count.' },
    ],
  },
]

export interface ActiveEvent {
  event: HolidayEvent
  window: EventWindow
  greeting: string
  headline: string
}

/** The event's window that contains `now` (it may have started last year, like winter break in January). */
function windowAt(e: HolidayEvent, now: Date): EventWindow | null {
  const y = now.getFullYear()
  for (const year of [y, y - 1]) {
    const w = e.window(year)
    if (now >= w.start && now < w.end) return w
  }
  return null
}

const fill = (s: string, w: EventWindow) => s.replaceAll('{year}', String(addDays(w.end, -1).getFullYear()))

/** The event on right now (highest priority), with the greeting for today. */
export function activeEvent(now: Date | number = Date.now()): ActiveEvent | null {
  const at = new Date(now)
  for (const event of EVENTS) {
    const window = windowAt(event, at)
    if (!window) continue
    const startYear = window.start.getFullYear()
    let phase = event.phases[0]
    for (const p of event.phases) if (at >= p.from(window.start, startYear)) phase = p
    return { event, window, greeting: fill(phase.greeting, window), headline: fill(phase.headline, window) }
  }
  return null
}

/** The next event to start after `now` (for previews and "coming up"). */
export function nextEvent(now: Date | number = Date.now()): { event: HolidayEvent; window: EventWindow } | null {
  const at = new Date(now)
  let best: { event: HolidayEvent; window: EventWindow } | null = null
  for (const event of EVENTS)
    for (const year of [at.getFullYear(), at.getFullYear() + 1]) {
      const window = event.window(year)
      if (window.start > at && (!best || window.start < best.window.start)) best = { event, window }
    }
  return best
}

/** ms until the answer of activeEvent() can change (the next start, end or phase change), capped at a day. */
export function msUntilChange(now: Date | number = Date.now()): number {
  const at = new Date(now)
  const marks: Date[] = []
  for (const event of EVENTS)
    for (const year of [at.getFullYear() - 1, at.getFullYear(), at.getFullYear() + 1]) {
      const w = event.window(year)
      marks.push(w.start, w.end, ...event.phases.map((p) => p.from(w.start, year)))
    }
  const next = Math.min(...marks.map((d) => d.getTime()).filter((t) => t > at.getTime()))
  return Math.min(Number.isFinite(next) ? next - at.getTime() : DAY, DAY)
}

/** "Dec 31": the last day of a window, for copy like "The offer ends Nov 29". */
export const lastDay = (w: EventWindow) => addDays(w.end, -1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
