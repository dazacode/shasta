// A download's life (proxy/downloadWatch.ts): progress, then exactly one ending, whatever the body does.
import { describe, expect, it } from 'vitest'
import { endOfBody, watchDownloadBody } from '@/proxy/downloadWatch'

const bytes = (n: number) => new Uint8Array(n).fill(7)

/** a body that yields `chunks`, then ends the way `finish` says */
function source(chunks: Uint8Array[], finish: 'close' | 'error' | 'hang' = 'close') {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) return ctrl.enqueue(chunks[i++])
      if (finish === 'close') ctrl.close()
      else if (finish === 'error') ctrl.error(new Error('connection reset'))
      else return new Promise(() => undefined)
    },
  })
}

async function drain(s: ReadableStream<Uint8Array>) {
  const r = s.getReader()
  let n = 0
  for (;;) {
    const { done, value } = await r.read()
    if (done) return n
    n += value.byteLength
  }
}

const watch = (body: ReadableStream<Uint8Array>, total: number, encoded = false) => {
  const events: { phase: string; received: number; total?: number; error?: string }[] = []
  let clock = 0
  const out = watchDownloadBody(body, { total, encoded, now: () => (clock += 1000) }, (e) => events.push(e))
  return { out, events, endings: () => events.filter((e) => e.phase !== 'progress') }
}

describe('endOfBody', () => {
  it('is complete when every announced byte arrived, or nothing was announced', () => {
    expect(endOfBody(10, 10, false).phase).toBe('complete')
    expect(endOfBody(10, 0, false).phase).toBe('complete')
    expect(endOfBody(12, 10, false).phase).toBe('complete')
  })
  it('is an error when an unencoded body comes up short', () => {
    expect(endOfBody(5, 10, false)).toMatchObject({ phase: 'error' })
  })
  it('trusts a compressed body (its Content-Length counts compressed bytes)', () => {
    expect(endOfBody(5, 10, true).phase).toBe('complete')
  })
})

describe('watchDownloadBody', () => {
  it('passes every byte through and ends complete once', async () => {
    const w = watch(source([bytes(3), bytes(4)]), 7)
    expect(await drain(w.out)).toBe(7)
    expect(w.events.filter((e) => e.phase === 'progress').length).toBeGreaterThan(0)
    expect(w.endings()).toEqual([{ phase: 'complete', received: 7, total: 7 }])
  })

  it('reports the size it saw when the server announced none', async () => {
    const w = watch(source([bytes(5)]), 0)
    await drain(w.out)
    expect(w.endings()).toEqual([{ phase: 'complete', received: 5, total: 5 }])
  })

  it('a body that breaks ends the download as interrupted (it used to stay "downloading")', async () => {
    const w = watch(source([bytes(3)], 'error'), 10)
    await expect(drain(w.out)).rejects.toThrow('connection reset')
    expect(w.endings()).toEqual([{ phase: 'error', received: 3, error: 'connection reset' }])
  })

  it('a body that closes early is interrupted, not complete', async () => {
    const w = watch(source([bytes(3)]), 10)
    await drain(w.out)
    expect(w.endings()).toEqual([{ phase: 'error', received: 3, total: 10, error: expect.stringMatching(/before the whole file/) }])
  })

  it('a cancelled download is interrupted once, and the source is cancelled too', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull: (ctrl) => ctrl.enqueue(bytes(2)),
      cancel: () => void (cancelled = true),
    })
    const w = watch(body, 100)
    const r = w.out.getReader()
    await r.read()
    await r.cancel('user')
    await r.cancel('again').catch(() => undefined)
    expect(cancelled).toBe(true)
    expect(w.endings()).toEqual([{ phase: 'error', received: 2, error: 'Cancelled' }])
  })
})
