import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8080' })
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })
vi.stubGlobal('document', { addEventListener: () => undefined })

const { buildProfile, parseProfile, sanitizeSettings, PORTABLE_SETTINGS, summarize } = await import('@/lib/profile')
const { defaultSettings } = await import('@/stores/settingsStore')
import { composeLibrary, emptyLocal, fromManifest, mergeLocal, toManifest, type LocalLibrary } from '@/store/localLibrary'

const local = (): LocalLibrary => ({
  installs: [{ appId: 'a1', installedVersion: '1.0', installedAt: 5, lastLaunchedAt: 9, launchCount: 3, pinned: true, folderId: 'f1' }],
  favorites: ['a2'],
  folders: [{ id: 'f1', name: 'Games', createdAt: 1 }],
  following: ['s1'],
})

describe('profile export', () => {
  it('only carries allow-listed settings: nothing sensitive or device-specific can leak in', () => {
    const settings = { ...defaultSettings(), cookie: 'session=abc', authToken: 'secret', wispUrl: 'wss://private.example/wisp/' } as unknown as ReturnType<typeof defaultSettings>
    const text = JSON.stringify(buildProfile(settings, [], local()))
    expect(text).not.toContain('session=abc')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('private.example')
    expect(Object.keys(JSON.parse(text).settings).sort()).toEqual([...PORTABLE_SETTINGS].sort())
  })

  it('exports the installed-app manifest without usage data', () => {
    const m = toManifest(local())
    expect(m.apps).toEqual([{ appId: 'a1', version: '1.0', pinned: true, folderId: 'f1' }])
    expect(JSON.stringify(m)).not.toContain('launchCount')
  })

  it('round-trips through parseProfile', () => {
    const bm = [{ id: 'b', type: 'bookmark' as const, title: 'Wiki', url: 'https://wikipedia.org/', parentId: null, createdAt: 1 }]
    const r = parseProfile(JSON.stringify(buildProfile({ ...defaultSettings(), theme: 'dark', accent: 'rose' }, bm, local())))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profile.settings).toMatchObject({ theme: 'dark', accent: 'rose' })
    expect(summarize(r.profile)).toMatchObject({ bookmarks: 1, apps: 1, favorites: 1, following: 1 })
  })
})

describe('profile import validates everything', () => {
  it('rejects things that are not profiles', () => {
    expect(parseProfile('nope').ok).toBe(false)
    expect(parseProfile('{"format":"other"}').ok).toBe(false)
    expect(parseProfile(JSON.stringify({ format: 'shasta-profile', version: 99 })).ok).toBe(false)
  })

  it('drops unknown keys, wrong types, bad enums and non-web shortcut or bookmark addresses', () => {
    const s = sanitizeSettings({ theme: 'neon', accent: 'rose', density: 5, evil: 1, wallpaper: 'alpine', homepage: 'javascript:alert(1)', suspendAfterMinutes: 99999, shortcuts: [{ id: '1', title: 'ok', url: 'https://a.example/' }, { id: '2', title: 'bad', url: 'javascript:alert(1)' }] })
    expect(s).toEqual({ accent: 'rose', wallpaper: 'alpine', suspendAfterMinutes: 240, shortcuts: [{ id: '1', title: 'ok', url: 'https://a.example/' }] })
    const r = parseProfile(JSON.stringify({ format: 'shasta-profile', version: 1, bookmarks: [{ id: 'x', type: 'bookmark', title: 't', url: 'javascript:alert(1)', parentId: null }, { id: 'y', type: 'bookmark', title: 't', url: 'https://ok.example/', parentId: 'missing' }] }))
    expect(r.ok && r.profile.bookmarks).toEqual([expect.objectContaining({ id: 'y', parentId: null })])
  })

  it('manifest import ignores malformed entries and unknown folders', () => {
    const l = fromManifest({ apps: [{ appId: 'a', version: '1', pinned: true, folderId: 'nope' }, { appId: '' }, 7], favorites: ['f', 3], folders: [{ id: 'k', name: '' }], following: 'x' })
    expect(l.installs).toHaveLength(1)
    expect(l.installs[0]).toMatchObject({ appId: 'a', folderId: null, pinned: true })
    expect(l.favorites).toEqual(['f'])
    expect(l.folders).toEqual([])
    expect(l.following).toEqual([])
  })
})

describe('local library', () => {
  it('merge never overwrites what the device already has', () => {
    const base = local()
    const incoming: LocalLibrary = { installs: [{ ...base.installs[0], installedVersion: '0.1', pinned: false }, { appId: 'a9', installedVersion: '2', installedAt: 1, lastLaunchedAt: null, launchCount: 0, pinned: false, folderId: 'ghost' }], favorites: ['a2', 'a3'], folders: [], following: ['s1', 's2'] }
    const m = mergeLocal(base, incoming)
    expect(m.installs.find((i) => i.appId === 'a1')).toMatchObject({ installedVersion: '1.0', pinned: true })
    expect(m.installs.find((i) => i.appId === 'a9')?.folderId).toBeNull()
    expect(m.favorites).toEqual(['a2', 'a3'])
    expect(m.following).toEqual(['s1', 's2'])
  })

  it('composes the screen model from device data plus server answers, skipping apps the device does not hold', () => {
    const card = (id: string) => ({ id, slug: id, name: id }) as never
    const lib = composeLibrary(local(), {
      installed: [{ app: card('a1'), address: 'game://a1', available: true, unavailableReason: null, clearDataUrl: '', updateAvailable: false, latestVersion: '1.0', releaseNotes: null }, { app: card('stranger'), address: 'app://s', available: true, unavailableReason: null, clearDataUrl: '', updateAvailable: false, latestVersion: '1', releaseNotes: null }],
      favorites: [],
      following: [],
    })
    expect(lib.installed.map((i) => i.app.id)).toEqual(['a1'])
    expect(lib.installed[0]).toMatchObject({ pinned: true, folderId: 'f1', launchCount: 3 })
    expect(lib.folders).toEqual([{ id: 'f1', name: 'Games' }])
  })

  it('an empty device composes to an empty library', () => {
    expect(composeLibrary(emptyLocal(), { installed: [], favorites: [], following: [] }).installed).toEqual([])
  })
})

describe('new tab customization in a profile', () => {
  it('keeps colour, dim, clock and a cleaned section order', () => {
    const out = sanitizeSettings({ newTabBg: 'color', newTabBgColor: '#aabbcc', newTabBgDim: 500, newTabBgBlur: -4, newTabClock: '24', newTabOrder: ['recent', 'bogus', 'recent', 'apps'] })
    expect(out).toMatchObject({ newTabBg: 'color', newTabBgColor: '#aabbcc', newTabBgDim: 80, newTabBgBlur: 0, newTabClock: '24' })
    expect(out.newTabOrder).toEqual(['recent', 'apps', 'shortcuts', 'live', 'bookmarks'])
  })

  it('never carries the picture: "image" and its stamp are dropped', () => {
    expect(PORTABLE_SETTINGS).not.toContain('newTabBgImage')
    expect(sanitizeSettings({ newTabBg: 'image', newTabBgImage: 'x' })).toEqual({})
  })

  it('rejects colours that are not #rrggbb', () => {
    expect(sanitizeSettings({ newTabBgColor: 'url(javascript:1)' })).toEqual({})
    expect(sanitizeSettings({ newTabBgColor: 'red' })).toEqual({})
  })
})
