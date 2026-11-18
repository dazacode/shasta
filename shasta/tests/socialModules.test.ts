// The small social modules: bundle validation (untrusted data from another device), theme contrast (the server's
// rule), handle rules, avatars, stickers, the store's event reducer and the API's error mapping.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as { location?: unknown }).location ??= new URL('https://edushasta.lol/me')
})

import { validateBundle } from '@/social/bundle'
import { BACKGROUNDS, contrastOk, contrastRatio, DEFAULT_THEME, PALETTES, themeProblems, themeStyle, validTheme } from '@/social/themes'
import { handleProblem } from '@/social/schemas'
import { avatarUri, parsePreset, randomAvatar, validAvatar } from '@/social/avatars'
import { isSticker, STICKERS } from '@/social/stickers'
import { applyEvent } from '@/social/store'
import { ApiError, errorText, nudgeOf, social } from '@/social/api'
import { saveToken } from '@/social/auth'
import type { Conversation, Friend, Message, Person } from '@/social/types'

describe('session bundle validation', () => {
  it('keeps a good bundle and cleans the library through fromManifest', () => {
    const b = validateBundle({
      v: 1,
      library: { apps: [{ appId: 'a1', version: '2', pinned: true, folderId: 'f1' }, { appId: 'a1' }, { nope: 1 }], favorites: ['a1', 5], folders: [{ id: 'f1', name: 'Fun' }], following: [] },
      settings: { theme: 'dark', wispUrl: 'wss://evil' },
      playing: { appId: 'a1' },
    })!
    expect(b.v).toBe(1)
    expect(b.library).toEqual({ apps: [{ appId: 'a1', version: '2', pinned: true, folderId: 'f1' }], favorites: ['a1'], folders: [{ id: 'f1', name: 'Fun' }], following: [] })
    expect(b.playing).toEqual({ appId: 'a1' })
    // settings are passed through as data; importBundle filters them with sanitizeSettings (PORTABLE_SETTINGS only)
    expect(b.settings).toEqual({ theme: 'dark', wispUrl: 'wss://evil' })
  })

  it('refuses what is not a bundle', () => {
    expect(validateBundle(null)).toBeNull()
    expect(validateBundle([])).toBeNull()
    expect(validateBundle({ v: 2 })).toBeNull()
    expect(validateBundle('{"v":1}')).toBeNull()
    expect(validateBundle({ v: 1, library: { apps: Array.from({ length: 5000 }, (_, i) => ({ appId: `app-${i}-${'x'.repeat(20)}` })) } })).toBeNull()
  })

  it('drops a bad playing id and odd settings', () => {
    const b = validateBundle({ v: 1, library: {}, settings: [1, 2], playing: { appId: '../../etc' } })!
    expect(b.playing).toBeNull()
    expect(b.settings).toEqual({})
    expect(b.library).toEqual({ apps: [], favorites: [], folders: [], following: [] })
  })
})

describe('theme contrast', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastOk('#767676', '#ffffff')).toBe(true) // 4.54
    expect(contrastOk('#777777', '#ffffff')).toBe(false) // 4.48
    expect(contrastRatio('nope', '#fff')).toBe(1)
  })

  it('every curated palette is readable', () => {
    for (const p of PALETTES) expect(themeProblems({ ...p.colors, font: 'system', background: 'none' }), p.id).toEqual([])
  })

  it('validTheme refuses unreadable or unknown parts; themeStyle falls back to the default', () => {
    expect(validTheme(DEFAULT_THEME)).toBe(true)
    expect(validTheme({ ...DEFAULT_THEME, text: DEFAULT_THEME.bg })).toBe(false)
    expect(validTheme({ ...DEFAULT_THEME, font: 'comic' })).toBe(false)
    expect(validTheme({ ...DEFAULT_THEME, background: 'url(x)' })).toBe(false)
    expect(validTheme({ ...DEFAULT_THEME, accent: 'red' })).toBe(false)
    const bad = themeStyle({ ...DEFAULT_THEME, text: '#f4f1ea' }) as Record<string, string>
    expect(bad['--p-text']).toBe(DEFAULT_THEME.text)
    for (const b of BACKGROUNDS) expect(b.css(DEFAULT_THEME)).not.toMatch(/url\(/)
  })
})

describe('handles', () => {
  it('follows the contract', () => {
    expect(handleProblem('sam_99')).toBeNull()
    expect(handleProblem('Sam')).toBeNull() // typed in capitals: lowercased
    expect(handleProblem('ab')).toMatch(/3/)
    expect(handleProblem('a'.repeat(21))).toMatch(/20/)
    expect(handleProblem('sam smith')).toMatch(/letters/)
    expect(handleProblem('shasta')).toMatch(/reserved/)
    expect(handleProblem('the_admin')).toMatch(/reserved/)
    expect(handleProblem('modeling')).toBeNull()
  })
})

describe('avatars and stickers', () => {
  it('random avatars are valid presets; junk is not', () => {
    for (let i = 0; i < 20; i++) expect(validAvatar(randomAvatar())).toBe(true)
    expect(parsePreset('lorelei:abc')).toEqual({ style: 'lorelei', seed: 'abc' })
    expect(validAvatar({ preset: 'avataaars:abc', bg: '#ffffff' })).toBe(false)
    expect(validAvatar({ preset: 'lorelei:<svg>', bg: '#ffffff' })).toBe(false)
    expect(validAvatar({ preset: 'lorelei:abc', bg: 'red' })).toBe(false)
  })
  it('draws every style locally as an SVG data URI', async () => {
    for (const style of ['lorelei', 'notionists', 'open-peeps', 'thumbs', 'pixel-art'] as const) {
      const uri = await avatarUri(randomAvatar(style))
      expect(uri?.startsWith('data:image/svg+xml')).toBe(true)
    }
    expect(await avatarUri({ preset: 'nope:1', bg: '#ffffff' })).toBeNull()
  })
  it('stickers are self-hosted, unique, about 40', () => {
    expect(STICKERS.length).toBeGreaterThanOrEqual(36)
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length)
    for (const s of STICKERS) expect(s.src).toMatch(/^\/social\/stickers\/[a-z-]+\.svg$/)
    expect(isSticker('heart')).toBe(true)
    expect(isSticker('javascript:alert(1)')).toBe(false)
  })
})

const person = (id: string): Person => ({ id, handle: id, avatar: { preset: 'lorelei:a', bg: '#ffffff' }, mood: null, status: null })
const conv = (id: string, withId: string, lastAt: number, unread = 0): Conversation => ({ id, with: person(withId), lastAt, unread, preview: null })
const msg = (conversationId: string, from: string, createdAt: number): Message => ({ id: `m${createdAt}`, clientId: `c${createdAt}`, conversationId, from, text: 'hi', createdAt, app: null })

describe('store events', () => {
  const base = () => ({ me: { id: 'me' } as never, friends: [] as Friend[], requests: [], presence: {}, conversations: [conv('c1', 'a', 10), conv('c2', 'b', 20)], typing: { a: Date.now() + 5000 } })

  it('a message moves its conversation to the top and counts as unread', () => {
    const s = base()
    const out = applyEvent(s, { type: 'message', message: msg('c1', 'a', 30), conversation: conv('c1', 'a', 30) })
    expect(out.conversations!.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(out.conversations![0].unread).toBe(1)
    expect(out.unread).toBe(1)
    expect(out.typing).toEqual({})
  })
  it('my own message (another device) is not unread; my read clears it', () => {
    const s = { ...base(), conversations: [conv('c1', 'a', 10, 3)] }
    expect(applyEvent(s, { type: 'message', message: msg('c1', 'me', 40), conversation: conv('c1', 'a', 40) }).unread).toBe(3)
    expect(applyEvent(s, { type: 'message_read', conversationId: 'c1', upTo: 40, by: 'me' }).unread).toBe(0)
    expect(applyEvent(s, { type: 'message_read', conversationId: 'c1', upTo: 40, by: 'a' })).toEqual({})
  })
  it('friends come and go, and their presence goes with them', () => {
    const s = { ...base(), requests: [{ id: 'r1', from: person('z'), createdAt: 0, expiresAt: 1 }], presence: { z: { accountId: 'z' } as never } }
    const added = applyEvent(s, { type: 'friend_added', friend: { ...person('z'), friendsSince: 1, playing: null } })
    expect(added.friends!.map((f) => f.id)).toEqual(['z'])
    expect(added.requests).toEqual([])
    const removed = applyEvent({ ...s, friends: added.friends! }, { type: 'friend_removed', accountId: 'z' })
    expect(removed.friends).toEqual([])
    expect(removed.presence).toEqual({})
  })
})

describe('api errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the server error shape, nudges, and signs out on 401', async () => {
    await saveToken('t1')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'nudge', message: 'check', details: { kind: 'phone' } } }), { status: 422 }))
    const e = await social.send({ to: 'a', clientId: 'c', text: 'call me 555' }).catch((x) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(nudgeOf(e)).toBe('phone')

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'nope', code: 'rate_limited' }), { status: 429 }))
    expect(errorText(await social.feed().catch((x) => x))).toMatch(/a lot at once/)

    let auth = ''
    vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).authorization
      return new Response('{}', { status: 401 })
    })
    await social.me().catch(() => {})
    expect(auth).toBe('Bearer t1')
    const { loadToken } = await import('@/social/auth')
    expect(await loadToken()).toBeNull()
  })

  it('a network failure is "offline", and lists may come wrapped', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('failed')
    })
    expect((await social.devices().catch((x) => x)).code).toBe('offline')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ devices: [{ id: 'd1' }] }), { status: 200 }))
    expect(await social.devices()).toEqual([{ id: 'd1' }])
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([{ id: 'p1' }]), { status: 200 }))
    expect(await social.blocks()).toEqual([{ id: 'p1' }])
  })
})
