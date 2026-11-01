import { describe, expect, it } from 'vitest'
import {
  MAX_WIDGETS, TEMPLATES, bellSchedule, canAdd, countdown, decodeHome, encodeHome, fromTemplate, layoutFromLegacy, makeWidget, moveWidget, sanitizeLayout, sanitizePeriods,
  scheduleNow, timeInWords, type Widget,
} from '@/lib/home'

const LISTS = { styles: ['immersive', 'classic', 'minimal'], wallpapers: ['none', 'dusk', 'ribbon'], clocks: ['off', '12', '24'] }
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

describe('home layout', () => {
  it('keeps the old page for people who had one: sections in their order, only the ones that were on', () => {
    const w = layoutFromLegacy(['live', 'shortcuts', 'apps', 'bookmarks', 'recent'], { apps: false, recent: true })
    expect(w.map((x) => x.type)).toEqual(['live', 'shortcuts', 'bookmarks', 'recent'])
    expect(w.every((x) => x.size === 'l')).toBe(true)
  })

  it('allows single widgets once and caps the page', () => {
    const one = [makeWidget('shortcuts')]
    expect(canAdd(one, 'shortcuts')).toBe(false)
    expect(canAdd(one, 'notes')).toBe(true)
    const full = Array.from({ length: MAX_WIDGETS }, () => makeWidget('notes'))
    expect(canAdd(full, 'clock')).toBe(false)
  })

  it('sanitizes whatever is stored: unknown types, bad sizes, duplicates of single widgets, duplicate ids', () => {
    const out = sanitizeLayout([
      { id: 'a', type: 'shortcuts', size: 's' },
      { id: 'b', type: 'shortcuts', size: 'l' },
      { id: 'c', type: 'evil', size: 'l' },
      { id: 'a', type: 'notes', size: 'xl', config: { color: 'red' } },
      { id: 'd', type: 'focus', config: { work: 9999, rest: -3 } },
      null,
    ])
    expect(out.map((w) => w.type)).toEqual(['shortcuts', 'notes', 'focus'])
    expect(out[0].size).toBe('l') // shortcuts cannot be small
    expect(out[1].id).not.toBe('a')
    expect(out[1].config.color).toBe('yellow')
    expect(out[2].config).toEqual({ work: 120, rest: 1 })
  })

  it('moves widgets', () => {
    const w = ['a', 'b', 'c'].map((id) => ({ ...makeWidget('notes'), id }))
    expect(moveWidget(w, 0, 2).map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(moveWidget(w, 2, -5).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('every template builds a valid page', () => {
    for (const t of TEMPLATES) {
      const w = fromTemplate(t)
      expect(sanitizeLayout(w)).toHaveLength(w.length)
    }
  })
})

describe('share codes', () => {
  const widgets: Widget[] = [makeWidget('schedule'), makeWidget('clock', 's', { face: 'words' }), makeWidget('countdown', 's', { mode: 'date', date: '2027-06-10', title: 'Summer' })]

  it('round-trips the layout and look', () => {
    const code = encodeHome({ widgets, look: { style: 'classic', wallpaper: 'dusk', clock: '24', greeting: 'Hi' }, shortcuts: [{ title: 'Wiki', url: 'https://www.wikipedia.org/' }] })
    const back = decodeHome(code, LISTS)!
    expect(back.widgets.map((w) => [w.type, w.size])).toEqual(widgets.map((w) => [w.type, w.size]))
    expect(back.widgets[1].config.face).toBe('words')
    expect(back.widgets[2].config).toMatchObject({ mode: 'date', date: '2027-06-10', title: 'Summer' })
    expect(back.look).toEqual({ style: 'classic', wallpaper: 'dusk', clock: '24', greeting: 'Hi' })
    expect(back.shortcuts).toEqual([{ title: 'Wiki', url: 'https://www.wikipedia.org/' }])
    // the same code inside a link works too
    expect(decodeHome(`https://example.test/?home=${code}`, LISTS)?.widgets).toHaveLength(3)
  })

  it('refuses junk and drops values that are not on the lists', () => {
    expect(decodeHome('hello', LISTS)).toBeNull()
    expect(decodeHome('H1.!!!', LISTS)).toBeNull()
    const sneaky = 'H1.' + btoa(JSON.stringify({ w: [['notes', 's']], l: { style: 'x', wallpaper: 'aurora', color: 'red', clock: '13' }, s: [['x', 'javascript:alert(1)']] })).replaceAll('=', '')
    const out = decodeHome(sneaky, LISTS)!
    expect(out.look).toEqual({})
    expect(out.shortcuts).toBeUndefined()
  })
})

describe('class schedule', () => {
  const day = bellSchedule('08:00', 3, 50, 5, 0)

  it('builds a bell schedule', () => {
    expect(day.map((p) => `${p.start}-${p.end}`)).toEqual(['08:00-08:50', '08:55-09:45', '09:50-10:40'])
    expect(bellSchedule('08:00', 6).some((p) => p.name === 'Lunch')).toBe(true)
  })

  it('knows where the day is', () => {
    // 2026-11-02 is a Monday
    expect(scheduleNow(day, at(2026, 11, 2, 7, 30))).toMatchObject({ kind: 'before', inMin: 30 })
    const inClass = scheduleNow(day, at(2026, 11, 2, 8, 25))
    expect(inClass).toMatchObject({ kind: 'in', leftMin: 25 })
    if (inClass.kind === 'in') expect(inClass.progress).toBeCloseTo(0.5)
    expect(scheduleNow(day, at(2026, 11, 2, 8, 52))).toMatchObject({ kind: 'between', inMin: 3 })
    expect(scheduleNow(day, at(2026, 11, 2, 15))).toEqual({ kind: 'after' })
    expect(scheduleNow(day, at(2026, 11, 1, 9))).toEqual({ kind: 'weekend' })
    expect(scheduleNow([], at(2026, 11, 2))).toEqual({ kind: 'empty' })
  })

  it('drops classes that end before they start and sorts the rest', () => {
    expect(sanitizePeriods([{ name: 'B', start: '10:00', end: '10:30' }, { name: 'bad', start: '11:00', end: '10:00' }, { name: '', start: '08:00', end: '09:00' }, { start: '25:00', end: '26:00' }]).map((p) => p.name)).toEqual(['Period 2', 'B'])
  })
})

describe('countdown', () => {
  it('counts to the next school break', () => {
    // Thanksgiving 2026 is Nov 26; the break starts the Saturday before (Nov 21), like the greetings in events.ts
    const c = countdown({ mode: 'break' }, at(2026, 11, 1))!
    expect(c.title).toBe('Thanksgiving break')
    expect(c.days).toBe(20)
    // during the holiday looks' lead-up week it still counts to the break
    expect(countdown({ mode: 'break' }, at(2026, 11, 17))).toMatchObject({ days: 4, on: false })
    expect(c.on).toBe(false)
  })

  it('counts down to the end of a break that is on', () => {
    const c = countdown({ mode: 'break' }, at(2026, 11, 24))!
    expect(c.on).toBe(true)
  })

  it('knows winter break is on over New Year', () => {
    expect(countdown({ mode: 'break' }, at(2027, 1, 1))).toMatchObject({ title: 'Winter break', on: true })
  })

  it('counts to the winter break itself, not to Dec 1', () => {
    const c = countdown({ mode: 'break' }, at(2026, 12, 3))!
    expect(c.title).toBe('Winter break')
    expect(c.date.getDate()).toBe(19) // the Saturday on or before Dec 20
  })

  it('counts to a picked date', () => {
    expect(countdown({ mode: 'date', date: '2026-11-11', title: 'Test' }, at(2026, 11, 1, 23))).toMatchObject({ title: 'Test', days: 10 })
  })
})

describe('clock in words', () => {
  it('rounds to five minutes', () => {
    expect(timeInWords(at(2026, 1, 1, 15, 14))).toBe("It's quarter past three")
    expect(timeInWords(at(2026, 1, 1, 15, 44))).toBe("It's quarter to four")
    expect(timeInWords(at(2026, 1, 1, 11, 58))).toBe("It's noon")
    expect(timeInWords(at(2026, 1, 1, 23, 59))).toBe("It's midnight")
    expect(timeInWords(at(2026, 1, 1, 9, 1))).toBe("It's nine o'clock")
  })
})

describe('quote widget', async () => {
  const { QUOTE_KINDS, fromRows, pickQuote, quotesOf } = await import('@/lib/quotes')
  const data = (await import('@/lib/quotes.data.json')).default as { sources: { url: string; commit: string }[]; quotes: [never, string, string, string?][] }
  const QUOTES = fromRows(data.quotes)

  it('comes from the pinned datasets, with plenty of every kind, all attributed (jokes carry an answer instead)', () => {
    expect(data.sources.length).toBeGreaterThanOrEqual(5)
    for (const s of data.sources) expect(s.commit).toMatch(/^[0-9a-f]{40}$/)
    for (const k of QUOTE_KINDS) expect(quotesOf(QUOTES, [k.id]).length).toBeGreaterThanOrEqual(100)
    for (const x of QUOTES) expect(x.kind === 'joke' ? !!x.answer : !!x.by).toBe(true)
    expect(quotesOf(QUOTES, []).length).toBe(QUOTES.length)
  })

  it('keeps one quote all day, and moves on with "Another"', () => {
    const pool = quotesOf(QUOTES, ['philosophy'])
    const a = pickQuote(pool, 'day', 0.1, 0, at(2026, 11, 2, 8))
    expect(pickQuote(pool, 'day', 0.9, 0, at(2026, 11, 2, 20))).toBe(a)
    expect(pickQuote(pool, 'day', 0.1, 1, at(2026, 11, 2, 8))).not.toBe(a)
    expect(pickQuote([], 'tab', 0.5)).toBeNull()
  })

  it('cleans its options and never puts the person\'s own quote in a share code', () => {
    const w = makeWidget('quote', 'm', { kinds: ['anime', 'nope' as never, 'anime'], every: 'day', mine: '  Keep going  ', mineBy: 'Me', onlyMine: true })
    expect(w.config).toEqual({ kinds: ['anime'], every: 'day', mine: 'Keep going', mineBy: 'Me', onlyMine: true })
    expect(makeWidget('quote', 'm', { onlyMine: true }).config.onlyMine).toBe(false)
    const back = decodeHome(encodeHome({ widgets: [w], look: {} }), LISTS)!
    expect(back.widgets[0].config).toEqual({ kinds: ['anime'], every: 'day', mineBy: undefined, mine: undefined, onlyMine: false })
  })
})
