import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('location', { protocol: 'https:', host: 'app.example' })
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })
vi.stubGlobal('document', { addEventListener: () => undefined })
vi.stubGlobal('navigator', { onLine: true })

/** A fake WebSocket: hosts in `up` open, everything else errors. Records the order of attempts. */
const up = new Set<string>()
const tried: string[] = []
class FakeSocket {
  binaryType = ''
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    const host = new URL(url).host
    tried.push(host)
    setTimeout(() => (up.has(host) ? this.onopen?.() : this.onerror?.()), 0)
  }
  close() {}
}
vi.stubGlobal('WebSocket', FakeSocket)

afterEach(() => {
  up.clear()
  tried.length = 0
  vi.unstubAllEnvs()
})

describe('Wisp endpoint list', () => {
  it('defaults to this host alone, as before', async () => {
    const { defaultWispUrls, defaultWispUrl } = await import('@/proxy/scramjetAdapter')
    expect(defaultWispUrls()).toEqual(['wss://app.example/wisp/'])
    expect(defaultWispUrl()).toBe('wss://app.example/wisp/')
  })

  it('seeds from VITE_WISP_URLS, then VITE_WISP_URL, then this host, without duplicates', async () => {
    vi.stubEnv('VITE_WISP_URLS', 'wss://a.relay/wisp/, b.relay/wisp/ wss://a.relay/wisp/')
    vi.stubEnv('VITE_WISP_URL', 'wss://c.relay/wisp/')
    const { defaultWispUrls, defaultWispUrl } = await import('@/proxy/scramjetAdapter')
    expect(defaultWispUrls()).toEqual(['wss://a.relay/wisp/', 'wss://b.relay/wisp/', 'wss://c.relay/wisp/', 'wss://app.example/wisp/'])
    expect(defaultWispUrl()).toBe('wss://a.relay/wisp/')
  })

  it('drops invalid entries instead of failing the list', async () => {
    const { wispEndpoints } = await import('@/proxy/scramjetAdapter')
    // ws:// is refused on an https page
    expect(wispEndpoints(['', 'ws://plain.example/wisp/', 'wss://ok.example/wisp/', 'wss://ok.example/wisp/'])).toEqual(['wss://ok.example/wisp/'])
  })
})

describe('selectWisp', () => {
  const list = ['wss://one.example/wisp/', 'wss://two.example/wisp/', 'wss://three.example/wisp/']

  it('probes in order and returns the first that answers', async () => {
    const { selectWisp } = await import('@/proxy/scramjetAdapter')
    up.add('two.example').add('three.example')
    expect((await selectWisp(list)).url).toBe('wss://two.example/wisp/')
    expect(tried).toEqual(['one.example', 'two.example'])
  })

  it('starts after the active endpoint and wraps around (rotation)', async () => {
    const { selectWisp } = await import('@/proxy/scramjetAdapter')
    up.add('one.example')
    expect((await selectWisp(list, 2)).url).toBe('wss://one.example/wisp/')
    expect(tried).toEqual(['three.example', 'one.example'])
  })

  it('reports the first endpoint error when none answers', async () => {
    const { selectWisp } = await import('@/proxy/scramjetAdapter')
    await expect(selectWisp(list)).rejects.toThrow('Could not open a WebSocket')
    expect(tried).toEqual(['one.example', 'two.example', 'three.example'])
    await expect(selectWisp([])).rejects.toThrow('No Wisp server')
  })
})
