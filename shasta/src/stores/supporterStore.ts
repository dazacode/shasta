// Supporter state for this device. The code and its signed pass live in settings (`settings.supporter`); this store
// checks the pass against the server's public key and keeps it fresh. useSupporter() is the ONE gate for perks.
import { create } from 'zustand'
import { useSettings, getSettings } from '@/stores/settingsStore'
import {
  PINNED_PUBLIC_KEY,
  base64urlDecode,
  daysLeft as daysLeftOf,
  needsRefresh,
  normalizeCode,
  purgeLegacyPaymentKeys,
  statusOf,
  verifyToken,
  type SupporterKind,
  type SupporterRecord,
  type SupporterStatus,
  type VerifyResult,
} from '@/lib/supporter'

/** Why perks are off although there is a code: the server ended it, the pass failed its check, or the browser can't check it. */
export type SupporterNote = 'ended' | 'invalid' | 'unsupported' | null

interface SupporterState {
  status: SupporterStatus
  /** unix seconds the pass runs out (0 when none) */
  exp: number
  /** whole days the pass has left, as of the last check */
  daysLeft: number
  note: SupporterNote
  /** a redeem or refresh is in flight */
  busy: boolean
  /** start once at boot: check the saved pass, refresh it when due, and re-check now and then */
  boot: () => void
  /** re-read settings and check the pass; resolves with the new status */
  evaluate: () => Promise<SupporterStatus>
  /** exchange a code for a pass. Resolves to an error message to show, or null on success. */
  redeem: (input: string) => Promise<string | null>
  /** ask the server for a fresh pass for the saved code. `force` also re-checks an ended code. */
  refresh: (opts?: { force?: boolean }) => Promise<void>
  /** forget the code and pass on this device */
  remove: () => void
}

const KEY_CACHE = 'shasta-supporter-key'
let keyBytes: Uint8Array<ArrayBuffer> | null = null

/** The server's public key: pinned at build time, else cached on the device, else fetched (and cached). */
async function publicKey(fresh = false): Promise<Uint8Array<ArrayBuffer> | null> {
  if (PINNED_PUBLIC_KEY) return base64urlDecode(PINNED_PUBLIC_KEY)
  if (keyBytes && !fresh) return keyBytes
  if (!fresh) {
    try {
      const cached = localStorage.getItem(KEY_CACHE)
      const bytes = cached ? base64urlDecode(cached) : null
      if (bytes?.length === 32) return (keyBytes = bytes)
    } catch {
      /* storage blocked */
    }
  }
  try {
    const res = await fetch('/api/supporter/public-key', { credentials: 'omit' })
    if (!res.ok) return keyBytes
    const body = (await res.json()) as { key?: unknown }
    const bytes = typeof body.key === 'string' ? base64urlDecode(body.key) : null
    if (bytes?.length !== 32) return keyBytes
    keyBytes = bytes
    try {
      localStorage.setItem(KEY_CACHE, body.key as string)
    } catch {
      /* fine: it is fetched again next time */
    }
    return bytes
  } catch {
    return keyBytes
  }
}

/** Checks a pass; on a bad signature the key is fetched again once, in case the server rotated it. */
async function check(token: string): Promise<VerifyResult | null> {
  const key = await publicKey()
  if (!key) return null
  const r = await verifyToken(token, key)
  if (!r.ok && r.reason === 'signature' && !PINNED_PUBLIC_KEY) {
    const again = await publicKey(true)
    if (again && again !== key) return verifyToken(token, again)
  }
  return r
}

type Issued = { token: string; kind: SupporterKind; exp: number }
type Call = { ok: true; data: Issued } | { ok: false; status: number }

async function call(path: 'redeem' | 'refresh', code: string): Promise<Call> {
  try {
    const res = await fetch(`/api/supporter/${path}`, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
    if (!res.ok) return { ok: false, status: res.status }
    const data = (await res.json()) as Partial<Issued>
    if (typeof data.token !== 'string') return { ok: false, status: 502 }
    return { ok: true, data: data as Issued }
  } catch {
    return { ok: false, status: 0 }
  }
}

export function redeemError(status: number): string {
  if (status === 0) return "Can't reach Shasta's server right now. Check your connection and try again."
  if (status === 400) return "That doesn't look like a Shasta code. Codes look like SHASTA-XXXX-XXXX-XXXX."
  if (status === 404) return "That code isn't known. Check it for typos, or ask for a new one in the Discord (/supporter)."
  if (status === 410) return 'That code has ended (it expired or was turned off). You can get a new one in the Discord with /supporter.'
  if (status === 429) return 'Too many tries for now. Wait a few minutes and try again.'
  return 'Something went wrong on the server. Try again in a moment.'
}

const setRecord = (supporter: SupporterRecord | null) => useSettings.getState().update({ supporter })
let booted = false
let expiryTimer: ReturnType<typeof setTimeout> | undefined

export const useSupporterStore = create<SupporterState>()((set, get) => ({
  status: 'none',
  exp: 0,
  daysLeft: 0,
  note: null,
  busy: false,

  evaluate: async () => {
    const record = getSettings().supporter
    const result = record?.token ? await check(record.token) : null
    // the record may have changed while the pass was being checked; the newer evaluation wins
    if (getSettings().supporter !== record) return get().status
    const status = statusOf(record, result)
    const note: SupporterNote = !record ? null : !record.token ? 'ended' : result && !result.ok && result.reason !== 'expired' ? (result.reason === 'unsupported' ? 'unsupported' : 'invalid') : null
    const exp = result?.payload?.exp ?? 0
    set({ status, exp, daysLeft: result?.ok ? daysLeftOf(exp) : 0, note })
    // a pass that runs out while the tab stays open ends its perks right then, not at the next check
    clearTimeout(expiryTimer)
    const ms = exp * 1000 - Date.now()
    if (result?.ok && ms < 2 ** 31 - 1) expiryTimer = setTimeout(() => void get().evaluate(), ms + 1000)
    return status
  },

  refresh: async ({ force = false } = {}) => {
    const record = getSettings().supporter
    if (!record || get().busy) return
    if (!force) {
      const result = record.token ? await check(record.token) : null
      if (!needsRefresh(record, result)) return
    }
    set({ busy: true })
    try {
      const r = await call('refresh', record.code)
      if (getSettings().supporter?.code !== record.code) return // removed or replaced meanwhile
      if (r.ok) setRecord({ code: record.code, token: r.data.token })
      // the server says the code is unknown or over: perks end, the code stays visible as "ended"
      else if (r.status === 404 || r.status === 410) setRecord({ code: record.code, token: null })
      // offline, rate limited, server trouble: keep the pass we have until it runs out
    } finally {
      set({ busy: false })
      await get().evaluate()
    }
  },

  redeem: async (input) => {
    const code = normalizeCode(input)
    if (!code) return redeemError(400)
    set({ busy: true })
    try {
      const r = await call('redeem', code)
      if (!r.ok) return redeemError(r.status)
      const result = await check(r.data.token)
      // a pass that fails its signature check is not kept; one this browser simply can't check is
      if (result && !result.ok && (result.reason === 'signature' || result.reason === 'malformed' || result.reason === 'version')) return 'The server sent a pass this device could not check. Try again later.'
      setRecord({ code, token: r.data.token })
      return null
    } finally {
      set({ busy: false })
      await get().evaluate()
    }
  },

  remove: () => {
    setRecord(null)
    if (getSettings().earlyPreviews) useSettings.getState().update({ earlyPreviews: false })
    set({ status: 'none', exp: 0, daysLeft: 0, note: null })
  },

  boot: () => {
    if (booted) return
    booted = true
    purgeLegacyPaymentKeys()
    // whenever the saved record changes (redeem, refresh, remove, another tab), check it again
    useSettings.subscribe((s, prev) => {
      if (s.settings.supporter !== prev.settings.supporter) void get().evaluate()
    })
    void get().evaluate().then(() => get().refresh())
    // a long-running tab: re-check twice a day (cheap; only calls the server when the pass is due)
    setInterval(() => void get().evaluate().then(() => get().refresh()), 12 * 3600_000)
  },
}))

export interface Supporter {
  status: SupporterStatus
  /** perks are on: an active trial or supporter pass */
  perks: boolean
  kind: SupporterKind | null
  daysLeft: number
  note: SupporterNote
  code: string | null
  busy: boolean
}

/** The single gate for supporter perks. Selects primitives only, so it never re-renders in a loop. */
export function useSupporter(): Supporter {
  const status = useSupporterStore((s) => s.status)
  const daysLeft = useSupporterStore((s) => s.daysLeft)
  const note = useSupporterStore((s) => s.note)
  const busy = useSupporterStore((s) => s.busy)
  const code = useSettings((s) => s.settings.supporter?.code ?? null)
  const perks = status === 'trial' || status === 'supporter'
  return { status, perks, kind: perks ? status : null, daysLeft: perks ? daysLeft : 0, note, code, busy }
}
