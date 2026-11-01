import { describe, expect, it } from 'vitest'
import { EVENTS, activeEvent, backToSchool, msUntilChange, nextEvent, thanksgiving, winterBreakStart } from '@/lib/events'
import { SEASONAL_PHOTOS } from '@/lib/seasonalPhotos'
import { WALLPAPERS } from '@/lib/wallpaper'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)
const on = (y: number, m: number, d: number, h?: number) => activeEvent(at(y, m, d, h))?.event.id ?? null

describe('holiday calendar', () => {
  it('computes the moving dates for any year', () => {
    expect(thanksgiving(2026).toDateString()).toBe(new Date(2026, 10, 26).toDateString())
    expect(thanksgiving(2027).toDateString()).toBe(new Date(2027, 10, 25).toDateString())
    expect(thanksgiving(2030).toDateString()).toBe(new Date(2030, 10, 28).toDateString())
    expect(backToSchool(2026).toDateString()).toBe(new Date(2027, 0, 4).toDateString())
    expect(winterBreakStart(2026).toDateString()).toBe(new Date(2026, 11, 19).toDateString())
  })

  it('Halloween ends at midnight on Nov 1 and comes back next year', () => {
    expect(on(2026, 10, 31, 23)).toBe('halloween')
    expect(on(2026, 11, 1, 0)).toBe(null)
    expect(on(2027, 10, 24, 0)).toBe('halloween')
  })

  it('Thanksgiving runs from the Monday of the week before to the Monday after', () => {
    expect(on(2026, 11, 15)).toBe(null)
    expect(on(2026, 11, 16, 0)).toBe('thanksgiving')
    expect(on(2026, 11, 29, 23)).toBe('thanksgiving')
    expect(on(2026, 11, 30, 0)).toBe(null)
  })

  it('winter break covers December into January, with New Year on top', () => {
    expect(on(2026, 12, 1, 0)).toBe('winter')
    expect(on(2026, 12, 30)).toBe('winter')
    expect(on(2026, 12, 31)).toBe('newyear')
    expect(on(2027, 1, 1)).toBe('newyear')
    expect(on(2027, 1, 2)).toBe('winter')
    expect(on(2027, 1, 3, 23)).toBe('winter')
    expect(on(2027, 1, 4, 0)).toBe(null)
  })

  it('greets by phase, with the right year', () => {
    expect(activeEvent(at(2026, 11, 18))?.greeting).toBe('Thanksgiving break is almost here')
    expect(activeEvent(at(2026, 11, 21))?.greeting).toBe('Happy Thanksgiving break')
    expect(activeEvent(at(2026, 11, 26))?.greeting).toBe('Happy Thanksgiving from Shasta')
    expect(activeEvent(at(2026, 12, 5))?.greeting).toBe('Winter break is on its way')
    expect(activeEvent(at(2026, 12, 19))?.greeting).toBe('Happy winter break')
    expect(activeEvent(at(2026, 12, 25))?.greeting).toBe('Happy holidays from Shasta')
    expect(activeEvent(at(2026, 12, 31))?.headline).toBe('2027 starts here. Ask away.')
    expect(activeEvent(at(2027, 1, 2))?.greeting).toBe('Welcome to 2027')
  })

  it('knows what comes next and when to look again', () => {
    expect(nextEvent(at(2026, 11, 1))?.event.id).toBe('thanksgiving')
    expect(nextEvent(at(2027, 1, 10))?.event.id).toBe('halloween')
    // at 23:00 on Oct 31 the next change is midnight
    expect(msUntilChange(at(2026, 10, 31, 23))).toBe(3_600_000)
  })

  it('every event has a photo and a claimable wallpaper', () => {
    for (const e of EVENTS) {
      expect(SEASONAL_PHOTOS.some((p) => p.id === e.id)).toBe(true)
      expect(WALLPAPERS[e.id as keyof typeof WALLPAPERS]?.claim).toBe(true)
    }
  })
})
