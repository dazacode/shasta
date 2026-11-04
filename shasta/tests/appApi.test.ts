// lib/appApi.ts: in the installed app, /api and /ai-models go to the configured backend; nothing else moves, and a
// normal tab is never touched. The module reads location and the build variable when it loads, so each case
// stubs them and imports a fresh copy.
import { afterEach, describe, expect, it, vi } from 'vitest'

const APP = 'isolated-app://domblmy72no3gihfrsnkhpedixfdwr5oa3px6gpd75hmu3s7qs5qaaic'

async function load(href: string, backend: string | undefined) {
  vi.resetModules()
  const u = new URL(href)
  vi.stubGlobal('location', { href, origin: u.origin, protocol: u.protocol })
  vi.stubGlobal('window', { fetch: () => Promise.resolve(new Response()), EventSource: class {} })
  vi.stubEnv('VITE_APP_API_ORIGIN', backend ?? '')
  return import('@/lib/appApi')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('routeToBackend', () => {
  it('sends the app’s /api and /ai-models to the backend, query included', async () => {
    const { routeToBackend, APP_API_ORIGIN } = await load(`${APP}/`, 'https://api.example.org/')
    expect(APP_API_ORIGIN).toBe('https://api.example.org')
    expect(routeToBackend('/api/catalog/apps?q=x')).toBe('https://api.example.org/api/catalog/apps?q=x')
    expect(routeToBackend(`${APP}/ai-models/org/repo/resolve/main/a.onnx`)).toBe('https://api.example.org/ai-models/org/repo/resolve/main/a.onnx')
  })

  it('leaves everything else alone', async () => {
    const { routeToBackend } = await load(`${APP}/`, 'https://api.example.org')
    expect(routeToBackend('/assets/index.js')).toBeNull()
    expect(routeToBackend('/apix/1')).toBeNull()
    expect(routeToBackend('https://other.example/api/x')).toBeNull()
  })

  it('does nothing in a normal tab, even with the variable set', async () => {
    const { routeToBackend, APP_API_ORIGIN } = await load('https://shasta.example/', 'https://api.example.org')
    expect(APP_API_ORIGIN).toBe('')
    expect(routeToBackend('/api/x')).toBeNull()
  })

  it('refuses a plain-http backend (the app’s CSP only allows https connections)', async () => {
    expect((await load(`${APP}/`, 'http://api.example.org')).APP_API_ORIGIN).toBe('')
    expect((await load(`${APP}/`, 'http://localhost:8090')).APP_API_ORIGIN).toBe('')
  })
})

describe('Lite backends (VITE_API_ORIGINS)', () => {
  async function lite(fetchImpl: (u: string) => Promise<Response>) {
    vi.resetModules()
    const href = 'https://lite.example/'
    vi.stubGlobal('location', { href, origin: 'https://lite.example', protocol: 'https:' })
    const win = { fetch: (i: RequestInfo | URL) => fetchImpl(i instanceof Request ? i.url : String(i)), EventSource: class {} }
    vi.stubGlobal('window', win)
    vi.stubEnv('VITE_EDITION', 'lite')
    vi.stubEnv('VITE_API_ORIGINS', 'https://a.example,https://b.example')
    const mod = await import('@/lib/appApi')
    return { mod, fetch: win.fetch }
  }

  it('moves to the next backend when one cannot be reached, and stays there', async () => {
    const seen: string[] = []
    const { mod, fetch } = await lite(async (u) => {
      seen.push(u)
      if (u.startsWith('https://a.example')) throw new TypeError('Failed to fetch')
      return new Response('ok')
    })
    expect(mod.API_ORIGINS[0]).toBe('https://a.example')
    expect(await (await fetch('/api/x')).text()).toBe('ok')
    expect(mod.APP_API_ORIGIN).toBe('https://b.example')
    await fetch('/api/y')
    expect(seen).toEqual(['https://a.example/api/x', 'https://b.example/api/x', 'https://b.example/api/y'])
    // a URL a caller built on the old backend follows the move too
    expect(mod.routeToBackend('https://a.example/api/media/1')).toBe('https://b.example/api/media/1')
  })

  it('an HTTP error is an answer, not a reason to switch', async () => {
    const { mod, fetch } = await lite(async () => new Response('no', { status: 500 }))
    expect((await fetch('/api/x')).status).toBe(500)
    expect(mod.APP_API_ORIGIN).toBe('https://a.example')
  })

  it('throws once every backend failed', async () => {
    const { fetch } = await lite(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetch('/api/x')).rejects.toThrow('Failed to fetch')
  })
})
