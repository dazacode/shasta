// The inference worker's lifecycle (ai/engine.ts): however the worker ends, every job it held is settled.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8080', origin: 'http://localhost:8080', href: 'http://localhost:8080/' })
vi.stubGlobal('window', { addEventListener: () => undefined })
vi.stubGlobal('document', { addEventListener: () => undefined })
vi.stubGlobal('caches', { delete: async () => true, has: async () => false })

/** Stands in for the module worker: records what the page asks, and lets the test answer or crash it. */
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { preventDefault(): void }) => void) | null = null
  posted: { id: number; op: string }[] = []
  terminated = false
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(m: { id: number; op: string }) {
    this.posted.push(m)
  }
  terminate() {
    this.terminated = true
  }
  reply(id: number, value?: unknown) {
    this.onmessage?.({ data: { id, type: 'result', value } })
  }
  crash() {
    this.onerror?.({ preventDefault: () => undefined })
  }
  /** the last request with this op */
  last(op: string) {
    return [...this.posted].reverse().find((m) => m.op === op)
  }
}
vi.stubGlobal('Worker', FakeWorker)

const { ai, useAi, AbortedError } = await import('@/ai/engine')

const tick = () => new Promise((r) => setTimeout(r, 0))
/** fails the test instead of hanging when a promise never settles (the bug these tests are about) */
const settles = <T,>(p: Promise<T>, ms = 1000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('never settled')), ms))])

beforeEach(async () => {
  // a clean engine: whatever the previous test left behind is torn down
  await ai.removeDownloads()
  FakeWorker.all = []
  useAi.setState({ profileReady: true })
})

describe('AI worker lifecycle', () => {
  it('a crash while the worker starts up fails the waiting call instead of hanging it', async () => {
    const prep = ai.prepare('chat').catch((e: Error) => e)
    await tick()
    const w = FakeWorker.all[0]
    expect(w.last('init')).toBeTruthy()
    w.crash()
    const err = await settles(prep)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/stopped unexpectedly/)
    expect(w.terminated).toBe(true)
  })

  it('a crash mid-job fails the running job and the queued ones, and the assistant is no longer busy', async () => {
    const first = ai.prepare('chat').catch((e: Error) => e)
    await tick()
    const w = FakeWorker.all[0]
    w.reply(w.last('init')!.id)
    await tick()
    expect(w.last('load')).toBeTruthy()
    const second = ai.prepare('vision').catch((e: Error) => e)
    await tick()
    expect(useAi.getState().busy).toBe(true)
    w.crash()
    expect(((await settles(first)) as Error).message).toMatch(/stopped unexpectedly/)
    expect(((await settles(second)) as Error).message).toMatch(/stopped unexpectedly/)
    expect(useAi.getState().busy).toBe(false)
  })

  it('removing the downloads during a download stops it like Stop does (no error, nothing left waiting)', async () => {
    const prep = ai.prepare('chat').catch((e: Error) => e)
    await tick()
    const w = FakeWorker.all[0]
    w.reply(w.last('init')!.id)
    await tick()
    expect(useAi.getState().models.chat.state).toBe('downloading')
    await ai.removeDownloads()
    expect(await settles(prep)).toBeInstanceOf(AbortedError)
    expect(useAi.getState().busy).toBe(false)
    expect(useAi.getState().models.chat.state).toBe('idle')
  })

  it('the one-step setup is not stuck "running" after the worker crashes', async () => {
    const all = ai.prepareAll().catch((e: Error) => e)
    await tick()
    const w = FakeWorker.all[0]
    w.reply(w.last('init')!.id)
    await tick()
    expect(useAi.getState().setup.running).toBe(true)
    expect(w.last('load')).toBeTruthy()
    w.crash()
    await settles(all)
    expect(useAi.getState().setup.running).toBe(false)
    expect(useAi.getState().setup.error).toMatch(/stopped unexpectedly/)
  })

  it('after a crash the next job starts a fresh worker', async () => {
    const a = ai.prepare('chat').catch(() => undefined)
    await tick()
    FakeWorker.all[0].crash()
    await settles(a)
    const b = ai.prepare('chat')
    await tick()
    expect(FakeWorker.all).toHaveLength(2)
    const w = FakeWorker.all[1]
    w.reply(w.last('init')!.id)
    await tick()
    w.reply(w.last('load')!.id)
    await settles(b)
  })
})
