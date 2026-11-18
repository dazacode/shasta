// The two linking state machines (social/linkFlow.ts) against a fake relay and fake Better Auth device routes:
// the tables, a whole link from QR to session token, and the ways it can end early.
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // social/origin.ts -> lib/appApi.ts reads `location` at import
  ;(globalThis as { location?: unknown }).location ??= new URL('https://edushasta.lol/me')
})

import { joinLink, SCAN_MOVES, SHOW_MOVES, startShow, type LinkDeps, type ScanState, type ShowState } from '@/social/linkFlow'
import { IllegalMove, machine } from '@/social/machine'
import { parseInvite } from '@/social/link'
import type { SessionBundle } from '@/social/types'

// ---- a fake relay: /api/social/ws?link=<room>&role=show|scan -------------------------------------------------------

class Relay {
  show: FakeWS | null = null
  scan: FakeWS | null = null
  confirmed = false
  approved = false
  route(from: FakeWS, raw: string) {
    const f = JSON.parse(raw)
    if (f.t === 'confirm' && from === this.show) this.confirmed = true
    if (f.t === 'msg') (from === this.show ? this.scan : this.show)?.deliver({ t: 'msg', d: f.d })
  }
}
const relays = new Map<string, Relay>()

class FakeWS {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  relay: Relay
  role: 'show' | 'scan'
  constructor(url: string) {
    const u = new URL(url)
    const room = u.searchParams.get('link')!
    this.role = u.searchParams.get('role') as 'show' | 'scan'
    if (!relays.has(room)) relays.set(room, new Relay())
    this.relay = relays.get(room)!
    if (this.role === 'scan' && this.relay.scan) {
      setTimeout(() => this.close(4409))
      return
    }
    this.relay[this.role] = this
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
      const other = this.role === 'show' ? this.relay.scan : this.relay.show
      if (other) {
        other.deliver({ t: 'peer' })
        this.deliver({ t: 'peer' })
      }
    })
  }
  deliver(frame: unknown) {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(frame) }))
  }
  send(data: string) {
    this.relay.route(this, data)
  }
  close(code = 1000) {
    if (this.readyState === 3) return
    this.readyState = 3
    setTimeout(() => this.onclose?.({ code }))
  }
}

// ---- fake Better Auth device-authorization routes ------------------------------------------------------------------

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeAuth(room = 'ABCDEFGH') {
  const calls: string[] = []
  const renamed: string[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/api/social/auth', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const r = relays.get(room)
    if (path === '/device/code') return json(200, { device_code: 'dc-1', user_code: room, interval: 1, expires_in: 90 })
    // the server answers 404 to GET /device (its approve hook claims the code)
    if (path === '/device') return json(404, {})
    if (url.pathname === '/api/social/me') return json(200, { device: { id: 'dev-1' } })
    if (url.pathname === '/api/social/devices/dev-1' && init?.method === 'PATCH') {
      renamed.push(JSON.parse(String(init.body)).name)
      return json(200, {})
    }
    if (path === '/device/approve') {
      if (!r?.confirmed) return json(409, { error: { code: 'not_confirmed', message: 'not yet' } })
      r.approved = true
      return json(200, { success: true })
    }
    if (path === '/device/token') {
      if (!r?.approved) return json(400, { error: 'authorization_pending', error_description: 'wait' })
      r.scan?.deliver({ t: 'done' })
      return json(200, { access_token: 'desktop-token', token_type: 'Bearer' })
    }
    return json(404, {})
  }) as typeof fetch
  return { fetch, calls, renamed }
}

const BUNDLE: SessionBundle = {
  v: 1,
  library: { apps: [{ appId: 'app_1', version: '1.0.0', pinned: true, folderId: null }], favorites: ['app_1'], folders: [], following: [] },
  settings: { theme: 'dark' },
  playing: { appId: 'app_1' },
}

function deps(fetch: typeof globalThis.fetch, extra: Partial<LinkDeps> = {}): Partial<LinkDeps> {
  return {
    fetch,
    WebSocket: FakeWS as unknown as LinkDeps['WebSocket'],
    now: Date.now,
    sleep: () => new Promise((r) => setTimeout(r, 2)),
    socialOrigin: () => 'https://edushasta.lol',
    apiBase: () => 'https://edushasta.lol',
    token: async () => 'phone-token',
    saveToken: async () => {},
    buildBundle: async () => BUNDLE,
    ...extra,
  }
}

async function until(fn: () => boolean, ms = 3000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 2))
  }
}
const last = <T>(a: T[]) => a[a.length - 1]

describe('link flow tables', () => {
  it('every state is in the table and the final ones have no moves', () => {
    expect(Object.keys(SHOW_MOVES).sort()).toEqual(['approved', 'error', 'expired', 'peer', 'starting', 'waiting'])
    expect(Object.keys(SCAN_MOVES).sort()).toEqual(['approving', 'confirm', 'connecting', 'done', 'error', 'expired'])
    for (const k of ['approved', 'expired', 'error'] as const) expect(SHOW_MOVES[k]).toEqual([])
    for (const k of ['done', 'expired', 'error'] as const) expect(SCAN_MOVES[k]).toEqual([])
  })

  it('illegal moves throw', () => {
    const scan = machine<ScanState>(SCAN_MOVES, { s: 'connecting', code: '123' }, () => {})
    expect(() => scan.go({ s: 'done', bundle: null, deviceName: 'x' })).toThrow(IllegalMove)
    expect(() => scan.go({ s: 'approving', code: '1', deviceName: 'x', waitingForOther: false })).toThrow(IllegalMove)
    scan.go({ s: 'expired' })
    expect(scan.final).toBe(true)
    expect(() => scan.go({ s: 'error', msg: 'x' })).toThrow(IllegalMove)
    const show = machine<ShowState>(SHOW_MOVES, { s: 'starting' }, () => {})
    expect(() => show.go({ s: 'approved' })).toThrow(IllegalMove)
    expect(() => show.go({ s: 'peer', code: '1', handle: null, avatar: null, confirmed: false, expiresAt: 0 })).toThrow(IllegalMove)
  })
})

describe('linking end to end (fake relay)', () => {
  it('QR -> same code on both screens -> both say yes -> token + bundle', async () => {
    relays.clear()
    const auth = fakeAuth()
    const saved: string[] = []
    const showStates: ShowState[] = []
    const show = startShow({ kind: 'desktop', name: 'Room 12 Chromebook', playing: 'app_1' }, (s) => showStates.push(s), deps(auth.fetch, { saveToken: async (t) => void saved.push(t) }))
    await until(() => last(showStates)?.s === 'waiting')
    const waiting = last(showStates) as Extract<ShowState, { s: 'waiting' }>
    expect(waiting.url.startsWith('https://edushasta.lol/me#l=ABCDEFGH.')).toBe(true)

    const invite = parseInvite(new URL(waiting.url).hash)!
    const scanStates: ScanState[] = []
    const scan = joinLink(invite, (s) => scanStates.push(s), { me: { handle: 'sam', avatar: { preset: 'lorelei:abc', bg: '#f6d6ad' } } }, deps(auth.fetch))
    await until(() => last(scanStates)?.s === 'confirm' && last(showStates).s === 'peer')

    const confirm = last(scanStates) as Extract<ScanState, { s: 'confirm' }>
    const peer = last(showStates) as Extract<ShowState, { s: 'peer' }>
    expect(confirm.deviceName).toBe('Room 12 Chromebook')
    expect(confirm.code).toMatch(/^\d{3}$/)
    expect(peer.code).toBe(confirm.code)
    expect(peer.handle).toBe('sam')
    expect(peer.avatar).toEqual({ preset: 'lorelei:abc', bg: '#f6d6ad' })
    expect(await scan.code).toBe(confirm.code)

    // the phone says yes first: the server waits for the computer's "Yes, that's my phone"
    void scan.approve()
    await until(() => {
      const s = last(scanStates)
      return s.s === 'approving' && s.waitingForOther
    })
    await show.confirm()
    await until(() => last(showStates).s === 'approved' && last(scanStates).s === 'done')

    const done = last(scanStates) as Extract<ScanState, { s: 'done' }>
    expect(done.bundle?.playing).toEqual({ appId: 'app_1' })
    expect(done.bundle?.library).toEqual(BUNDLE.library)
    expect(saved).toEqual(['desktop-token'])
    expect(auth.calls).not.toContain('GET /device')
    // the new device renamed itself to the name the phone saw
    expect(auth.renamed).toEqual(['Room 12 Chromebook'])
  })

  it('a second scanner is turned away', async () => {
    relays.clear()
    const auth = fakeAuth('ZZZZZZZZ')
    const showStates: ShowState[] = []
    startShow({ kind: 'desktop', name: 'PC' }, (s) => showStates.push(s), deps(auth.fetch))
    await until(() => last(showStates)?.s === 'waiting')
    const invite = parseInvite(new URL((last(showStates) as Extract<ShowState, { s: 'waiting' }>).url).hash)!
    const a: ScanState[] = []
    const b: ScanState[] = []
    joinLink(invite, (s) => a.push(s), {}, deps(auth.fetch))
    await until(() => last(a)?.s === 'confirm')
    joinLink(invite, (s) => b.push(s), {}, deps(auth.fetch))
    await until(() => last(b)?.s === 'error')
    expect((last(b) as Extract<ScanState, { s: 'error' }>).msg).toMatch(/already scanned/)
  })

  it('the relay saying expired ends both sides; approve without a token fails cleanly', async () => {
    relays.clear()
    const auth = fakeAuth('EXPIRED1')
    const showStates: ShowState[] = []
    startShow({ kind: 'desktop', name: 'PC' }, (s) => showStates.push(s), deps(auth.fetch))
    await until(() => last(showStates)?.s === 'waiting')
    const invite = parseInvite(new URL((last(showStates) as Extract<ShowState, { s: 'waiting' }>).url).hash)!
    const scanStates: ScanState[] = []
    const scan = joinLink(invite, (s) => scanStates.push(s), {}, deps(auth.fetch, { token: async () => null }))
    await until(() => last(scanStates)?.s === 'confirm')
    await scan.approve()
    expect(last(scanStates)).toEqual({ s: 'error', msg: 'Make your account first, then link.' })
    await expect(scan.approve()).rejects.toThrow()

    const r = relays.get('EXPIRED1')!
    r.show!.deliver({ t: 'expired' })
    await until(() => last(showStates).s === 'expired')
  })
})
