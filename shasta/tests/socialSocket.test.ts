// The live social socket (social/socket.ts): hello + resume point, ping/pong, jittered backoff, and the close codes
// that must never reconnect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as { location?: unknown }).location ??= new URL('https://edushasta.lol/me')
})

import { backoffDelay, openSocialSocket, type SocketState } from '@/social/socket'
import type { ServerFrame } from '@/social/types'

class FakeWS {
  static all: FakeWS[] = []
  readyState = 0
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWS.all.push(this)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code = 1000) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

const tick = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  FakeWS.all = []
})
afterEach(() => vi.useRealTimers())

function open(since = 5) {
  const frames: ServerFrame[] = []
  const states: SocketState[] = []
  const sock = openSocialSocket({ WebSocket: FakeWS as never, token: async () => 'tok', url: 'wss://x/api/social/ws', since, random: () => 1, onFrame: (f) => frames.push(f), onState: (s) => states.push(s) })
  return { sock, frames, states }
}

describe('backoff', () => {
  it('doubles up to 30 s and keeps half to all of it', () => {
    expect(backoffDelay(0, () => 1)).toBe(1000)
    expect(backoffDelay(0, () => 0)).toBe(500)
    expect(backoffDelay(3, () => 1)).toBe(8000)
    expect(backoffDelay(20, () => 1)).toBe(30_000)
    for (let i = 0; i < 50; i++) {
      const d = backoffDelay(i % 8)
      expect(d).toBeGreaterThanOrEqual(500)
      expect(d).toBeLessThanOrEqual(30_000)
    }
  })
})

describe('openSocialSocket', () => {
  it('says hello with the token (never in the URL) and the resume point', async () => {
    const { states } = open(5)
    await tick()
    const ws = FakeWS.all[0]
    expect(ws.url).not.toContain('tok')
    ws.open()
    expect(ws.sent[0]).toMatchObject({ t: 'hello', token: 'tok', since: 5 })
    expect(typeof (ws.sent[0] as { tzOffset: unknown }).tzOffset).toBe('number')
    ws.push({ t: 'ready', me: {}, seq: 7 })
    expect(states).toContain('open')
  })

  it('answers pings, tracks seq, and resumes from the last event after a drop', async () => {
    const { sock, frames, states } = open(5)
    await tick()
    const ws = FakeWS.all[0]
    ws.open()
    ws.push({ t: 'ready', me: {}, seq: 5 })
    ws.push({ t: 'ping' })
    expect(ws.sent).toContainEqual({ t: 'pong' })
    ws.push({ t: 'ev', seq: 9, e: { type: 'friend_removed', accountId: 'a' } })
    expect(sock.seq).toBe(9)
    expect(frames.some((f) => f.t === 'ping')).toBe(false)

    ws.close(1006)
    expect(states.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeWS.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(FakeWS.all).toHaveLength(2)
    FakeWS.all[1].open()
    expect(FakeWS.all[1].sent[0]).toMatchObject({ t: 'hello', since: 9 })
    sock.close()
  })

  it('a server whose counter is behind ours started over: take its number', async () => {
    const { sock } = open(50)
    await tick()
    FakeWS.all[0].open()
    FakeWS.all[0].push({ t: 'ready', me: {}, seq: 3 })
    expect(sock.seq).toBe(3)
    sock.close()
  })

  it('4401 signs out and 4403 is suspended; neither reconnects', async () => {
    const a = open()
    await tick()
    FakeWS.all[0].open()
    FakeWS.all[0].close(4401)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(a.states).toContain('signed-out')
    expect(FakeWS.all).toHaveLength(1)

    FakeWS.all = []
    const b = open()
    await tick()
    FakeWS.all[0].open()
    FakeWS.all[0].close(4403)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(b.states.at(-1)).toBe('suspended')
    expect(FakeWS.all).toHaveLength(1)
  })

  it('a silent socket is treated as dead and replaced', async () => {
    const { sock } = open()
    await tick()
    FakeWS.all[0].open()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(FakeWS.all[0].readyState).toBe(3)
    await vi.advanceTimersByTimeAsync(1100)
    expect(FakeWS.all.length).toBe(2)
    sock.close()
  })

  it('no token: signed out, no socket', async () => {
    const states: SocketState[] = []
    openSocialSocket({ WebSocket: FakeWS as never, token: async () => null, url: 'wss://x', since: 0, onFrame: () => {}, onState: (s) => states.push(s) })
    await tick()
    expect(states).toEqual(['signed-out'])
    expect(FakeWS.all).toHaveLength(0)
  })
})
