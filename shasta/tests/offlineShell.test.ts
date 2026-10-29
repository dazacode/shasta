// Runs the real public/sw.js against an in-memory Cache Storage and a fake server: first install, the page-driven
// download, offline serving, failed and successful updates, repair, cleanup, and what the shell must never touch.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildManifest, classify, type OfflineFile, type OfflineGroup } from '../offlineManifest'

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const ORIGIN = 'https://shasta.test'
const COI = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }

const keyOf = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href

class FakeCache {
  map = new Map<string, Response>()
  failPut: Error | null = null
  async match(r: string | { url: string }) {
    return this.map.get(keyOf(r))?.clone()
  }
  async put(r: string, res: Response) {
    if (this.failPut) throw this.failPut
    this.map.set(keyOf(r), res.clone())
  }
  async delete(r: string) {
    return this.map.delete(keyOf(r))
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async has(name: string) {
    return this.stores.has(name)
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async match(r: string, opts: { cacheName: string }) {
    return this.stores.get(opts.cacheName)?.match(r)
  }
}

type Build = { version: string; files: Record<string, string>; manifest: { version: string; app: string; engine: string; files: OfflineFile[] } }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** A build: path (with ?v= for engine files) -> body. Paths under /ort/ are the optional AI group. */
function makeBuild(version: string, files: Record<string, string>): Build {
  const list = Object.entries(files).map(([url, body]) => ({ url, size: body.length, sha256: sha(body), group: (url.startsWith('/ort/') ? 'ai' : 'core') as OfflineGroup }))
  return { version, files, manifest: { version, app: '1.0.0', engine: 'e1', files: list } }
}

const V1 = makeBuild('v1', {
  '/index.html': '<html>v1</html>',
  '/assets/index-aaa.js': 'console.log("app v1")',
  '/assets/font-aaa.woff2': 'font',
  '/scramjet/scramjet.js?v=e1': 'scramjet',
  '/scramjet/scramjet.wasm?v=e1': 'wasm',
  '/manifest.webmanifest': '{}',
  '/ort/ort.wasm': 'ort runtime',
})
const V2 = makeBuild('v2', { ...V1.files, '/index.html': '<html>v2</html>', '/assets/index-bbb.js': 'console.log("app v2")' })
delete V2.files['/assets/index-aaa.js']
V2.manifest.files = V2.manifest.files.filter((f) => f.url !== '/assets/index-aaa.js')

/** The server: what it currently deploys, which paths fail, and every request it saw. */
class FakeServer {
  build: Build
  online = true
  failing = new Set<string>()
  wrongBytes = new Set<string>()
  interrupt = new Set<string>()
  /** the browser's HTTP cache holds another build's bytes under this name; only cache: 'reload' gets the real file */
  stale = new Set<string>()
  requests: string[] = []
  constructor(build: Build) {
    this.build = build
  }
  fetch = async (input: string | { url: string }, init?: { cache?: string }) => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN)
    this.requests.push(url.pathname + url.search)
    if (!this.online) throw new TypeError('Failed to fetch')
    if (this.failing.has(url.pathname)) return new Response('boom', { status: 500 })
    if (url.pathname === '/offline-manifest.json') return new Response(JSON.stringify(this.build.manifest), { headers: { 'Content-Type': 'application/json', ...COI } })
    // like the real server, the query is ignored when finding the file
    const entry = Object.entries(this.build.files).find(([k]) => k.split('?')[0] === (url.pathname === '/' ? '/index.html' : url.pathname))
    if (!entry) return new Response('not found', { status: 404 })
    const stale = this.stale.has(url.pathname) && init?.cache !== 'reload'
    const body = this.wrongBytes.has(url.pathname) || stale ? entry[1] + ' tampered' : entry[1]
    if (this.interrupt.has(url.pathname)) {
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(body.slice(0, 3))), c.error(new TypeError('network error'))) }), { headers: COI })
    }
    return new Response(body, { headers: { 'Content-Type': 'text/plain', ...COI } })
  }
}

type Handler = (e: unknown) => void

function loadSw(version: string, caches: FakeCaches, server: FakeServer, scramjetTabs: string[] = []) {
  const handlers: Record<string, Handler> = {}
  const self = { skipped: false, skipWaiting: async () => void (self.skipped = true) }
  const scramjet = {
    shouldRoute: (e: { request: { url: string } }) => scramjetTabs.some((p) => new URL(e.request.url).pathname.startsWith(p)),
    route: async () => new Response('proxied'),
  }
  const run = new Function('importScripts', '$scramjetController', 'addEventListener', 'caches', 'fetch', 'location', 'self', SOURCE.replace('"__SHASTA_SHELL_VERSION__"', JSON.stringify(version)))
  run(() => undefined, scramjet, (type: string, fn: Handler) => (handlers[type] = fn), caches, server.fetch, { origin: ORIGIN }, self)

  const extendable = () => {
    const waits: Promise<unknown>[] = []
    return { waits, waitUntil: (p: Promise<unknown>) => void waits.push(p) }
  }
  return {
    self,
    async install() {
      const e = extendable()
      handlers.install(e)
      await Promise.all(e.waits)
    },
    async activate() {
      const e = extendable()
      handlers.activate(e)
      await Promise.all(e.waits)
    },
    /** null when the worker left the request to the browser */
    async fetch(url: string, { mode = 'cors', method = 'GET', range = false } = {}) {
      const e = { ...extendable(), request: { url: new URL(url, ORIGIN).href, method, mode, headers: new Headers(range ? { Range: 'bytes=0-1' } : {}) }, response: null as Promise<Response> | null, respondWith(p: Promise<Response>) { this.response = p } }
      handlers.fetch(e)
      if (!e.response) return null
      const res = await e.response
      await Promise.all(e.waits)
      return res
    },
    async message(msg: Record<string, unknown>) {
      const sent: { type: string; [k: string]: unknown }[] = []
      const e = { ...extendable(), data: { $shastaOffline: msg }, ports: [{ postMessage: (m: { type: string }) => sent.push(m) }] }
      handlers.message(e)
      await Promise.all(e.waits)
      return sent
    },
  }
}

type Sw = ReturnType<typeof loadSw>

/** What lib/offline.ts does for "Download for offline use". */
async function downloadAll(sw: Sw, groups: OfflineGroup[] = ['core']) {
  const [status] = (await sw.message({ op: 'status' })) as { type: string; files: { url: string; group: OfflineGroup; cached: boolean }[] }[]
  for (const f of status.files) if (groups.includes(f.group) && !f.cached) expect((await sw.message({ op: 'cache', url: f.url })).at(-1)?.type).toBe('done')
}

async function cachedUrls(caches: FakeCaches, name: string) {
  return [...(caches.stores.get(name)?.map.keys() ?? [])].map((k) => k.slice(ORIGIN.length)).sort()
}

const shells = async (caches: FakeCaches) => (await caches.keys()).filter((k) => k.startsWith('shasta-shell-')).sort()

const coreUrls = (b: Build) => [...b.manifest.files.filter((f) => f.group === 'core').map((f) => f.url), '/offline-manifest.json'].sort()

describe('offline manifest (build step)', () => {
  it('classifies built files', () => {
    expect(classify('index.html')).toBe('core')
    expect(classify('assets/index-abc.js')).toBe('core')
    expect(classify('assets/poppins-latin-400-normal-abc.woff2')).toBe('core')
    expect(classify('scramjet/scramjet.js')).toBe('core')
    expect(classify('scramjet/scramjet.wasm')).toBe('core')
    expect(classify('controller/controller.inject.js')).toBe('core')
    expect(classify('ort/ort-wasm-simd-threaded.asyncify.wasm')).toBe('ai')
    for (const never of ['sw.js', 'offline-manifest.json', 'assets/index-abc.js.map', 'assets/ort-wasm-simd-threaded.asyncify-Cx.wasm', 'scramjet/scramjet_bundled.js', 'scramjet/scramjet.mjs', 'scramjet/scramjet-external.mjs', 'assets/poppins-abc.woff']) {
      expect(classify(never), never).toBeNull()
    }
  })

  it('lists files with the URLs the app requests and a content-derived version', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shasta-dist-'))
    for (const d of ['assets', 'scramjet', 'controller', 'ort']) mkdirSync(path.join(dir, d))
    const put = (rel: string, body: string) => writeFileSync(path.join(dir, rel), body)
    put('index.html', 'i')
    put('sw.js', 'sw')
    put('assets/a-1.js', 'a')
    put('scramjet/scramjet.js', 's')
    put('controller/controller.sw.js', 'c')
    put('ort/x.wasm', 'o')
    const m = buildManifest(dir, '1.2.3', 'eng')
    expect(m.files.map((f) => [f.url, f.group])).toEqual([
      ['/assets/a-1.js', 'core'],
      ['/controller/controller.sw.js', 'core'],
      ['/index.html', 'core'],
      ['/ort/x.wasm', 'ai'],
      ['/scramjet/scramjet.js?v=eng', 'core'],
    ])
    expect(buildManifest(dir, '1.2.3', 'eng').version).toBe(m.version)
    put('assets/a-1.js', 'changed')
    expect(buildManifest(dir, '1.2.3', 'eng').version).not.toBe(m.version)
  })
})

describe('offline shell service worker', () => {
  it('first install caches nothing and fetches nothing (Scramjet gets its worker at once)', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const sw = loadSw('v1', caches, server)
    await sw.install()
    await sw.activate()
    expect(server.requests).toEqual([])
    expect(await shells(caches)).toEqual([])
  })

  it('never touches proxied pages, other origins, the API, Wisp, models, ranges or unknown navigations', async () => {
    const caches = new FakeCaches()
    const sw = loadSw('v1', caches, new FakeServer(V1), ['/~/sj/tab1/'])
    await downloadAll(sw)
    // Scramjet still routes first
    expect(await (await sw.fetch('/~/sj/tab1/https://example.com/'))!.text()).toBe('proxied')
    // after a worker restart Scramjet has no tabs yet: the shell must not answer either (no index.html in a frame)
    expect(await sw.fetch('/~/sj/tab2/https://example.com/', { mode: 'navigate' })).toBeNull()
    expect(await sw.fetch('/~/sj/tab2/https://example.com/app.js')).toBeNull()
    expect(await sw.fetch('https://example.com/assets/index-aaa.js')).toBeNull()
    expect(await sw.fetch('/api/apps')).toBeNull()
    expect(await sw.fetch('/wisp/')).toBeNull()
    expect(await sw.fetch('/ai-models/onnx-community/x/resolve/main/model.onnx')).toBeNull()
    expect(await sw.fetch('/healthz')).toBeNull()
    expect(await sw.fetch('/offline-manifest.json')).toBeNull()
    expect(await sw.fetch('/somewhere', { mode: 'navigate' })).toBeNull()
    // signing in again behind an access gate: this one navigation always reaches the network
    expect(await sw.fetch('/?online', { mode: 'navigate' })).toBeNull()
    expect(await sw.fetch('/?online=1&x', { mode: 'navigate' })).toBeNull()
    expect(await sw.fetch('/assets/index-aaa.js', { method: 'POST' })).toBeNull()
    expect(await sw.fetch('/ort/ort.wasm', { range: true })).toBeNull()
  })

  it('downloads on request, then starts and refreshes with no network, headers intact', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const sw = loadSw('v1', caches, server)
    await sw.install()
    await sw.activate()
    await downloadAll(sw)
    expect(await cachedUrls(caches, 'shasta-shell-v1')).toEqual(coreUrls(V1))
    // the optional AI runtime was not downloaded without being asked for
    expect(server.requests.some((r) => r.startsWith('/ort/'))).toBe(false)

    server.online = false
    for (const nav of ['/', '/index.html', '/?q=1']) {
      const res = (await sw.fetch(nav, { mode: 'navigate' }))!
      expect(await res.text()).toBe('<html>v1</html>')
      expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
      expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('credentialless')
    }
    expect(await (await sw.fetch('/assets/index-aaa.js'))!.text()).toBe('console.log("app v1")')
    expect(await (await sw.fetch('/scramjet/scramjet.wasm?v=e1'))!.text()).toBe('wasm')
  })

  it('reports status per file and keeps the AI runtime optional', async () => {
    const caches = new FakeCaches()
    const sw = loadSw('v1', caches, new FakeServer(V1))
    let [status] = (await sw.message({ op: 'status' })) as { version: string; files: { url: string; cached: boolean; group: string }[] }[]
    expect(status.version).toBe('v1')
    expect(status.files.every((f) => !f.cached)).toBe(true)
    await downloadAll(sw, ['core', 'ai'])
    ;[status] = (await sw.message({ op: 'status' })) as typeof status[]
    expect(status.files.every((f) => f.cached)).toBe(true)
    await sw.message({ op: 'drop', group: 'ai' })
    ;[status] = (await sw.message({ op: 'status' })) as typeof status[]
    expect(status.files.filter((f) => !f.cached).map((f) => f.url)).toEqual(['/ort/ort.wasm'])
  })

  it('refuses bytes that do not match the manifest, interrupted bodies and full storage', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const sw = loadSw('v1', caches, server)
    server.wrongBytes.add('/index.html')
    expect((await sw.message({ op: 'cache', url: '/index.html' })).at(-1)).toMatchObject({ type: 'error', code: 'mismatch' })
    server.wrongBytes.clear()
    server.interrupt.add('/index.html')
    expect((await sw.message({ op: 'cache', url: '/index.html' })).at(-1)).toMatchObject({ type: 'error', code: 'network' })
    server.interrupt.clear()
    expect(await caches.stores.get('shasta-shell-v1')!.match('/index.html')).toBeUndefined()
    caches.stores.get('shasta-shell-v1')!.failPut = Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    expect((await sw.message({ op: 'cache', url: '/index.html' })).at(-1)).toMatchObject({ type: 'error', code: 'quota' })
    caches.stores.get('shasta-shell-v1')!.failPut = null
    // a retry after the interruption resumes: only the missing file is fetched again
    expect((await sw.message({ op: 'cache', url: '/index.html' })).at(-1)?.type).toBe('done')
  })

  it('will not fill an old version from a server that already has a newer one', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V2)
    const sw = loadSw('v1', caches, server)
    expect((await sw.message({ op: 'cache', url: '/index.html' })).at(-1)).toMatchObject({ type: 'error', code: 'version' })
    expect(await shells(caches)).toEqual([])
  })

  it('a failed update leaves the installed version complete and usable; a later one succeeds incrementally', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const v1 = loadSw('v1', caches, server)
    await v1.install()
    await v1.activate()
    await downloadAll(v1)

    server.build = V2
    server.failing.add('/assets/index-bbb.js')
    const v2 = loadSw('v2', caches, server)
    await expect(v2.install()).rejects.toThrow(/HTTP 500/)
    // the browser keeps v1 active; its cache is untouched and still serves offline
    expect(await cachedUrls(caches, 'shasta-shell-v1')).toEqual(coreUrls(V1))
    server.online = false
    expect(await (await v1.fetch('/', { mode: 'navigate' }))!.text()).toBe('<html>v1</html>')

    server.online = true
    server.failing.clear()
    server.requests = []
    const retry = loadSw('v2', caches, server)
    await retry.install()
    // unchanged files were copied from v1's cache, and what the failed attempt already stored (the new index.html)
    // is not fetched again: only the file that failed comes from the network
    expect(server.requests.sort()).toEqual(['/assets/index-bbb.js', '/offline-manifest.json?v=v2'])
    expect(await cachedUrls(caches, 'shasta-shell-v2')).toEqual(coreUrls(V2))
    await retry.activate()
    // v1 stays as the fallback for windows still running it; new navigations get v2
    expect(await shells(caches)).toEqual(['shasta-shell-v1', 'shasta-shell-v2'])
    server.online = false
    expect(await (await retry.fetch('/', { mode: 'navigate' }))!.text()).toBe('<html>v2</html>')
    expect(await (await retry.fetch('/assets/index-aaa.js'))!.text()).toBe('console.log("app v1")')
  })

  it('a failed update is reported to the page (why, and for which version), and cleared once one succeeds', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const v1 = loadSw('v1', caches, server)
    await v1.install()
    await v1.activate()
    await downloadAll(v1)
    expect((await v1.message({ op: 'updateInfo' })).at(-1)).toMatchObject({ type: 'updateInfo', version: 'v1', lastUpdateError: null })

    server.build = V2
    server.wrongBytes.add('/assets/index-bbb.js')
    await expect(loadSw('v2', caches, server).install()).rejects.toThrow(/not the file this version expects/)
    // the page asks the worker still in charge (v1); it reads what the failed v2 wrote
    const info = (await v1.message({ op: 'updateInfo' })).at(-1) as { version: string; lastUpdateError: { version: string; code: string; message: string } }
    expect(info.version).toBe('v1')
    expect(info.lastUpdateError).toMatchObject({ version: 'v2', code: 'mismatch' })
    expect(info.lastUpdateError.message).toContain('/assets/index-bbb.js')

    server.wrongBytes.clear()
    const v2 = loadSw('v2', caches, server)
    await v2.install()
    await v2.activate()
    expect((await v2.message({ op: 'updateInfo' })).at(-1)).toMatchObject({ version: 'v2', lastUpdateError: null })
  })

  it('an update gets past stale copies in the browser cache by asking the server again', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const v1 = loadSw('v1', caches, server)
    await v1.install()
    await v1.activate()
    await downloadAll(v1)
    // a same-named file whose bytes changed between builds, plus a fixed name whose revalidation kept an old copy
    server.build = V2
    server.stale.add('/assets/index-bbb.js')
    server.stale.add('/index.html')
    const v2 = loadSw('v2', caches, server)
    await v2.install()
    expect(await cachedUrls(caches, 'shasta-shell-v2')).toEqual(coreUrls(V2))
    await v2.activate()
    server.online = false
    expect(await (await v2.fetch('/', { mode: 'navigate' }))!.text()).toBe('<html>v2</html>')
    expect(await (await v2.fetch('/assets/index-bbb.js'))!.text()).toBe('console.log("app v2")')
  })

  it('keeps one previous version for open windows, without its AI runtime, and drops it at the next update', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const v1 = loadSw('v1', caches, server)
    await v1.activate()
    await downloadAll(v1, ['core', 'ai'])
    server.build = V2
    const v2 = loadSw('v2', caches, server)
    await v2.install()
    await v2.activate()
    expect(await shells(caches)).toEqual(['shasta-shell-v1', 'shasta-shell-v2'])
    expect(await caches.stores.get('shasta-shell-v1')!.match('/ort/ort.wasm')).toBeUndefined()
    expect(await caches.stores.get('shasta-shell-v2')!.match('/ort/ort.wasm')).toBeDefined()

    const V3 = makeBuild('v3', { ...V2.files, '/index.html': '<html>v3</html>' })
    server.build = V3
    const v3 = loadSw('v3', caches, server)
    await v3.install()
    await v3.activate()
    expect(await shells(caches)).toEqual(['shasta-shell-v2', 'shasta-shell-v3'])
  })

  it('carries the AI runtime over to an update only when it was downloaded', async () => {
    for (const hadAi of [false, true]) {
      const caches = new FakeCaches()
      const server = new FakeServer(V1)
      const v1 = loadSw('v1', caches, server)
      await downloadAll(v1, hadAi ? ['core', 'ai'] : ['core'])
      server.build = V2
      await loadSw('v2', caches, server).install()
      expect(!!(await caches.stores.get('shasta-shell-v2')!.match('/ort/ort.wasm'))).toBe(hadAi)
    }
  })

  it('a missing (evicted) entry is fetched and put back; after "clear" nothing is cached again', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const sw = loadSw('v1', caches, server)
    await downloadAll(sw)
    await caches.stores.get('shasta-shell-v1')!.delete('/assets/index-aaa.js')
    expect(await (await sw.fetch('/assets/index-aaa.js'))!.text()).toBe('console.log("app v1")')
    expect(await caches.stores.get('shasta-shell-v1')!.match('/assets/index-aaa.js')).toBeDefined()

    await sw.message({ op: 'clear' })
    expect(await shells(caches)).toEqual([])
    expect(await (await sw.fetch('/assets/index-aaa.js'))!.text()).toBe('console.log("app v1")')
    expect(await shells(caches)).toEqual([])
  })

  it('skipWaiting only on request', async () => {
    const sw = loadSw('v1', new FakeCaches(), new FakeServer(V1))
    await sw.install()
    expect(sw.self.skipped).toBe(false)
    expect((await sw.message({ op: 'skipWaiting' })).at(-1)?.type).toBe('done')
    expect(sw.self.skipped).toBe(true)
  })

  it('is off in a dev build (placeholder left in place)', async () => {
    const caches = new FakeCaches()
    const server = new FakeServer(V1)
    const handlers: Record<string, Handler> = {}
    new Function('importScripts', '$scramjetController', 'addEventListener', 'caches', 'fetch', 'location', 'self', SOURCE)(() => undefined, { shouldRoute: () => false }, (t: string, fn: Handler) => (handlers[t] = fn), caches, server.fetch, { origin: ORIGIN }, {})
    let responded = false
    handlers.fetch({ request: { url: `${ORIGIN}/`, method: 'GET', mode: 'navigate', headers: new Headers() }, respondWith: () => (responded = true) })
    expect(responded).toBe(false)
    const waits: Promise<unknown>[] = []
    handlers.install({ waitUntil: (p: Promise<unknown>) => waits.push(p) })
    expect(waits).toEqual([])
  })
})
