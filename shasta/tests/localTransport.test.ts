// The `local` transport: the in-page relay leads the endpoint list, and the configured relays stay
// behind it, so a browser without Direct Sockets (anything that is not an Isolated Web App) still
// browses. `endpointsFor` is the seam the whole fallback hangs on.
//
// The adapter is imported dynamically, after the globals are stubbed, because it touches `window`
// at module scope (as tests/wispEndpoints.test.ts does).
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('location', { protocol: 'https:', host: 'app.example' })
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })
vi.stubGlobal('document', { addEventListener: () => undefined })
vi.stubGlobal('navigator', { onLine: true })

const adapter = () => import('@/proxy/scramjetAdapter')
const options = (transport: 'libcurl' | 'epoxy' | 'local') => ({
  transport,
  wispUrl: 'wss://relay.example/wisp/',
  wispUrls: ['wss://spare.example/wisp/'],
})

afterEach(async () => (await adapter()).stopLocalRelay())

describe('endpointsFor', () => {
  it('returns the configured endpoints for a normal transport', async () => {
    const { endpointsFor } = await adapter()
    expect(await endpointsFor(options('libcurl'))).toEqual(['wss://relay.example/wisp/', 'wss://spare.example/wisp/'])
  })

  it('keeps the configured relays behind the on-device relay', async () => {
    const { endpointsFor } = await adapter()
    // There is no `TCPSocket` in this (Node) test, so the on-device relay is unavailable: the
    // configured endpoints must come back untouched rather than an empty list.
    const list = await endpointsFor(options('local'))
    expect(list).toContain('wss://relay.example/wisp/')
    expect(list).toContain('wss://spare.example/wisp/')
  })

  it('never returns an empty list, so a failed local relay cannot strand browsing', async () => {
    const { endpointsFor } = await adapter()
    expect((await endpointsFor(options('local'))).length).toBeGreaterThan(0)
  })

  it('reports the relay as absent here, and does not pretend otherwise', async () => {
    const { hasLocalRelay, endpointsFor } = await adapter()
    await endpointsFor(options('local'))
    expect(hasLocalRelay()).toBe(false)
  })
})

describe('canRunLocalRelay', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is false in a normal tab, which has no TCPSocket', async () => {
    const { canRunLocalRelay } = await adapter()
    expect(canRunLocalRelay()).toBe(false)
  })

  it('is true where Direct Sockets exist (an installed Isolated Web App)', async () => {
    const { canRunLocalRelay } = await adapter()
    vi.stubGlobal('TCPSocket', class {})
    expect(canRunLocalRelay()).toBe(true)
  })
})
