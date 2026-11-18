import { describe, expect, it } from 'vitest'
import { readPageQueue, readSessionPlaylist } from '@/proxy/queueReaders'

// no DOM in these tests: a stand-in window with just the parts the reader touches
const win = (playlist: unknown, doc: unknown = { querySelector: () => null, querySelectorAll: () => [] }) => ({ navigator: { mediaSession: { playlist } }, document: doc }) as unknown as Window
const now = { title: 'Song Two', artist: 'The Band' }

describe('the Media Session playlist', () => {
  it('does nothing where the browser or the page has no playlist', () => {
    expect(readSessionPlaylist(win(undefined), now)).toBeNull()
    expect(readSessionPlaylist(win(null), now)).toBeNull()
    expect(readSessionPlaylist(win([]), now)).toBeNull()
    expect(readSessionPlaylist({ navigator: {} } as unknown as Window, now)).toBeNull()
    expect(readSessionPlaylist({} as unknown as Window, now)).toBeNull()
  })
  it('reads the list and finds the playing entry by name, ignoring case and punctuation', () => {
    const r = readSessionPlaylist(win([{ title: 'Song One', artist: 'The Band' }, { title: 'song two!', artist: 'the band' }, { title: 'Song Three', artist: 'X' }]), now)
    expect(r?.reader).toBe('media-session')
    expect(r?.items.map((i) => i.title)).toEqual(['Song One', 'song two!', 'Song Three'])
    expect(r?.current).toBe(1)
    expect(r?.items[1].current).toBe(true)
  })
  it('says the current one is unknown rather than guessing', () => {
    const r = readSessionPlaylist(win([{ title: 'A', artist: 'B' }, { title: 'C', artist: 'D' }]), now)
    expect(r?.current).toBe(-1)
    expect(r?.items.some((i) => i.current)).toBe(false)
  })
  it('skips malformed entries and survives odd shapes', () => {
    const r = readSessionPlaylist(win([null, 5, { title: '' }, { title: 'Ok', artist: 3 }]), now)
    expect(r?.items).toEqual([{ title: 'Ok', artist: '', art: null, current: false }])
  })
  it('keeps only inline cover art, never an address on the service host', () => {
    const r = readSessionPlaylist(win([{ title: 'A', artwork: [{ src: 'https://cdn.example/a.jpg' }, { src: 'data:image/png;base64,AAAA' }] }, { title: 'B', artwork: [{ src: 'https://cdn.example/b.jpg' }] }]), now)
    expect(r?.items[0].art).toBe('data:image/png;base64,AAAA')
    expect(r?.items[1].art).toBeNull()
  })
  it('never throws, even if reading the playlist throws', () => {
    const bad = { navigator: { get mediaSession(): never { throw new Error('x') } } } as unknown as Window
    expect(readSessionPlaylist(bad, now)).toBeNull()
  })
  it('wins over the markup readers, which still work when there is no playlist', () => {
    const published = readPageQueue(win([{ title: 'P', artist: 'Q' }]), now)
    expect(published?.reader).toBe('media-session')
    expect(readPageQueue(win(undefined), now)).toBeNull()
  })
})
