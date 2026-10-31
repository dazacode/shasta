import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

const mem = new Map<string, string>()
const sess = new Map<string, string>()
const sessStorage = { getItem: (k: string) => sess.get(k) ?? null, setItem: (k: string, v: string) => void sess.set(k, v), removeItem: (k: string) => void sess.delete(k) }
vi.stubGlobal('sessionStorage', sessStorage)
const memStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8080' })
vi.stubGlobal('localStorage', memStorage)
vi.stubGlobal('window', { addEventListener: () => undefined })
vi.stubGlobal('document', { addEventListener: () => undefined })

const sup = await import('@/lib/supporter')
const { purgeLegacyPaymentKeys, base64urlEncode, daysLeft, needsRefresh, normalizeCode, sanitizeRecord, statusOf, verifyToken } = sup
const { migrateSettings, mergeSettings, defaultSettings, useSettings } = await import('@/stores/settingsStore')
const { buildProfile, parseProfile, sanitizeSettings, PORTABLE_SETTINGS } = await import('@/lib/profile')
const { WALLPAPERS, effectiveWallpaper, isLockedWallpaper } = await import('@/lib/wallpaper')
const { emptyLocal } = await import('@/store/localLibrary')

const NOW = 1_800_000_000
const DAY = 86400
let keys: CryptoKeyPair
let pub: Uint8Array<ArrayBuffer>

async function sign(payload: unknown, key = keys.privateKey) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, bytes))
  return `${base64urlEncode(bytes)}.${base64urlEncode(sig)}`
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
})

describe('code input', () => {
  it('normalizes case, spacing, dashes and the Crockford look-alikes', () => {
    expect(normalizeCode('  shasta-abcd-efgh-jkmn ')).toBe('SHASTA-ABCD-EFGH-JKMN')
    expect(normalizeCode('SHASTA ABCD EFGH JKMN')).toBe('SHASTA-ABCD-EFGH-JKMN')
    expect(normalizeCode('abcdefghjkmn')).toBe('SHASTA-ABCD-EFGH-JKMN')
    expect(normalizeCode('shasta-oOiL-1234-5678')).toBe('SHASTA-0011-1234-5678')
    expect(normalizeCode('SHASTA–ABCD–EFGH–JKMN')).toBe('SHASTA-ABCD-EFGH-JKMN') // en dashes from a paste
  })

  it('rejects anything that cannot be a code', () => {
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode('SHASTA-ABCD-EFGH')).toBeNull()
    expect(normalizeCode('SHASTA-ABCD-EFGH-JKMNP')).toBeNull()
    expect(normalizeCode('SHASTA-UUUU-EFGH-JKMN')).toBeNull() // U is not in Crockford base32
    expect(normalizeCode('SHASTA-AB!D-EFGH-JKMN')).toBeNull()
  })
})

describe('pass verification', () => {
  it('accepts a good pass', async () => {
    const t = await sign({ v: 1, kind: 'supporter', iat: NOW - DAY, exp: NOW + 30 * DAY })
    const r = await verifyToken(t, pub, NOW)
    expect(r).toEqual({ ok: true, payload: { v: 1, kind: 'supporter', iat: NOW - DAY, exp: NOW + 30 * DAY } })
  })

  it('rejects a tampered payload or signature, and another key', async () => {
    const t = await sign({ v: 1, kind: 'trial', iat: NOW, exp: NOW + 7 * DAY })
    const [, s] = t.split('.')
    const forged = `${base64urlEncode(new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'supporter', iat: NOW, exp: NOW + 999 * DAY })))}.${s}`
    expect(await verifyToken(forged, pub, NOW)).toMatchObject({ ok: false, reason: 'signature' })
    const flipped = t.slice(0, -2) + (t.endsWith('AA') ? 'BA' : 'AA')
    expect((await verifyToken(flipped, pub, NOW)).ok).toBe(false)
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    expect(await verifyToken(await sign({ v: 1, kind: 'supporter', iat: NOW, exp: NOW + DAY }, other.privateKey), pub, NOW)).toMatchObject({ ok: false, reason: 'signature' })
  })

  it('reports an expired pass, a wrong version and garbage', async () => {
    expect(await verifyToken(await sign({ v: 1, kind: 'supporter', iat: NOW - 40 * DAY, exp: NOW - 1 }), pub, NOW)).toMatchObject({ ok: false, reason: 'expired' })
    expect(await verifyToken(await sign({ v: 2, kind: 'supporter', iat: NOW, exp: NOW + DAY }), pub, NOW)).toMatchObject({ ok: false, reason: 'version' })
    expect(await verifyToken(await sign({ v: 1, kind: 'gold', iat: NOW, exp: NOW + DAY }), pub, NOW)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(await verifyToken('nope', pub, NOW)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(await verifyToken('a.b.c', pub, NOW)).toMatchObject({ ok: false, reason: 'malformed' })
  })

})

describe('status', () => {
  it('derives status and days left', async () => {
    const rec = { code: 'SHASTA-ABCD-EFGH-JKMN', token: await sign({ v: 1, kind: 'trial', iat: NOW, exp: NOW + 3 * DAY }) }
    const good = await verifyToken(rec.token, pub, NOW)
    expect(statusOf(null, null)).toBe('none')
    expect(statusOf(rec, good)).toBe('trial')
    expect(statusOf({ ...rec, token: null }, null)).toBe('expired')
    expect(statusOf(rec, await verifyToken(rec.token, pub, NOW + 4 * DAY))).toBe('expired')
    expect(daysLeft(NOW + 3 * DAY, NOW)).toBe(3)
    expect(daysLeft(NOW + 3 * DAY - 10, NOW)).toBe(3)
    expect(daysLeft(NOW + 60, NOW)).toBe(1)
    expect(daysLeft(NOW - 60, NOW)).toBe(0)
  })

  it('refreshes under a week left or when over, never for an ended code', async () => {
    const rec = (exp: number) => sign({ v: 1, kind: 'supporter', iat: NOW, exp }).then((token) => ({ code: 'SHASTA-ABCD-EFGH-JKMN', token }))
    const far = await rec(NOW + 30 * DAY)
    const soon = await rec(NOW + 6 * DAY)
    const over = await rec(NOW - DAY)
    expect(needsRefresh(far, await verifyToken(far.token, pub, NOW), NOW)).toBe(false)
    expect(needsRefresh(soon, await verifyToken(soon.token, pub, NOW), NOW)).toBe(true)
    expect(needsRefresh(over, await verifyToken(over.token, pub, NOW), NOW)).toBe(true)
    expect(needsRefresh({ code: far.code, token: null }, null, NOW)).toBe(false)
    expect(needsRefresh(null, null, NOW)).toBe(false)
  })
})

describe('settings', () => {
  it('migrates v4 settings: no supporter, early previews off', () => {
    const s = migrateSettings({ settings: { theme: 'dark' } }, 4).settings!
    expect(s.supporter).toBeNull()
    expect(s.earlyPreviews).toBe(false)
    expect(s.theme).toBe('dark')
  })

  it('validates a saved supporter record instead of trusting it', () => {
    const current = { settings: defaultSettings(), update: () => undefined, reset: () => undefined }
    expect(mergeSettings({ settings: { supporter: { code: 'shasta-abcd-efgh-jkmn', token: 'x.y' } } }, current).settings.supporter).toEqual({ code: 'SHASTA-ABCD-EFGH-JKMN', token: 'x.y' })
    expect(mergeSettings({ settings: { supporter: { code: 'evil' } } }, current).settings.supporter).toBeNull()
    expect(mergeSettings({ settings: { supporter: 'nope', earlyPreviews: 'yes' } }, current).settings).toMatchObject({ supporter: null, earlyPreviews: false })
    expect(sanitizeRecord({ code: 'SHASTA-ABCD-EFGH-JKMN', token: 42 })).toEqual({ code: 'SHASTA-ABCD-EFGH-JKMN', token: null })
  })
})

describe('profile export', () => {
  it('never carries the supporter code or pass, and import ignores one', () => {
    expect(PORTABLE_SETTINGS).not.toContain('supporter' as never)
    const settings = { ...defaultSettings(), supporter: { code: 'SHASTA-ABCD-EFGH-JKMN', token: 'secret.pass' }, earlyPreviews: true }
    const text = JSON.stringify(buildProfile(settings, [], emptyLocal()))
    expect(text).not.toContain('SHASTA-ABCD')
    expect(text).not.toContain('secret.pass')
    expect(sanitizeSettings({ supporter: { code: 'SHASTA-ABCD-EFGH-JKMN', token: 't' }, theme: 'dark' })).toEqual({ theme: 'dark' })
    const r = parseProfile(JSON.stringify({ format: 'shasta-profile', version: 1, settings: { supporter: { code: 'SHASTA-ABCD-EFGH-JKMN', token: 't' } } }))
    expect(r.ok && r.profile.settings).toEqual({})
  })
})

describe('supporter wallpapers', () => {
  it('has at least four, and a locked saved choice draws the default without being changed', () => {
    const perks = Object.entries(WALLPAPERS).filter(([, w]) => w.supporter).map(([k]) => k)
    expect(perks.length).toBeGreaterThanOrEqual(4)
    expect(isLockedWallpaper('aurora', false)).toBe(true)
    expect(isLockedWallpaper('alpine', false)).toBe(false)
    expect(effectiveWallpaper('aurora', false)).toBe('none')
    expect(effectiveWallpaper('aurora', true)).toBe('aurora')
    expect(effectiveWallpaper('alpine', false)).toBe('alpine')
  })
})

describe('supporter store', () => {
  const code = 'SHASTA-ABCD-EFGH-JKMN'
  let responses: Record<string, () => Response>
  beforeEach(() => {
    mem.clear()
    vi.stubGlobal('localStorage', memStorage) // stubs are restored between tests
    useSettings.persist.setOptions({ storage: createJSONStorage(() => memStorage) })
    useSettings.setState({ settings: defaultSettings() })
    responses = { '/api/supporter/public-key': () => Response.json({ key: base64urlEncode(pub) }) }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (responses[url] ?? (() => new Response(null, { status: 500 })))()))
  })

  it('redeems a code, then a 410 on refresh ends the perks but keeps the code', async () => {
    const { useSupporterStore } = await import('@/stores/supporterStore')
    const exp = Math.floor(Date.now() / 1000) + 3 * DAY
    const token = await sign({ v: 1, kind: 'trial', iat: exp - 7 * DAY, exp })
    responses['/api/supporter/redeem'] = () => Response.json({ token, kind: 'trial', exp })
    expect(await useSupporterStore.getState().redeem(' shasta-abcd-efgh-jkmn ')).toBeNull()
    expect(useSettings.getState().settings.supporter).toEqual({ code, token })
    expect(useSupporterStore.getState().status).toBe('trial')

    responses['/api/supporter/refresh'] = () => new Response(null, { status: 410 })
    await useSupporterStore.getState().refresh() // 3 days left: due
    expect(useSettings.getState().settings.supporter).toEqual({ code, token: null })
    expect(useSupporterStore.getState()).toMatchObject({ status: 'expired', note: 'ended' })
  })

  it('keeps the pass when the server cannot be reached', async () => {
    const { useSupporterStore } = await import('@/stores/supporterStore')
    const exp = Math.floor(Date.now() / 1000) + 2 * DAY
    const token = await sign({ v: 1, kind: 'supporter', iat: exp - 30 * DAY, exp })
    useSettings.getState().update({ supporter: { code, token } })
    responses['/api/supporter/refresh'] = () => {
      throw new TypeError('offline')
    }
    await useSupporterStore.getState().refresh()
    expect(useSettings.getState().settings.supporter).toEqual({ code, token })
    expect(useSupporterStore.getState().status).toBe('supporter')
  })

  it('explains redeem failures and refuses a forged pass', async () => {
    const { useSupporterStore } = await import('@/stores/supporterStore')
    expect(await useSupporterStore.getState().redeem('hello')).toMatch(/doesn't look like/)
    responses['/api/supporter/redeem'] = () => new Response(null, { status: 404 })
    expect(await useSupporterStore.getState().redeem(code)).toMatch(/isn't known/)
    responses['/api/supporter/redeem'] = () => new Response(null, { status: 429 })
    expect(await useSupporterStore.getState().redeem(code)).toMatch(/Too many/)
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const forged = await sign({ v: 1, kind: 'supporter', iat: 1, exp: 4_000_000_000 }, other.privateKey)
    responses['/api/supporter/redeem'] = () => Response.json({ token: forged, kind: 'supporter', exp: 4_000_000_000 })
    expect(await useSupporterStore.getState().redeem(code)).toMatch(/could not check/)
    expect(useSettings.getState().settings.supporter).toBeNull()
  })
})

describe('shasta://support', () => {
  it('is a Shasta page', async () => {
    const { internalPage, resolveInput, titleFor } = await import('@/lib/url')
    expect(internalPage('shasta://support')).toBe('support')
    expect(resolveInput('shasta://support', 'google')).toEqual({ kind: 'internal', url: 'shasta://support' })
    expect(titleFor('shasta://support')).toBe('Support Shasta')
  })
})

describe('old payment detection leftovers', () => {
  it('deletes stale pending keys from both storages and survives blocked storage', () => {
    mem.clear()
    sess.clear()
    mem.set('shasta-support-ref', '{"ref":"SH-ABCD-EFGH"}')
    mem.set('shasta-support-pending', 'x')
    sess.set('shasta-support-pending', '{"email":"a@b.co"}')
    sess.set('shasta-support-ref', 'x')
    mem.set('keep-me', '1')
    purgeLegacyPaymentKeys()
    expect([...mem.keys()]).toEqual(['keep-me'])
    expect(sess.size).toBe(0)
    const bad = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { removeItem: bad })
    vi.stubGlobal('sessionStorage', { removeItem: bad })
    expect(() => purgeLegacyPaymentKeys()).not.toThrow()
    vi.stubGlobal('localStorage', memStorage)
    vi.stubGlobal('sessionStorage', sessStorage)
  })

  it('has no payment-detection exports left', () => {
    for (const name of ['generateRef', 'claim', 'startClaimPoll', 'isEmail', 'normalizeEmail', 'loadPendingClaim', 'loadPendingRef']) expect(name in sup).toBe(false)
  })
})

// last on purpose: it resets the module registry (ed25519Supported() is memoized per module)
describe('pass verification without WebCrypto Ed25519', () => {
  it('falls back to @noble/ed25519 where WebCrypto has no Ed25519 (school Chromebooks on Chrome 126)', async () => {
    const good = await sign({ v: 1, kind: 'supporter', iat: NOW - DAY, exp: NOW + 30 * DAY })
    const [, s] = good.split('.')
    const forged = `${base64urlEncode(new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'supporter', iat: NOW, exp: NOW + 999 * DAY })))}.${s}`
    const realImport = crypto.subtle.importKey.bind(crypto.subtle) as (...a: unknown[]) => Promise<CryptoKey>
    const spy = vi.spyOn(crypto.subtle, 'importKey').mockImplementation(((...a: unknown[]) =>
      (a[2] as { name?: string })?.name === 'Ed25519' ? Promise.reject(new DOMException('Unrecognized name', 'NotSupportedError')) : realImport(...a)) as typeof crypto.subtle.importKey)
    try {
      vi.resetModules() // ed25519Supported() is memoized per module
      const old = await import('@/lib/supporter')
      expect(await old.ed25519Supported()).toBe(false)
      expect(await old.verifyToken(good, pub, NOW)).toMatchObject({ ok: true, payload: { kind: 'supporter' } })
      expect(await old.verifyToken(forged, pub, NOW)).toMatchObject({ ok: false, reason: 'signature' })
    } finally {
      spy.mockRestore()
    }
  })
})
