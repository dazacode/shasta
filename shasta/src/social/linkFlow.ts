// Linking, as two small state machines (docs/social-protocol.md "Linking: the QR handshake"). The SHOW side (usually
// the Chromebook) gets a device code from Better Auth, shows `<social origin>/me#l=<code>.<key>.<secret>` as a QR and
// waits; the SCAN side (the phone, which holds the account) joins the relay room, both show the same 3-digit code, and
// each person says yes on their own screen. The relay only ever forwards sealed boxes (link.ts, HPKE): the server
// never sees the bundle or the names. Every state move goes through SHOW_MOVES / SCAN_MOVES (machine.ts).
import type { Avatar, DeviceKind, SessionBundle } from './types'
import { ScanSide, ShowSide, type Channel, type LinkInvite, type ScanHello, type ShowReply } from './link'
import { machine, type Machine } from './machine'
import { validAvatar } from './avatars'
import { HANDLE_RE } from './schemas'
import { buildBundle, validateBundle } from './bundle'
import { loadToken, saveToken } from './auth'
import { apiBase, socialOrigin } from './origin'

// ---- states + tables ---------------------------------------------------------------------------------------------

export type ShowState =
  | { s: 'starting' }
  | { s: 'waiting'; url: string; expiresAt: number }
  /** a phone joined; `confirmed` once the person here said "Yes, that's my phone" */
  | { s: 'peer'; code: string; handle: string | null; avatar: Avatar | null; confirmed: boolean; expiresAt: number }
  | { s: 'approved' }
  | { s: 'expired' }
  | { s: 'error'; msg: string }

export const SHOW_MOVES = {
  starting: ['waiting', 'error'],
  waiting: ['peer', 'expired', 'error'],
  // peer -> peer: the person confirmed
  peer: ['peer', 'approved', 'expired', 'error'],
  approved: [],
  expired: [],
  error: [],
} as const satisfies Record<ShowState['s'], readonly ShowState['s'][]>

export type ScanState =
  | { s: 'connecting'; code: string }
  | { s: 'confirm'; code: string; deviceName: string }
  /** approval sent; `waitingForOther` while the other screen hasn't said yes yet */
  | { s: 'approving'; code: string; deviceName: string; waitingForOther: boolean }
  | { s: 'done'; bundle: SessionBundle | null; deviceName: string }
  | { s: 'expired' }
  | { s: 'error'; msg: string }

export const SCAN_MOVES = {
  connecting: ['confirm', 'expired', 'error'],
  confirm: ['approving', 'expired', 'error'],
  // approving -> approving: still waiting for the other screen
  approving: ['approving', 'done', 'expired', 'error'],
  done: [],
  expired: [],
  error: [],
} as const satisfies Record<ScanState['s'], readonly ScanState['s'][]>

// ---- what the flows need from the world (tests swap these) -------------------------------------------------------

export interface LinkDeps {
  fetch: typeof fetch
  WebSocket: { new (url: string): WebSocket }
  now(): number
  sleep(ms: number): Promise<void>
  /** where `/me` lives, for the QR */
  socialOrigin(): string
  /** http(s) base of the API */
  apiBase(): string
  token(): Promise<string | null>
  saveToken(t: string): Promise<void>
  buildBundle(playing: string | null): Promise<SessionBundle>
}

function defaultDeps(): LinkDeps {
  return {
    fetch: (...a) => fetch(...a),
    WebSocket,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    socialOrigin,
    apiBase,
    token: loadToken,
    saveToken,
    buildBundle,
  }
}

const wsUrl = (base: string, room: string, role: 'show' | 'scan') => {
  const u = new URL(`/api/social/ws?link=${encodeURIComponent(room)}&role=${role}`, base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

/** Better Auth answers device errors as { error, error_description }; our hooks as { error: { code } } or { code }. */
async function errorCode(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: unknown; code?: unknown }
    if (typeof j.error === 'string') return j.error
    if (j.error && typeof j.error === 'object' && typeof (j.error as { code?: unknown }).code === 'string') return (j.error as { code: string }).code
    if (typeof j.code === 'string') return j.code.toLowerCase()
  } catch {
    /* not JSON */
  }
  return `http_${res.status}`
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isBox = (d: unknown): d is { ct: string } => isObj(d) && typeof d.ct === 'string'
const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, '').trim().slice(0, 40) : '') || 'A computer'

// ---- the show side -----------------------------------------------------------------------------------------------

export interface ShowOptions {
  kind: DeviceKind
  /** this device's name, shown on the phone ("a Chromebook named ...") */
  name: string
  /** the Store app in front (tab.app), carried in the bundle */
  playing?: string | null
}

export interface ShowHandle {
  /** "Yes, that's my phone": sends confirm and the bundle, then waits for the phone's approval */
  confirm(): Promise<void>
  cancel(): void
}

export function startShow(opts: ShowOptions, onState: (s: ShowState) => void, given?: Partial<LinkDeps>): ShowHandle {
  const m = machine<ShowState>(SHOW_MOVES, { s: 'starting' }, onState)
  onState(m.state)
  let deps!: LinkDeps
  let ws: WebSocket | null = null
  let show: ShowSide | null = null
  let channel: Channel | null = null
  let deviceCode = ''
  let interval = 5
  let expiresAt = 0
  let cancelled = false
  let expiry: ReturnType<typeof setTimeout> | undefined

  const go = (next: ShowState) => {
    if (cancelled || m.final || !m.can(next.s)) return
    m.go(next)
    if (m.final) stop()
  }
  const fail = (msg: string) => go({ s: 'error', msg })
  const stop = () => {
    clearTimeout(expiry)
    const sock = ws
    ws = null
    sock?.close(1000)
  }
  const send = (frame: unknown) => ws?.readyState === 1 && ws.send(JSON.stringify(frame))

  const onMessage = async (raw: unknown) => {
    let f: Record<string, unknown>
    try {
      f = JSON.parse(String(raw))
    } catch {
      return
    }
    if (f.t === 'expired') return go({ s: 'expired' })
    if (f.t !== 'msg') return
    const d = f.d
    try {
      if (!channel) {
        // the scanner's plaintext hello: { enc, pub }
        if (!isObj(d) || typeof d.enc !== 'string' || typeof d.pub !== 'string' || !show) return
        const r = await show.accept(d as unknown as ScanHello)
        channel = r.channel
        send({ t: 'msg', d: r.reply })
        send({ t: 'msg', d: await channel.seal({ type: 'hello', name: opts.name }) })
        return
      }
      if (!isBox(d)) return
      const msg = await channel.open<Record<string, unknown>>(d)
      if (msg?.type === 'hello' && m.state.s === 'waiting') {
        const handle = typeof msg.handle === 'string' && HANDLE_RE.test(msg.handle) ? msg.handle : null
        const avatar = validAvatar(msg.avatar) ? msg.avatar : null
        go({ s: 'peer', code: channel.code, handle, avatar, confirmed: false, expiresAt })
      }
    } catch {
      // a box that doesn't open: someone without the QR's secret, or a broken relay
      fail("Couldn't check that phone. Show a new code and try again.")
    }
  }

  const poll = async () => {
    while (!cancelled && m.state.s === 'peer') {
      await deps.sleep(interval * 1000)
      if (cancelled || m.state.s !== 'peer') return
      let res: Response
      try {
        res = await deps.fetch(`${deps.apiBase()}/api/social/auth/device/token`, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: clientId }),
        })
      } catch {
        continue // a network blip: try again on the next tick
      }
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as { access_token?: unknown }
        if (typeof j.access_token !== 'string' || !j.access_token) return fail('The server sent something unexpected. Try again.')
        await deps.saveToken(j.access_token)
        // a device linked by QR starts with a generic name (the relay never sees the sealed one): it renames itself
        await renameSelf(j.access_token).catch(() => {})
        return go({ s: 'approved' })
      }
      const code = await errorCode(res)
      if (code === 'authorization_pending') continue
      if (code === 'slow_down') interval += 5
      else if (code === 'expired_token') return go({ s: 'expired' })
      else if (code === 'access_denied') return fail('The phone said no, so nothing was linked.')
      else return fail("Couldn't finish linking. Try again.")
    }
  }

  const clientId = opts.kind === 'desktop' ? 'shasta-desktop' : 'shasta-phone'

  const renameSelf = async (token: string) => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const me = await deps.fetch(`${deps.apiBase()}/api/social/me`, { credentials: 'omit', headers })
    const id = me.ok ? ((await me.json()) as { device?: { id?: unknown } }).device?.id : null
    if (typeof id === 'string') await deps.fetch(`${deps.apiBase()}/api/social/devices/${encodeURIComponent(id)}`, { method: 'PATCH', credentials: 'omit', headers, body: JSON.stringify({ name: opts.name.slice(0, 40) }) })
  }

  void (async () => {
    deps = { ...defaultDeps(), ...given }
    try {
      const res = await deps.fetch(`${deps.apiBase()}/api/social/auth/device/code`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      if (!res.ok) return fail((await errorCode(res)) === 'rate_limited' || res.status === 429 ? 'Too many codes for now. Wait a few minutes.' : "Couldn't get a code. Try again.")
      const j = (await res.json()) as { device_code?: unknown; user_code?: unknown; interval?: unknown; expires_in?: unknown }
      if (typeof j.device_code !== 'string' || typeof j.user_code !== 'string' || !/^[A-Za-z0-9]{8,32}$/.test(j.user_code)) return fail('The server sent a code this device can’t use.')
      deviceCode = j.device_code
      interval = typeof j.interval === 'number' && j.interval > 0 ? j.interval : 5
      expiresAt = deps.now() + (typeof j.expires_in === 'number' ? j.expires_in : 90) * 1000
      show = await ShowSide.create(j.user_code)
      if (cancelled) return
      const sock = new deps.WebSocket(wsUrl(deps.apiBase(), j.user_code, 'show'))
      ws = sock
      // one frame at a time: opening a box is async, and boxes must be opened in the order they were sealed
      let queue = Promise.resolve()
      sock.onmessage = (ev) => void (queue = queue.then(() => onMessage(ev.data)))
      sock.onclose = (ev) => {
        if (ws !== sock) return
        ws = null
        // once confirmed, the poll decides; before that a dropped relay ends this code
        const st = m.state
        if (ev.code === 4404) go({ s: 'expired' })
        else if (ev.code === 4429) fail('Too many codes for now. Wait a few minutes.')
        else if (st.s === 'waiting' || (st.s === 'peer' && !st.confirmed)) fail('Lost the connection. Show a new code and try again.')
      }
      expiry = setTimeout(() => m.state.s !== 'approved' && go({ s: 'expired' }), Math.max(0, expiresAt - deps.now()))
      go({ s: 'waiting', url: show.url(deps.socialOrigin()), expiresAt })
    } catch {
      fail("Can't reach Shasta right now. Check your connection and try again.")
    }
  })()

  return {
    async confirm() {
      const st = m.state
      if (st.s !== 'peer' || st.confirmed || !channel) throw new Error('nothing to confirm')
      send({ t: 'confirm' })
      const bundle = await deps.buildBundle(opts.playing ?? null).catch(() => null)
      if (bundle) send({ t: 'msg', d: await channel.seal({ type: 'bundle', bundle }) })
      go({ ...st, confirmed: true })
      void poll()
    },
    cancel() {
      cancelled = true
      stop()
    },
  }
}

// ---- the scan side -----------------------------------------------------------------------------------------------

export interface ScanOptions {
  /** the account on this phone, if there is one: shown on the other screen ("@sam's phone") */
  me?: { handle: string; avatar: Avatar } | null
}

export interface ScanHandle {
  /** the 3-digit code, known at once */
  readonly code: Promise<string>
  /** "Yes, link it": needs a signed-in owner device */
  approve(): Promise<void>
  /** "No": refuses the code if this phone is signed in, then lets go */
  cancel(): void
}

export function joinLink(invite: LinkInvite, onState: (s: ScanState) => void, opts: ScanOptions = {}, given?: Partial<LinkDeps>): ScanHandle {
  let resolveCode: (c: string) => void = () => {}
  const codePromise = new Promise<string>((r) => (resolveCode = r))
  let m: Machine<ScanState> | null = null
  let deps!: LinkDeps
  let ws: WebSocket | null = null
  let scan: ScanSide | null = null
  let channel: Channel | null = null
  let bundle: SessionBundle | null = null
  let deviceName = ''
  let cancelled = false
  let doneTimer: ReturnType<typeof setTimeout> | undefined
  const pending: ScanState[] = []

  const go = (next: ScanState) => {
    if (cancelled) return
    if (!m) return void pending.push(next)
    if (m.final || !m.can(next.s)) return
    m.go(next)
    if (m.final) stop()
  }
  const fail = (msg: string) => go({ s: 'error', msg })
  const stop = () => {
    clearTimeout(doneTimer)
    const sock = ws
    ws = null
    sock?.close(1000)
  }
  const send = (frame: unknown) => ws?.readyState === 1 && ws.send(JSON.stringify(frame))
  const authFetch = async (path: string, init: RequestInit = {}) => {
    const token = await deps.token()
    return deps.fetch(`${deps.apiBase()}/api/social/auth${path}`, {
      ...init,
      credentials: 'omit',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })
  }
  const finish = () => {
    if (m?.state.s === 'approving') go({ s: 'done', bundle, deviceName })
  }

  const onMessage = async (raw: unknown) => {
    let f: Record<string, unknown>
    try {
      f = JSON.parse(String(raw))
    } catch {
      return
    }
    if (f.t === 'expired') return go({ s: 'expired' })
    if (f.t === 'done') return finish()
    if (f.t !== 'msg' || !scan) return
    const d = f.d
    try {
      if (!channel) {
        if (!isObj(d) || typeof d.enc !== 'string') return
        channel = await scan.accept(d as unknown as ShowReply)
        send({ t: 'msg', d: await channel.seal({ type: 'hello', handle: opts.me?.handle ?? null, avatar: opts.me?.avatar ?? null }) })
        return
      }
      if (!isBox(d)) return
      const msg = await channel.open<Record<string, unknown>>(d)
      if (msg?.type === 'hello' && m?.state.s === 'connecting') {
        deviceName = cleanName(msg.name)
        go({ s: 'confirm', code: scan.code, deviceName })
      } else if (msg?.type === 'bundle') {
        bundle = validateBundle(msg.bundle)
      }
    } catch {
      fail("Couldn't check that code. Scan it again.")
    }
  }

  void (async () => {
    deps = { ...defaultDeps(), ...given }
    try {
      scan = await ScanSide.create(invite)
    } catch {
      m = machine<ScanState>(SCAN_MOVES, { s: 'connecting', code: '' }, onState)
      return fail("That code doesn't work. Scan it again.")
    }
    resolveCode(scan.code)
    m = machine<ScanState>(SCAN_MOVES, { s: 'connecting', code: scan.code }, onState)
    onState(m.state)
    pending.splice(0).forEach(go)
    if (cancelled) return
    try {
      const sock = new deps.WebSocket(wsUrl(deps.apiBase(), invite.room, 'scan'))
      ws = sock
      sock.onopen = () => sock.send(JSON.stringify({ t: 'msg', d: scan!.hello }))
      // one frame at a time: opening a box is async, and boxes must be opened in the order they were sealed
      let queue = Promise.resolve()
      sock.onmessage = (ev) => void (queue = queue.then(() => onMessage(ev.data)))
      sock.onclose = (ev) => {
        if (ws !== sock) return
        ws = null
        const st = m?.state.s
        if (ev.code === 4409) fail('Someone else already scanned this code. Show a new one on the computer.')
        else if (ev.code === 4404) go({ s: 'expired' })
        else if (ev.code === 4429) fail('Too many tries for now. Wait a few minutes.')
        else if (st === 'approving') finish()
        else if (st === 'connecting' || st === 'confirm') fail('Lost the connection. Scan the code again.')
      }
    } catch {
      fail("Can't reach Shasta right now. Check your connection and try again.")
    }
  })()

  return {
    code: codePromise,
    async approve() {
      const st = m?.state
      if (!m || st?.s !== 'confirm') throw new Error('nothing to approve')
      if (!(await deps.token())) return fail('Make your account first, then link.')
      go({ s: 'approving', code: st.code, deviceName: st.deviceName, waitingForOther: false })
      const userCode = invite.room
      try {
        // the server's approve hook claims the code for this device (no GET /device first: it answers 404)
        while (!cancelled && m.state.s === 'approving') {
          const res = await authFetch('/device/approve', { method: 'POST', body: JSON.stringify({ userCode }) })
          if (res.ok) {
            // the relay says done once the computer picked up its session; don't hang if that frame is lost
            doneTimer = setTimeout(finish, 15_000)
            return
          }
          const code = await errorCode(res)
          if (code === 'not_confirmed' || res.status === 409) {
            if (m.state.s === 'approving' && !m.state.waitingForOther) go({ ...m.state, waitingForOther: true })
            await deps.sleep(1000)
            continue
          }
          if (code === 'expired_token') return go({ s: 'expired' })
          if (code === 'limited') return fail('This phone was linked less than 3 days ago, so it can’t add devices yet. Use your first phone.')
          if (code === 'access_denied' || res.status === 403) return fail('Only the phone that owns the account can link a computer.')
          return fail("Couldn't link it. Try again.")
        }
      } catch {
        fail("Can't reach Shasta right now. Check your connection and try again.")
      }
    },
    cancel() {
      const st = m?.state.s
      cancelled = true
      // a clear "no" ends the code for the computer too, when this phone may say so
      if (st === 'confirm' && deps)
        void deps
          .token()
          .then((t) => (t ? authFetch('/device/deny', { method: 'POST', body: JSON.stringify({ userCode: invite.room }) }) : null))
          .catch(() => {})
      stop()
    },
  }
}
