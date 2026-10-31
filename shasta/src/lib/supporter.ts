// Supporter tier: the pure parts (code format, pass verification, status). The state and server calls live in
// stores/supporterStore.ts; useSupporter() there is the one gate for perks.
//
// Everything functional in Shasta is free. A supporter pass only unlocks cosmetic extras. There are no accounts: a
// code from Shasta's Discord (or the owner) is exchanged for a signed pass (a small token) that this device checks on its own with
// the server's public Ed25519 key. Nothing about browsing is ever sent or linked to the code.

export type SupporterKind = 'trial' | 'supporter'
export type SupporterStatus = 'none' | SupporterKind | 'expired'

/** What settings keep on this device. token null = the server said the code ended (shown as "ended"). */
export interface SupporterRecord {
  code: string
  token: string | null
}

export interface TokenPayload {
  v: 1
  kind: SupporterKind
  /** issued at, unix seconds */
  iat: number
  /** expires at, unix seconds */
  exp: number
}

// ---- code input --------------------------------------------------------------------------

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{12}$/
export const CODE_PREFIX = 'SHASTA'

/**
 * Turns what someone typed or pasted into the canonical SHASTA-XXXX-XXXX-XXXX form, or null when it cannot be a code.
 * Crockford base32 reading rules: case-insensitive, O reads as 0, I and L read as 1; spaces and dashes are ignored and
 * the SHASTA prefix is optional.
 */
export function normalizeCode(input: string): string | null {
  let s = input.trim().toUpperCase().replace(/[\s\-‐-―_]/g, '')
  if (s.startsWith(CODE_PREFIX)) s = s.slice(CODE_PREFIX.length)
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (!CROCKFORD.test(s)) return null
  return `${CODE_PREFIX}-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

// ---- passes ------------------------------------------------------------------------------

export function base64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Reads a pass without checking its signature (never trust the result on its own). */
export function decodeToken(token: string): { payload: TokenPayload; payloadBytes: Uint8Array<ArrayBuffer>; signature: Uint8Array<ArrayBuffer> } | { error: 'malformed' | 'version' } {
  const parts = token.split('.')
  if (parts.length !== 2 || token.length > 2048) return { error: 'malformed' }
  const payloadBytes = base64urlDecode(parts[0])
  const signature = base64urlDecode(parts[1])
  if (!payloadBytes || !signature || signature.length !== 64) return { error: 'malformed' }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(payloadBytes))
  } catch {
    return { error: 'malformed' }
  }
  const p = raw as Partial<TokenPayload> | null
  if (!p || typeof p !== 'object') return { error: 'malformed' }
  if (p.v !== 1) return { error: 'version' }
  if ((p.kind !== 'trial' && p.kind !== 'supporter') || !Number.isFinite(p.iat) || !Number.isFinite(p.exp)) return { error: 'malformed' }
  return { payload: { v: 1, kind: p.kind, iat: p.iat as number, exp: p.exp as number }, payloadBytes, signature }
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'version' | 'signature' | 'unsupported' | 'expired'; payload?: TokenPayload }

let edSupport: Promise<boolean> | null = null

/** Whether this browser's WebCrypto can check Ed25519 signatures (Chrome 137+, Firefox 129+, Safari 17+). */
export function ed25519Supported(): Promise<boolean> {
  edSupport ??= (async () => {
    try {
      if (!globalThis.crypto?.subtle) return false
      // a well-formed public key (the curve's base point); importing it proves the algorithm exists
      const probe = base64urlDecode('WGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY')!
      await crypto.subtle.importKey('raw', probe, { name: 'Ed25519' }, false, ['verify'])
      return true
    } catch {
      return false
    }
  })()
  return edSupport
}

/**
 * Checks a pass: format, version, Ed25519 signature over the payload bytes, and expiry. `now` is unix seconds.
 * Never throws. Uses WebCrypto's Ed25519 where the browser has it (Chrome 137+); older browsers fall back to
 * @noble/ed25519 (audited, loaded only then), because the perks include NO ADS and the school Chromebooks this is
 * for are stuck on Chrome 126: a paying student must not keep seeing adverts. `unsupported` is left for a browser
 * where even that fails (no WebCrypto SHA-512, i.e. not a secure context).
 */
export async function verifyToken(token: string, publicKey: Uint8Array<ArrayBuffer>, now = Date.now() / 1000): Promise<VerifyResult> {
  const d = decodeToken(token)
  if ('error' in d) return { ok: false, reason: d.error }
  if (publicKey.length !== 32) return { ok: false, reason: 'signature', payload: d.payload }
  let valid: boolean
  try {
    if (await ed25519Supported()) {
      const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify'])
      valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, d.signature, d.payloadBytes)
    } else {
      const ed = await import('@noble/ed25519')
      valid = await ed.verifyAsync(d.signature, d.payloadBytes, publicKey)
    }
  } catch {
    return { ok: false, reason: (await ed25519Supported()) ? 'signature' : 'unsupported', payload: d.payload }
  }
  if (!valid) return { ok: false, reason: 'signature', payload: d.payload }
  if (d.payload.exp <= now) return { ok: false, reason: 'expired', payload: d.payload }
  return { ok: true, payload: d.payload }
}

/** Whole days left (rounded up, so "1 day" until the very end), 0 once over. */
export function daysLeft(exp: number, now = Date.now() / 1000): number {
  return Math.max(0, Math.ceil((exp - now) / 86400))
}

/** What the device has, given a record and the outcome of checking its pass. */
export function statusOf(record: SupporterRecord | null, result: VerifyResult | null): SupporterStatus {
  if (!record) return 'none'
  if (!record.token || !result) return 'expired'
  return result.ok ? result.payload.kind : 'expired'
}

/** Refresh when the pass is missing, invalid, over, or has under a week left. An ended code (no token) is left alone. */
export const REFRESH_WITHIN_DAYS = 7
export function needsRefresh(record: SupporterRecord | null, result: VerifyResult | null, now = Date.now() / 1000): boolean {
  if (!record?.token) return false
  if (!result) return true
  if (!result.ok) return result.reason !== 'unsupported'
  return result.payload.exp - now < REFRESH_WITHIN_DAYS * 86400
}

/** Validates a record read back from storage (never trusted). */
export function sanitizeRecord(raw: unknown): SupporterRecord | null {
  const r = raw as Partial<SupporterRecord> | null
  if (!r || typeof r !== 'object' || typeof r.code !== 'string') return null
  const code = normalizeCode(r.code)
  if (!code) return null
  const token = typeof r.token === 'string' && r.token.length <= 2048 ? r.token : null
  return { code, token }
}

/** Build-time links; optional, the matching button is hidden when set empty. The Discord invite is the one link shasta://discord opens: change it here (or VITE_DISCORD_INVITE). */
const httpUrl = (v: unknown) => (typeof v === 'string' && /^https:\/\/\S+$/i.test(v.trim()) ? v.trim() : '')
export const DISCORD_INVITE = httpUrl(import.meta.env.VITE_DISCORD_INVITE ?? 'https://discord.gg/ye4A2skv6H')
export const SUPPORT_URL = httpUrl(import.meta.env.VITE_SUPPORT_URL ?? 'https://ko-fi.com/dazadaza')
/** Where the monthly membership is bought (Ko-fi tiers page); falls back to the tip jar link. Empty = no button. */
export const MEMBERSHIP_URL = httpUrl(import.meta.env.VITE_SUPPORT_TIERS_URL) || SUPPORT_URL
/** Optional pinned public key (base64url); when set the device never asks the server for one. */
export const PINNED_PUBLIC_KEY = typeof import.meta.env.VITE_SUPPORTER_PUBLIC_KEY === 'string' ? import.meta.env.VITE_SUPPORTER_PUBLIC_KEY.trim() : ''

// ---- leftovers of the old payment detection --------------------------------------------------

/** Keys an earlier build wrote while it waited for a payment. Nothing reads them any more; stale values are deleted. */
export const LEGACY_KEYS = ['shasta-support-pending', 'shasta-support-ref'] as const

export function purgeLegacyPaymentKeys(): void {
  for (const k of LEGACY_KEYS) {
    try {
      sessionStorage.removeItem(k)
    } catch {
      /* storage blocked */
    }
    try {
      localStorage.removeItem(k)
    } catch {
      /* storage blocked */
    }
  }
}
