// Ad-free time ending or ended (lib/perkNotice.ts): who is told what, and when.
import { describe, expect, it } from 'vitest'
import { WARN, keptThings, noticeBody, noticeFor, noticeTitle, type PerkFacts } from '@/lib/perkNoticeCore'

const NOW = 1_800_000_000
const base: PerkFacts = { code: false, pass: false, kind: null, until: undefined, codeEnded: false, tourExp: 0 }

describe('noticeFor', () => {
  it('says nothing with no ad-free time at all', () => {
    expect(noticeFor(base, NOW)).toBeNull()
  })
  it('warns before the tour day ends, and says when it has ended', () => {
    expect(noticeFor({ ...base, tourExp: NOW + WARN.tour + 60 }, NOW)).toBeNull()
    expect(noticeFor({ ...base, tourExp: NOW + 3600 }, NOW)).toMatchObject({ stage: 'ending', what: 'tour' })
    expect(noticeFor({ ...base, tourExp: NOW - 60 }, NOW)).toMatchObject({ stage: 'ended', what: 'tour' })
    // long ago: no longer news
    expect(noticeFor({ ...base, tourExp: NOW - 40 * 86400 }, NOW)).toBeNull()
  })
  it('warns a trial two days ahead and a Supporter code with an end three days ahead; never one with no end date', () => {
    const trial = { ...base, code: true, pass: true, kind: 'trial' as const }
    expect(noticeFor({ ...trial, until: NOW + 3 * 86400 }, NOW)).toBeNull()
    expect(noticeFor({ ...trial, until: NOW + 86400 }, NOW)).toMatchObject({ stage: 'ending', what: 'trial' })
    const sup = { ...base, code: true, pass: true, kind: 'supporter' as const }
    expect(noticeFor({ ...sup, until: NOW + 2 * 86400 }, NOW)).toMatchObject({ stage: 'ending', what: 'supporter' })
    expect(noticeFor({ ...sup, until: null }, NOW)).toBeNull()
  })
  it('says when a code has ended', () => {
    expect(noticeFor({ ...base, code: true, codeEnded: true }, NOW)).toMatchObject({ stage: 'ended', what: 'code' })
  })
  it('does not bother a Supporter about the tour day, nor anyone about a code while the tour day still runs', () => {
    expect(noticeFor({ ...base, code: true, pass: true, kind: 'supporter', until: null, tourExp: NOW - 60 }, NOW)).toBeNull()
    expect(noticeFor({ ...base, code: true, codeEnded: true, tourExp: NOW + 20 * 3600 }, NOW)).toBeNull()
  })
  it('keys each notice so it is shown once', () => {
    const a = noticeFor({ ...base, tourExp: NOW + 3600 }, NOW)!
    const b = noticeFor({ ...base, tourExp: NOW + 3600 }, NOW + 600)!
    expect(a.key).toBe(b.key)
    expect(noticeFor({ ...base, tourExp: NOW - 1 }, NOW)!.key).not.toBe(a.key)
  })
})

describe('the words', () => {
  it('says what ended and that everything picked is saved and comes back with a code', () => {
    const n = noticeFor({ ...base, tourExp: NOW - 60 }, NOW)!
    expect(noticeTitle(n, NOW)).toBe('Your ad-free day has ended')
    const body = noticeBody(n, keptThings({ wallpaper: 'aurora', earlyPreviews: true }))
    expect(body).toContain('your Aurora wallpaper and early previews are saved')
    expect(body).toContain('switches back on the moment you add a Supporter code')
    expect(body).not.toMatch(/!/)
  })
  it('only lists Supporter things as kept', () => {
    expect(keptThings({ wallpaper: 'alpine', earlyPreviews: false })).toEqual([])
    expect(keptThings({ wallpaper: 'trail', earlyPreviews: false })).toEqual([])
  })
})
