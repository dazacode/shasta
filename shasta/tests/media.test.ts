import { describe, expect, it } from 'vitest'
import { NO_ACTIONS, formatTime, isWorthShowing, orderSessions, pickArtwork, positionAt, pageTitleAsTrack, primaryOf, trackIdentity, type MediaInfo } from '@/lib/media'

const info = (over: Partial<MediaInfo>): MediaInfo => ({
  tabId: 't',
  key: 'k',
  kind: 'audio',
  title: '',
  artist: '',
  album: '',
  artwork: null,
  playing: false,
  position: 0,
  duration: 100,
  rate: 1,
  at: 0,
  muted: false,
  volume: 1,
  actions: NO_ACTIONS,
  lastPlayed: 0,
  ...over,
})

describe('positionAt', () => {
  it('moves with the clock while playing, at the playback rate', () => {
    expect(positionAt(info({ playing: true, position: 10, at: 1000 }), 3000)).toBe(12)
    expect(positionAt(info({ playing: true, position: 10, at: 1000, rate: 2 }), 2000)).toBe(12)
  })
  it('stays put while paused and never runs past the end', () => {
    expect(positionAt(info({ position: 10, at: 0 }), 99_000)).toBe(10)
    expect(positionAt(info({ playing: true, position: 99, at: 0 }), 10_000)).toBe(100)
  })
  it('ignores the clock for live streams', () => {
    expect(positionAt(info({ playing: true, position: 5, duration: Infinity, at: 0 }), 10_000)).toBe(5)
  })
})

describe('formatTime', () => {
  it('formats like a player', () => {
    expect(formatTime(7)).toBe('0:07')
    expect(formatTime(205.9)).toBe('3:25')
    expect(formatTime(3729)).toBe('1:02:09')
    expect(formatTime(NaN)).toBe('0:00')
  })
})

describe('isWorthShowing', () => {
  it('skips UI sounds and muted autoplay previews', () => {
    expect(isWorthShowing({ duration: 0.4, everAudible: true, hasMetadata: false })).toBe(false)
    expect(isWorthShowing({ duration: 30, everAudible: false, hasMetadata: false })).toBe(false)
  })
  it('shows audible media, live streams and anything the page described', () => {
    expect(isWorthShowing({ duration: 30, everAudible: true, hasMetadata: false })).toBe(true)
    expect(isWorthShowing({ duration: Infinity, everAudible: true, hasMetadata: false })).toBe(true)
    expect(isWorthShowing({ duration: 1, everAudible: false, hasMetadata: true })).toBe(true)
  })
})

describe('ordering', () => {
  it('lists playing first, newest play first', () => {
    const a = info({ key: 'a', playing: false, lastPlayed: 50 })
    const b = info({ key: 'b', playing: true, lastPlayed: 10 })
    const c = info({ key: 'c', playing: true, lastPlayed: 20 })
    expect(orderSessions([a, b, c]).map((m) => m.key)).toEqual(['c', 'b', 'a'])
    expect(primaryOf([a, b, c])?.key).toBe('c')
    expect(primaryOf([])).toBeNull()
  })
})

describe('pickArtwork', () => {
  it('takes the largest image', () => {
    expect(pickArtwork([{ src: 's', sizes: '96x96' }, { src: 'l', sizes: '512x512' }, { src: 'm', sizes: '256x256 128x128' }])).toBe('l')
    expect(pickArtwork([{ src: 'a', sizes: '512x512' }, { src: 'any', sizes: 'any' }])).toBe('any')
    expect(pickArtwork([{ src: 'only' }])).toBe('only')
    expect(pickArtwork([])).toBeNull()
  })
})

describe('trackIdentity', () => {
  const base = { key: 'm1', title: 'Thriller', artist: 'Michael Jackson', playing: true }
  it('names a playing, described track', () => {
    expect(trackIdentity(base)).toBe(trackIdentity({ ...base, key: 'm2' }))
    expect(trackIdentity(base)).not.toBe(trackIdentity({ ...base, title: 'Beat It' }))
  })
  it('announces nothing paused, untitled or absent', () => {
    expect(trackIdentity({ ...base, playing: false })).toBeNull()
    expect(trackIdentity({ ...base, title: '' })).toBeNull()
    expect(trackIdentity(null)).toBeNull()
  })
})

describe('pageTitleAsTrack', () => {
  it('drops play glyphs and notification counts', () => {
    expect(pageTitleAsTrack('▶ Sweden | C418')).toBe('Sweden | C418')
    expect(pageTitleAsTrack('(3) Thriller - YouTube')).toBe('Thriller - YouTube')
    expect(pageTitleAsTrack('Anitek - The Deep | Jamendo Music')).toBe('Anitek - The Deep | Jamendo Music')
  })
})
