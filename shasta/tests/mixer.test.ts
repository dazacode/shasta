// The sound mixer's model (lib/mixer.ts), the island's choice of what to show (lib/media.ts pickFront), what the OS is told
// (lib/mediaBridge.ts) and the island preference. Pure, so tested here; the audio hooks themselves are checked in a browser.
import { describe, expect, it } from 'vitest'
import { NO_ACTIONS, FRONT_PAUSED_MS, bridgeIdentity, pickFront, type MediaInfo } from '@/lib/media'
import { buildSources, clampLevel, effectiveGain, hostOf, percent, sanitizeMixer, sourceKey, stepLevel, type SourceTab } from '@/lib/mixer'
import { sanitizePrefs } from '@/shasuta/state'

const session = (o: Partial<MediaInfo> & { tabId: string; key: string }): MediaInfo => ({ kind: 'audio', title: '', artist: '', album: '', artwork: null, playing: true, position: 0, duration: 200, rate: 1, at: 0, muted: false, volume: 1, actions: NO_ACTIONS, lastPlayed: 100, ...o })
const tab = (id: string, url: string, o: Partial<SourceTab> = {}): SourceTab => ({ id, appId: null, appName: null, iconUrl: null, url, title: `Tab ${id}`, ...o })

describe('how loud a source is', () => {
  it('is the master level times the source level, and silence when muted', () => {
    expect(effectiveGain(1, {}, {}, 'site:a.com')).toBe(1)
    expect(effectiveGain(0.5, { 'site:a.com': 0.5 }, {}, 'site:a.com')).toBeCloseTo(0.25)
    expect(effectiveGain(1, { 'site:a.com': 0.5 }, { 'site:a.com': true }, 'site:a.com')).toBe(0)
    expect(effectiveGain(0, {}, {}, 'site:a.com')).toBe(0)
  })
  it('never leaves 0..1, whatever it is fed', () => {
    expect(clampLevel(2)).toBe(1)
    expect(clampLevel(-1)).toBe(0)
    expect(clampLevel(Number.NaN)).toBe(1)
    expect(effectiveGain(5, { k: 9 }, {}, 'k')).toBe(1)
  })
  it('steps a slider by five percent and stops at the ends', () => {
    expect(stepLevel(0.5, 1)).toBeCloseTo(0.55)
    expect(stepLevel(0.5, -1)).toBeCloseTo(0.45)
    expect(stepLevel(1, 1)).toBe(1)
    expect(stepLevel(0, -1)).toBe(0)
    expect(stepLevel(0.3, 1, 0.03)).toBeCloseTo(0.33)
    expect(percent(0.456)).toBe('46%')
  })
})

describe('what is remembered', () => {
  it('keeps good levels, drops full-volume ones (nothing to remember) and anything odd', () => {
    const out = sanitizeMixer({ master: 0.7, levels: { 'site:youtube.com': 0.4, 'app:g1': 1, 'site:x.com': 'loud', evil: 0.1, 'tab:1': Number.NaN } })
    expect(out.master).toBe(0.7)
    expect(out.levels).toEqual({ 'site:youtube.com': 0.4 })
  })
  it('has safe defaults and a bounded table', () => {
    expect(sanitizeMixer(undefined)).toEqual({ master: 1, levels: {} })
    expect(sanitizeMixer('junk')).toEqual({ master: 1, levels: {} })
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`site:s${i}.com`, 0.5]))
    expect(Object.keys(sanitizeMixer({ levels: many }).levels).length).toBeLessThanOrEqual(200)
  })
})

describe('sources', () => {
  it('names a source by its game, else its site, so two tabs of one site share a slider', () => {
    expect(sourceKey(tab('1', 'https://www.youtube.com/watch?v=1'))).toBe('site:youtube.com')
    expect(sourceKey(tab('2', 'https://music.youtube.com/'))).toBe('site:music.youtube.com')
    expect(sourceKey({ id: '3', appId: 'g7', url: 'https://x.com/' })).toBe('app:g7')
    expect(sourceKey(tab('4', ''))).toBe('tab:4')
    expect(hostOf('not a url')).toBe('')
  })
  it('lists only what makes sound, one row per source, playing first', () => {
    const tabs = [tab('1', 'https://a.com/', { title: 'A music' }), tab('2', 'https://a.com/other', { title: 'A other' }), tab('3', 'https://b.com/', { title: 'B' }), tab('4', 'https://quiet.com/'), tab('5', 'game://g1', { appId: 'g1', appName: 'Pixel Dash', iconUrl: 'i.png' })]
    const byTab = {
      '1': [session({ tabId: '1', key: 'm1', title: 'Song', playing: false, lastPlayed: 50 })],
      '2': [session({ tabId: '2', key: 'm2', title: 'Other', playing: true, lastPlayed: 90 })],
      '3': [session({ tabId: '3', key: 'm3', kind: 'video', playing: false, lastPlayed: 10 })],
    }
    const rows = buildSources(tabs, byTab, { '5': true })
    expect(rows.map((r) => r.key)).toEqual(['site:a.com', 'app:g1', 'site:b.com'])
    const a = rows[0]
    expect(a.tabIds).toEqual(['1', '2'])
    expect(a.session?.key).toBe('m2')
    expect(a.playing).toBe(true)
    expect(rows[1]).toMatchObject({ name: 'Pixel Dash', kind: 'game', playing: true, webAudio: true, iconUrl: 'i.png' })
    expect(rows[2]).toMatchObject({ kind: 'video', playing: false })
    expect(rows.some((r) => r.key === 'site:quiet.com')).toBe(false)
  })
  it('an installed app that plays an <audio> is music, not game sound', () => {
    const rows = buildSources([tab('1', 'game://x', { appId: 'x', appName: 'Radio' })], { '1': [session({ tabId: '1', key: 'm' })] }, {})
    expect(rows[0].kind).toBe('music')
  })
})

describe('what the island shows', () => {
  it('prefers what is playing, newest first, and keeps a paused one only for ten minutes', () => {
    const a = session({ tabId: '1', key: 'a', playing: true, lastPlayed: 100 })
    const b = session({ tabId: '2', key: 'b', playing: true, lastPlayed: 300 })
    const p = session({ tabId: '3', key: 'p', playing: false, lastPlayed: 500 })
    expect(pickFront([a, b, p], 600)?.key).toBe('b')
    expect(pickFront([p], 600)?.key).toBe('p')
    expect(pickFront([p], 500 + FRONT_PAUSED_MS + 1)).toBeNull()
    expect(pickFront([session({ tabId: '4', key: 'never', playing: false, lastPlayed: 0 })], 10)).toBeNull()
    expect(pickFront([], 0)).toBeNull()
  })
})

describe('what the operating system is told', () => {
  it('changes only when the track or the actions change, never every second', () => {
    const m = session({ tabId: '1', key: 'm1', title: 'Song', artist: 'Me', position: 1 })
    expect(bridgeIdentity(m, 'Song')).toBe(bridgeIdentity({ ...m, position: 99, playing: false }, 'Song'))
    expect(bridgeIdentity(m, 'Song')).not.toBe(bridgeIdentity({ ...m, title: 'Next' }, 'Next'))
    expect(bridgeIdentity(m, 'Song')).not.toBe(bridgeIdentity({ ...m, actions: { ...m.actions, nexttrack: true } }, 'Song'))
    expect(bridgeIdentity(null, '')).toBe('')
  })
})

describe('the island preference', () => {
  it('is on hover by default and accepts only its three modes', () => {
    expect(sanitizePrefs({}).island).toBe('hover')
    for (const m of ['hover', 'always', 'off'] as const) expect(sanitizePrefs({ island: m }).island).toBe(m)
    expect(sanitizePrefs({ island: 'sometimes' }).island).toBe('hover')
    expect(sanitizePrefs({ island: 1 }).island).toBe('hover')
  })
})
