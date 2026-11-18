// The live social socket, /api/social/ws (docs/social-protocol.md "Live socket"). One per device. The token goes in
// the first frame, never the URL; `since` resumes from the last event this device saw, so a dropped connection or a
// sleeping phone catches up on what it missed instead of reloading everything. Reconnects with jittered backoff, and
// at once when the page comes back (visibilitychange, online, pageshow), which is what a phone does all day.
// Close 4401 = the token is no good: sign out. 4403 = suspended. Neither reconnects.
import type { ServerFrame } from './types'
import { loadToken, saveToken } from './auth'
import { kvGet, kvSet } from './kv'
import { socketUrl } from './origin'

export type ClientFrame = { t: 'presence'; appId: string | null } | { t: 'pong' } | { t: 'typing'; to: string }

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'signed-out' | 'suspended' | 'closed'

export interface SocketOptions {
  onFrame(frame: ServerFrame): void
  onState(state: SocketState): void
  // the rest is for tests
  WebSocket?: { new (url: string): WebSocket }
  token?: () => Promise<string | null>
  url?: string
  random?: () => number
  /** resume point; default: the one saved in kv (`seq`) */
  since?: number
  /** a socket with no frame at all for this long is dead (the server pings every 25 s) */
  idleMs?: number
}

export interface SocialSocket {
  send(frame: ClientFrame): void
  close(): void
  /** the last event sequence number seen */
  readonly seq: number
}

/** 1 s, 2 s, 4 s ... up to 30 s, each between half and all of it, so a server restart isn't hit by everyone at once. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
  return Math.round(ceiling * (0.5 + random() * 0.5))
}

/** Date.getTimezoneOffset(): minutes, UTC minus local (quiet hours follow the recipient's clock). */
export const tzOffset = () => new Date().getTimezoneOffset()

const isFrame = (v: unknown): v is ServerFrame => !!v && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string'

export function openSocialSocket(opts: SocketOptions): SocialSocket {
  const WS = opts.WebSocket ?? WebSocket
  const getToken = opts.token ?? loadToken
  const random = opts.random ?? Math.random
  const idleMs = opts.idleMs ?? 60_000
  let ws: WebSocket | null = null
  let seq = 0
  let seqLoaded = opts.since !== undefined
  if (seqLoaded) seq = opts.since!
  let attempt = 0
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const saveSeq = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void kvSet('seq', seq), 500)
  }
  const state = (s: SocketState) => !closed && opts.onState(s)
  const resetIdle = (sock: WebSocket) => {
    clearTimeout(idle)
    idle = setTimeout(() => ws === sock && sock.close(), idleMs)
  }

  const connect = async () => {
    if (closed || ws) return
    clearTimeout(retry)
    if (!seqLoaded) {
      seq = (await kvGet<number>('seq')) ?? 0
      seqLoaded = true
    }
    const token = await getToken()
    if (closed || ws) return
    if (!token) return state('signed-out')
    state(attempt ? 'reconnecting' : 'connecting')
    let sock: WebSocket
    try {
      sock = new WS(opts.url ?? socketUrl('/api/social/ws'))
    } catch {
      return schedule()
    }
    ws = sock
    sock.onopen = () => {
      sock.send(JSON.stringify({ t: 'hello', token, since: seq, tzOffset: tzOffset() }))
      resetIdle(sock)
    }
    sock.onmessage = (ev) => {
      if (ws !== sock) return
      resetIdle(sock)
      let frame: unknown
      try {
        frame = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (!isFrame(frame)) return
      if (frame.t === 'ping') {
        sock.send(JSON.stringify({ t: 'pong' }))
        return
      }
      if (frame.t === 'ready') {
        attempt = 0
        // a server whose counter is behind ours started over: take its number, or we would skip everything new
        if (typeof frame.seq === 'number' && frame.seq < seq) {
          seq = frame.seq
          saveSeq()
        }
        state('open')
      } else if (frame.t === 'ev' && typeof frame.seq === 'number' && frame.seq > seq) {
        seq = frame.seq
        saveSeq()
      }
      opts.onFrame(frame)
    }
    sock.onclose = (ev) => {
      if (ws !== sock) return
      ws = null
      clearTimeout(idle)
      if (closed) return
      if (ev.code === 4401) {
        void saveToken(null)
        return state('signed-out')
      }
      if (ev.code === 4403) return state('suspended')
      schedule()
    }
    sock.onerror = () => {
      /* onclose follows */
    }
  }

  const schedule = () => {
    if (closed) return
    state('reconnecting')
    clearTimeout(retry)
    retry = setTimeout(() => void connect(), backoffDelay(attempt++, random))
  }

  // the page came back (unlocked phone, switched back to the tab, back online): don't wait out the backoff
  const wake = () => {
    if (closed || ws) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    attempt = 0
    void connect()
  }
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
  if (hasWindow) {
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('pageshow', wake)
  }

  void connect()

  return {
    send(frame) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(frame))
    },
    close() {
      if (closed) return
      closed = true
      clearTimeout(retry)
      clearTimeout(idle)
      clearTimeout(saveTimer)
      void kvSet('seq', seq)
      if (hasWindow) {
        document.removeEventListener('visibilitychange', wake)
        window.removeEventListener('online', wake)
        window.removeEventListener('pageshow', wake)
      }
      const sock = ws
      ws = null
      sock?.close(1000)
      opts.onState('closed')
    },
    get seq() {
      return seq
    },
  }
}
