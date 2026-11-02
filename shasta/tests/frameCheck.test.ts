import { describe, expect, it } from 'vitest'
import { checkFrame, forgetTab, judge, noteDocument, seenDocument } from '@/proxy/frameCheck'

describe('frame filter check', () => {
  it('matches a page request by address, ignoring the hash and a trailing slash', () => {
    forgetTab('t1')
    const now = 1_000_000
    noteDocument('t1', 'https://fiveplay.lol/', now)
    expect(seenDocument('t1', 'https://fiveplay.lol#top', now + 10)).not.toBeNull()
    expect(seenDocument('t1', 'https://fiveplay.lol/other', now + 10)).toBeNull()
    expect(seenDocument('t2', 'https://fiveplay.lol/', now + 10)).toBeNull()
    // too old to belong to this load
    expect(seenDocument('t1', 'https://fiveplay.lol/', now + 120_000)).toBeNull()
  })

  it('never reached the proxy + the site answers = likely filtered', () => {
    const r = judge({ proxyConnected: true, seen: null, live: { status: 200 } })
    expect(r.verdict).toBe('filtered')
    expect(r.reachedProxy).toBe(false)
    expect(r.summary).toMatch(/never reached/)
    expect(r.summary).toMatch(/Likely/)
  })

  it('reached the proxy but not shown = refused, never called a filter for sure', () => {
    const r = judge({ proxyConnected: true, seen: { url: 'https://a.test/', at: 0, status: 200 }, live: { status: 200 } })
    expect(r.verdict).toBe('refused')
    expect(r.summary).toMatch(/HTTP 200/)
    expect(r.summary).toMatch(/Possibly/)
  })

  it('blames the site or the proxy when they are the ones failing', () => {
    expect(judge({ proxyConnected: true, seen: null, live: { error: 'Request failed with error code 6' } }).verdict).toBe('site')
    expect(judge({ proxyConnected: true, seen: null, live: { status: 503 } }).verdict).toBe('site')
    expect(judge({ proxyConnected: false, seen: null, live: { status: 200 } }).verdict).toBe('proxy')
  })

  it('runs the live probe and survives a failing transport', async () => {
    forgetTab('t3')
    const ok = await checkFrame('t3', 'https://a.test/', { proxyConnected: true, request: async () => ({ status: 204 }) })
    expect(ok).toMatchObject({ verdict: 'filtered', liveStatus: 204 })
    const bad = await checkFrame('t3', 'https://a.test/', {
      proxyConnected: true,
      request: async () => {
        throw new Error('boom')
      },
    })
    expect(bad).toMatchObject({ verdict: 'site', liveError: 'boom' })
    const slow = await checkFrame('t3', 'https://a.test/', { proxyConnected: true, timeoutMs: 20, request: (_u, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) })
    expect(slow.liveError).toBe('timed out')
  })
})
