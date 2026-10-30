// Everything Scramjet-specific lives here; the rest of the app only sees this module.
//
// Responsibilities: service worker + controller boot, Wisp transport (health probe, reconnect),
// one proxied Frame per tab (navigation, loading/error detection, title/favicon, downloads),
// and cleanup when a frame goes away. This module never imports React or app stores.
//
// The engine (~3.8 MB) and the transports are loaded with dynamic imports so the browser shell
// can paint before Scramjet has been parsed.
import type { Controller, Frame } from '@mercuryworkshop/scramjet-controller'
import type { ContextInfo } from '@/lib/contextMenu'
import type { MissingFeature } from '@/lib/browserSupport'
// tabs in the installed app may use the direct engine instead; every per-tab call below goes to whichever owns the tab
import * as direct from './directFrame'
import { BASE } from '@/lib/edition'
import { storageScope } from '@/lib/sharedOrigin'

type Engine = {
  scramjet: typeof import('@mercuryworkshop/scramjet')
  controller: typeof import('@mercuryworkshop/scramjet-controller')
  plugin: typeof import('./shastaPlugin')
}

let engine: Engine | null = null
let enginePromise: Promise<Engine> | null = null

function loadEngine(): Promise<Engine> {
  enginePromise ??= Promise.all([import('@mercuryworkshop/scramjet'), import('@mercuryworkshop/scramjet-controller'), import('./shastaPlugin')]).then(([scramjet, controller, plugin]) => (engine = { scramjet, controller, plugin }))
  enginePromise.catch(() => (enginePromise = null))
  return enginePromise
}

export type TransportName = 'libcurl' | 'epoxy' | 'local'

export interface ProxyOptions {
  /** the preferred Wisp endpoint */
  wispUrl: string
  /** fallbacks, tried in order when the preferred one cannot be reached */
  wispUrls?: string[]
  transport: TransportName
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export interface ConnectionInfo {
  state: ConnectionState
  detail: string
  /** round trip of the last Wisp handshake, ms */
  latency: number | null
  /** the Wisp endpoint in use (or last tried), null before the first attempt */
  endpoint: string | null
}

export interface DownloadEvent {
  id: string
  phase: 'start' | 'progress' | 'complete' | 'error'
  url: string
  filename: string
  mime: string
  /** bytes, 0 when the server did not announce a length */
  total: number
  received: number
  error?: string
}

export type ProxyEvent =
  | { type: 'connection'; info: ConnectionInfo }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'download'; download: DownloadEvent }
  | { type: 'openTab'; url: string; openerTabId: string }
  /** a page tried to open a tab without a click (or to an ad host) and it was refused */
  | { type: 'popupBlocked'; url: string; openerTabId: string; ad: boolean }
  /** a page crashed for want of a browser feature this Chrome lacks (lib/browserSupport.ts); null = a new page started */
  | { type: 'unsupported'; tabId: string; feature: MissingFeature | null }

/** Per-tab events from the real browsing frame. Nothing here is synthesized by the UI. */
export interface FrameEvents {
  /** a navigation began; `committed` is false while we are only waiting on the network */
  navStart: (info: { committed: boolean }) => void
  /** URL of the top-level document changed (navigation, pushState, hash) */
  url: (url: string) => void
  title: (title: string) => void
  favicon: (origin: string, dataUrl: string) => void
  /** the iframe fired `load` for a real document */
  loaded: () => void
  /** the navigation failed (proxy/transport error page, browser error page, or timeout) */
  failed: (error: { message: string; url: string }) => void
  /** a keyboard shortcut candidate typed inside the proxied page (the shell never sees these otherwise) */
  key: (e: KeyboardEvent) => void
  /** a right-click inside the proxied page (Shasta shows its own menu instead of the browser's) */
  contextMenu: (info: ContextInfo) => void
}

export interface Entry {
  tabId: string
  frame: Frame
  iframe: HTMLIFrameElement
  events: FrameEvents
  onLoad: () => void
  timers: Set<number>
  navTimer: number | null
  disposeTimer: number | null
  lastTitle: string
  lastUrl: string
  committed: boolean
}

const SW_URL = `${BASE}sw.js`
const NAV_TIMEOUT_MS = 45_000
export const TENTATIVE_NAV_MS = 8_000
const PROBE_INTERVAL_MS = 20_000
const MAX_FAVICON_BYTES = 48 * 1024
export const ERROR_META = 'shasta-error'

let controller: Controller | null = null
let initPromise: Promise<void> | null = null
let currentOptions: ProxyOptions | null = null
let swRegistration: ServiceWorkerRegistration | null = null
let info: ConnectionInfo = { state: 'idle', detail: '', latency: null, endpoint: null }
/** the endpoint the current transport talks to */
let activeWisp: string | null = null
let probeTimer: number | null = null
let retryDelay = 2000
let probing = false
let titleTimer: number | null = null

export const byTab = new Map<string, Entry>()
const byIframe = new WeakMap<HTMLIFrameElement, Entry>()
const listeners = new Set<(e: ProxyEvent) => void>()
const faviconCache = new Map<string, string | null>()

// ---- events -----------------------------------------------------------------------------

export function subscribe(fn: (e: ProxyEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const emit = (e: ProxyEvent) => listeners.forEach((fn) => fn(e))
export const log = (level: 'info' | 'warn' | 'error', message: string) => emit({ type: 'log', level, message })

function setConnection(state: ConnectionState, detail = '', latency: number | null = info.latency) {
  const endpoint = activeWisp
  if (info.state === state && info.detail === detail && info.latency === latency && info.endpoint === endpoint) return
  info = { state, detail, latency, endpoint }
  emit({ type: 'connection', info })
}

export const connectionInfo = () => info

export function engineVersion(): string {
  try {
    return engine?.scramjet.versionInfo?.version ?? 'not loaded'
  } catch {
    return 'unknown'
  }
}

// ---- transport --------------------------------------------------------------------------

const sameOriginWisp = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/wisp/`

/**
 * The built-in endpoints, in order: `VITE_WISP_URLS` (comma or space separated), `VITE_WISP_URL`, then this
 * page's own `/wisp/`. With neither variable set this is just the same-origin endpoint, as before.
 */
export function defaultWispUrls(): string[] {
  const list = String(import.meta.env.VITE_WISP_URLS ?? '').split(/[\s,]+/)
  list.push(String(import.meta.env.VITE_WISP_URL ?? ''), sameOriginWisp())
  return wispEndpoints(list)
}

export const defaultWispUrl = (): string => defaultWispUrls()[0]

/** Valid, de-duplicated endpoints in order; invalid entries are dropped rather than failing the whole list. */
export function wispEndpoints(urls: readonly string[]): string[] {
  const out: string[] = []
  for (const u of urls) {
    try {
      const n = normalizeWispUrl(u)
      if (!out.includes(n)) out.push(n)
    } catch {
      /* empty or malformed: skip */
    }
  }
  return out
}

const endpointsOf = (o: ProxyOptions) => wispEndpoints([o.wispUrl, ...(o.wispUrls ?? [])])

// ---- in-page relay (Isolated Web App) ------------------------------------------------------
//
// `local` runs the whole Wisp relay inside the page using the Direct Sockets API, which only an
// Isolated Web App has. Everything else here is unchanged: libcurl still speaks Wisp, it is just
// talking to a server in the same tab. If the browser cannot open sockets, or the relay fails, the
// configured relays stay on the end of the list and take over. See docs/on-device-wisp.md.

let localRelay: { url: string; close: () => void } | null = null
let localRelayTried = false

async function ensureLocalRelay(): Promise<string | null> {
  if (localRelayTried) return localRelay?.url ?? null
  localRelayTried = true
  try {
    const mod = await import('@dazacode/shasta-wisp/browser')
    if (!mod.hasDirectSockets()) {
      log('info', 'No Direct Sockets here (needs an Isolated Web App); using a Wisp relay')
      return null
    }
    const server = mod.createLocalWispServer()
    server.installWebSocket()
    localRelay = { url: server.url, close: () => server.close() }
    log('info', `In-page Wisp relay ready at ${server.url}; no relay host needed`)
    return localRelay.url
  } catch (e) {
    log('warn', `In-page Wisp relay unavailable: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** Stops the in-page relay (for tests and settings changes). */
export function stopLocalRelay(): void {
  localRelay?.close()
  localRelay = null
  localRelayTried = false
}

/** Exposed for Settings: whether this browser can run the relay on the device. */
export const hasLocalRelay = (): boolean => localRelay !== null

/**
 * Whether this context has raw sockets, so the relay can run on the device. Only an installed Isolated Web
 * App does (a normal tab, http or https, never has `TCPSocket`).
 */
export const canRunLocalRelay = (): boolean => typeof (globalThis as { TCPSocket?: unknown }).TCPSocket === 'function'

/** Endpoints to try, in order. For `local` the in-page relay comes first and the relays follow. */
export async function endpointsFor(o: ProxyOptions): Promise<string[]> {
  const configured = endpointsOf(o)
  if (o.transport !== 'local') return configured
  const url = await ensureLocalRelay()
  if (!url) return configured
  return [url, ...configured.filter((u) => u !== url)]
}

export function normalizeWispUrl(value: string): string {
  const v = value.trim()
  if (!v) throw new Error('Wisp URL is required')
  const withScheme = /^wss?:\/\//i.test(v) ? v : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${v}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    throw new Error('That is not a valid WebSocket URL')
  }
  if (!u.hostname) throw new Error('The Wisp URL needs a host name')
  if (location.protocol === 'https:' && u.protocol === 'ws:' && u.hostname !== 'localhost') {
    throw new Error('This page is served over HTTPS, so the Wisp URL must use wss://')
  }
  return u.href
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })

async function makeTransport(wispUrl: string, transport: TransportName) {
  const wisp = normalizeWispUrl(wispUrl)
  const client =
    transport === 'epoxy'
      ? new (await import('@mercuryworkshop/epoxy-transport')).default({ wisp })
      : new (await import('@mercuryworkshop/libcurl-transport')).default({ wisp })
  await withTimeout(Promise.resolve(client.init()), 20_000, `${transport} transport startup`)
  return client
}
/** Opens (and immediately closes) a WebSocket to the Wisp endpoint to prove the server is reachable. */
function probeWisp(wispUrl: string, timeoutMs = 6000): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    let ws: WebSocket
    try {
      ws = new WebSocket(normalizeWispUrl(wispUrl))
    } catch (e) {
      return reject(e instanceof Error ? e : new Error(String(e)))
    }
    ws.binaryType = 'arraybuffer'
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('The Wisp server did not answer in time'))
    }, timeoutMs)
    ws.onopen = () => {
      clearTimeout(timer)
      const rtt = Math.round(performance.now() - started)
      ws.close()
      resolve(rtt)
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Could not open a WebSocket to the Wisp server'))
    }
  })
}

/**
 * Probes the endpoints in order, starting at `from` and wrapping around, and returns the first that answers.
 * Throws the first endpoint's error when none does (that is the one people configured).
 */
export async function selectWisp(endpoints: readonly string[], from = 0): Promise<{ url: string; rtt: number }> {
  if (!endpoints.length) throw new Error('No Wisp server is configured')
  let first: unknown = null
  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[(from + i) % endpoints.length]
    try {
      return { url, rtt: await probeWisp(url) }
    } catch (e) {
      first ??= e
      if (endpoints.length > 1) log('warn', `Wisp server ${hostOf(url)} unreachable: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw first instanceof Error ? first : new Error(String(first))
}

/** Moves to the next endpoint that answers (after the active one) and swaps the transport live. */
export async function rotateWisp(): Promise<{ url: string; rtt: number }> {
  if (!controller || !currentOptions) throw new Error('Proxy is not ready')
  const endpoints = await endpointsFor(currentOptions)
  const at = activeWisp ? endpoints.indexOf(activeWisp) : -1
  const next = await selectWisp(endpoints, at + 1)
  controller.setTransport(await makeTransport(next.url, currentOptions.transport))
  if (next.url !== activeWisp) log('info', `Switched to Wisp server ${hostOf(next.url)}`)
  activeWisp = next.url
  return next
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export const activeWispUrl = () => activeWisp

export function scheduleProbe(delay: number) {
  if (probeTimer) clearTimeout(probeTimer)
  probeTimer = window.setTimeout(() => void checkConnection(), delay)
}

/** Health check. Recovers a dropped connection by swapping in a fresh transport, without a reload. */
export async function checkConnection(): Promise<void> {
  if (!controller || !currentOptions || probing) return
  if (info.state === 'connecting' || info.state === 'error') return
  probing = true
  try {
    if (!navigator.onLine) throw new Error('This device is offline')
    let rtt: number
    try {
      rtt = await probeWisp(activeWisp ?? (await endpointsFor(currentOptions))[0])
      if (info.state === 'disconnected' || info.state === 'reconnecting') {
        log('info', 'Wisp reachable again; creating a fresh transport')
        const at = activeWisp ?? (await endpointsFor(currentOptions))[0]
        controller.setTransport(await makeTransport(at, currentOptions.transport))
      }
    } catch (e) {
      // the active endpoint is down (or blocked): try the others before backing off
      if ((await endpointsFor(currentOptions)).length < 2) throw e
      rtt = (await rotateWisp()).rtt
    }
    retryDelay = 2000
    setConnection('connected', '', rtt)
    scheduleProbe(PROBE_INTERVAL_MS)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (info.state !== 'disconnected' && info.state !== 'reconnecting') log('warn', `Connection lost: ${message}`)
    setConnection(info.state === 'connected' ? 'reconnecting' : 'disconnected', message, null)
    scheduleProbe(retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30_000)
  } finally {
    probing = false
  }
}

window.addEventListener('online', () => void checkConnection())
window.addEventListener('offline', () => setConnection('disconnected', 'This device is offline', null))
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void checkConnection()
})

async function registerServiceWorker(timeoutMs = 10_000): Promise<ServiceWorker> {
  // updateViaCache 'none': neither sw.js nor the scripts it imports may come from the HTTP cache
  try {
    swRegistration = await navigator.serviceWorker.register(SW_URL, { updateViaCache: 'none' })
  } catch (e) {
    // offline launch: if the browser insists on fetching sw.js, the installed worker still serves the shell
    const existing = await navigator.serviceWorker.getRegistration(BASE)
    if (!existing?.active) throw e
    swRegistration = existing
  }
  if (!navigator.serviceWorker.controller) {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }
  const sw = navigator.serviceWorker.controller ?? swRegistration.active
  if (!sw) throw new Error('The service worker did not activate. Service workers need HTTPS (or localhost).')
  return sw
}

export function serviceWorkerStatus(): string {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  if (!swRegistration) return 'not registered'
  if (swRegistration.active) return navigator.serviceWorker.controller ? 'active (controlling)' : 'active'
  if (swRegistration.installing) return 'installing'
  if (swRegistration.waiting) return 'waiting'
  return 'registered'
}

/** Versioned engine URLs, so every document and worker thread loads exactly the build that is deployed. */
const engineFiles = () => ({
  // the folder Shasta is served from: proxied pages live under it (the service worker's scope)
  prefix: `${BASE}~/sj/`,
  scramjetPath: `${BASE}scramjet/scramjet.js?v=${__ENGINE_VERSION__}`,
  injectPath: `${BASE}controller/controller.inject.js?v=${__ENGINE_VERSION__}`,
  wasmPath: `${BASE}scramjet/scramjet.wasm?v=${__ENGINE_VERSION__}`,
})

/** The engine's own config: on a shared origin, sites' logins and storage stay in the tab (lib/sharedOrigin.ts). */
const scramjetConfigFor = (defaults: unknown) => {
  const scope = storageScope()
  return scope ? { ...(defaults as object), storageScope: scope } : defaults
}

/** Registers the service worker and boots the controller. Safe to call repeatedly. */
export function init(options: ProxyOptions): Promise<void> {
  if (!initPromise) {
    currentOptions = options
    setConnection('connecting', 'Starting the proxy engine')
    initPromise = (async () => {
      if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.')
      const [serviceworker] = await Promise.all([registerServiceWorker(), loadEngine()])
      const { Controller } = engine!.controller
      const { defaultConfig } = engine!.scramjet
      // a dead Wisp server should not stop the shell from booting; it surfaces as "disconnected"
      let transport: Awaited<ReturnType<typeof makeTransport>>
      const endpoints = await endpointsFor(options)
      try {
        const { url } = await selectWisp(endpoints)
        transport = await makeTransport(url, options.transport)
        activeWisp = url
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        log('warn', `Initial connection failed: ${message}`)
        activeWisp = endpoints[0] ?? null
        const placeholder = new (await import('@mercuryworkshop/libcurl-transport')).default({ wisp: normalizeWispUrl(options.wispUrl) })
        controller = new Controller({ serviceworker, transport: placeholder, scramjetConfig: scramjetConfigFor(defaultConfig), config: engineFiles() })
        await controller.wait()
        setConnection('disconnected', message, null)
        scheduleProbe(retryDelay)
        return
      }
      controller = new Controller({ serviceworker, transport, scramjetConfig: scramjetConfigFor(defaultConfig), config: engineFiles() })
      await controller.wait()
      setConnection('connected', '', null)
      log('info', `Proxy ready (${options.transport})`)
      scheduleProbe(500)
    })()
    initPromise.catch((e) => {
      initPromise = null
      const message = e instanceof Error ? e.message : String(e)
      log('error', `Proxy failed to start: ${message}`)
      setConnection('error', message, null)
    })
  }
  return initPromise
}

/** Applies new transport settings live (no page reload). */
export async function applyOptions(options: ProxyOptions): Promise<void> {
  currentOptions = options
  if (!controller) return
  setConnection('reconnecting', 'Applying new connection settings')
  retryDelay = 2000
  try {
    const { url } = await selectWisp(await endpointsFor(options))
    controller.setTransport(await makeTransport(url, options.transport))
    activeWisp = url
    setConnection('connected', '', null)
    log('info', `Transport switched to ${options.transport}`)
    scheduleProbe(500)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    setConnection('disconnected', message, null)
    scheduleProbe(retryDelay)
  }
}

export async function reconnect(options?: ProxyOptions): Promise<void> {
  if (options) currentOptions = options
  if (!currentOptions) return
  if (!initPromise || info.state === 'error') {
    // the engine never started (or failed to): run the whole boot again
    initPromise = null
    return init(currentOptions)
  }
  setConnection('reconnecting', 'Reconnecting')
  retryDelay = 2000
  await applyOptions(currentOptions)
}

export const isReady = () => controller !== null

// ---- frames -----------------------------------------------------------------------------

export function clearNavTimer(entry: Entry) {
  if (entry.navTimer) clearTimeout(entry.navTimer)
  entry.navTimer = null
}

/** A navigation that never produces a `load` must not leave the tab spinning forever. */
export function armNavTimer(entry: Entry, ms: number, isError: boolean) {
  clearNavTimer(entry)
  entry.navTimer = window.setTimeout(() => {
    entry.navTimer = null
    if (isError) {
      try {
        entry.iframe.contentWindow?.stop()
      } catch {
        /* cross-origin error page */
      }
      entry.events.failed({ message: 'The site took too long to respond.', url: entry.lastUrl })
    } else if (!entry.committed) {
      // we guessed a navigation from beforeunload and it never happened (cancelled, download, mailto:)
      entry.events.loaded()
    }
  }, ms)
}

function readDocument(entry: Entry): Document | null {
  try {
    const doc = entry.iframe.contentDocument
    return doc && doc.location.href !== 'about:blank' ? doc : null
  } catch {
    return null
  }
}

function handleLoad(entry: Entry) {
  clearNavTimer(entry)
  let doc: Document | null = null
  let crossOrigin = false
  try {
    doc = entry.iframe.contentDocument
  } catch {
    crossOrigin = true
  }
  if (crossOrigin || (doc === null && entry.iframe.contentWindow !== null)) {
    // the browser's own error page (chrome-error://) is not readable from the shell
    entry.events.failed({ message: 'The browser could not load this page.', url: entry.lastUrl })
    return
  }
  if (!doc || doc.location.href === 'about:blank') return
  const marker = doc.querySelector(`meta[name="${ERROR_META}"]`)
  if (marker) {
    entry.events.failed({
      message: marker.getAttribute('content') ?? 'Unknown error',
      url: doc.querySelector('meta[name="shasta-error-url"]')?.getAttribute('content') ?? entry.lastUrl,
    })
    return
  }
  entry.events.loaded()
  pollTitle(entry, true)
  void loadFavicon(entry, doc)
}

function pollTitle(entry: Entry, force = false) {
  const doc = readDocument(entry)
  if (!doc || doc.querySelector(`meta[name="${ERROR_META}"]`)) return
  const title = doc.title?.trim()
  if (title && (force || title !== entry.lastTitle)) {
    entry.lastTitle = title
    entry.events.title(title)
  }
}

async function loadFavicon(entry: Entry, doc: Document) {
  try {
    const link = doc.querySelector<HTMLLinkElement>('link[rel~="icon" i], link[rel="shortcut icon" i]')
    // `href` goes through Scramjet's hooks, so this is the real (unproxied) address of the icon
    const origin = new URL(entry.lastUrl).origin
    const href = link?.href || `${origin}/favicon.ico`
    if (faviconCache.has(href)) {
      const hit = faviconCache.get(href)
      if (hit) entry.events.favicon(origin, hit)
      return
    }
    faviconCache.set(href, null)
    // Same-site icons are fetched by the page's own (hooked) fetch, so Scramjet sees an ordinary page request.
    // Fetching from the shell instead works too, but makes Scramjet log an "unrewriteurl" error for the shell URL.
    let res: Response
    if (new URL(href).origin === origin && entry.iframe.contentWindow) {
      res = await entry.iframe.contentWindow.fetch(href, { credentials: 'omit' })
    } else {
      const proxied = engine!.scramjet.rewriteUrl(href, entry.frame.context, { origin: new URL(location.href), base: new URL(location.href) })
      res = await fetch(proxied, { credentials: 'omit' })
    }
    if (!res.ok) return
    const blob = await res.blob()
    if (blob.size === 0 || blob.size > MAX_FAVICON_BYTES || !blob.type.startsWith('image/')) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    if (faviconCache.size > 200) faviconCache.delete(faviconCache.keys().next().value!)
    faviconCache.set(href, dataUrl)
    if (byTab.get(entry.tabId) === entry) entry.events.favicon(origin, dataUrl)
  } catch {
    /* favicons are best effort */
  }
}

function ensureTitlePolling() {
  if (titleTimer) return
  // pages change <title> after load (SPAs); one shared timer covers every tab
  titleTimer = window.setInterval(() => {
    if (document.hidden) return
    byTab.forEach((entry) => pollTitle(entry))
  }, 1200)
}

/**
 * Proxies an <iframe> that lives inside one of Shasta's own pages (e.g. a Watch embed player) rather than filling a
 * tab. It is a full proxied frame with its own plugin instance, so adblock and the ad cosmetics apply to it too.
 * `id` is a synthetic frame id: pass it to `releaseSubFrame` when the element goes away.
 */
let subSeq = 0
const SUB_EVENTS: FrameEvents = {
  navStart: () => {},
  url: () => {},
  title: () => {},
  favicon: () => {},
  loaded: () => {},
  failed: () => {},
  key: () => {},
  contextMenu: () => {},
}

export function proxySubFrame(iframe: HTMLIFrameElement, url: string): string {
  const id = `sub:${++subSeq}`
  attach(id, iframe, SUB_EVENTS)
  go(id, url)
  return id
}

export const releaseSubFrame = (id: string) => detach(id)

/**
 * Binds a proxied frame to an <iframe>. Returns true when a new frame was created (the caller
 * should then navigate it), false when the iframe was already bound (e.g. React StrictMode remount).
 */
export function attach(tabId: string, iframe: HTMLIFrameElement, events: FrameEvents): boolean {
  if (!controller) throw new Error('Proxy is not ready')
  const existing = byIframe.get(iframe)
  if (existing) {
    if (existing.disposeTimer) clearTimeout(existing.disposeTimer)
    existing.disposeTimer = null
    existing.events = events
    byTab.set(tabId, existing)
    return false
  }
  const frame = controller.createFrame(iframe, { plugins: [engine!.plugin.createPlugin(tabId)] })
  const entry: Entry = {
    tabId,
    frame,
    iframe,
    events,
    onLoad: () => handleLoad(entry),
    timers: new Set(),
    navTimer: null,
    disposeTimer: null,
    lastTitle: '',
    lastUrl: '',
    committed: false,
  }
  iframe.addEventListener('load', entry.onLoad)
  byTab.set(tabId, entry)
  byIframe.set(iframe, entry)
  ensureTitlePolling()
  return true
}

function dispose(entry: Entry) {
  clearNavTimer(entry)
  entry.iframe.removeEventListener('load', entry.onLoad)
  entry.timers.forEach(clearTimeout)
  if (byTab.get(entry.tabId) === entry) byTab.delete(entry.tabId)
  byIframe.delete(entry.iframe)
  if (controller) controller.frames = controller.frames.filter((f) => f !== entry.frame)
  if (!byTab.size && titleTimer) {
    clearInterval(titleTimer)
    titleTimer = null
  }
}

/** Releases a tab's frame. Deferred a tick so a synchronous re-attach (StrictMode) keeps the frame. */
export function detach(tabId: string) {
  if (direct.owns(tabId)) return direct.detach(tabId)
  const entry = byTab.get(tabId)
  if (!entry) return
  if (entry.disposeTimer) clearTimeout(entry.disposeTimer)
  entry.disposeTimer = window.setTimeout(() => dispose(entry), 100)
}

export const hasFrame = (tabId: string) => byTab.has(tabId) || direct.owns(tabId)

export function go(tabId: string, url: string) {
  if (direct.owns(tabId)) return direct.go(tabId, url)
  const entry = byTab.get(tabId)
  if (!entry) return
  entry.committed = false
  entry.lastUrl = url
  entry.events.navStart({ committed: false })
  armNavTimer(entry, NAV_TIMEOUT_MS, true)
  entry.frame.go(url)
}

export function back(tabId: string) {
  if (direct.owns(tabId)) return direct.back(tabId)
  const entry = byTab.get(tabId)
  if (!entry) return
  entry.events.navStart({ committed: false })
  armNavTimer(entry, TENTATIVE_NAV_MS, false)
  entry.frame.back()
}

export function forward(tabId: string) {
  if (direct.owns(tabId)) return direct.forward(tabId)
  const entry = byTab.get(tabId)
  if (!entry) return
  entry.events.navStart({ committed: false })
  armNavTimer(entry, TENTATIVE_NAV_MS, false)
  entry.frame.forward()
}

/** Reloads the current document. Returns false when the frame cannot reload itself. */
export function reload(tabId: string): boolean {
  if (direct.owns(tabId)) return direct.reload(tabId)
  const entry = byTab.get(tabId)
  if (!entry) return false
  try {
    entry.events.navStart({ committed: false })
    armNavTimer(entry, NAV_TIMEOUT_MS, true)
    entry.frame.reload()
    return true
  } catch {
    clearNavTimer(entry)
    return false
  }
}

export function print(tabId: string) {
  if (direct.owns(tabId)) return direct.print(tabId)
  try {
    byTab.get(tabId)?.iframe.contentWindow?.print()
  } catch {
    /* page not printable */
  }
}

export function stop(tabId: string) {
  if (direct.owns(tabId)) return direct.stop(tabId)
  const entry = byTab.get(tabId)
  if (!entry) return
  clearNavTimer(entry)
  try {
    entry.iframe.contentWindow?.stop()
  } catch {
    /* cross-origin error page: nothing to stop */
  }
  entry.events.loaded()
}

/** Drops cached favicons and other in-memory state (used by "clear site data"). */
export function clearCaches() {
  faviconCache.clear()
}

/**
 * Clears what proxied sites stored: cookies (Scramjet's jar), their localStorage/sessionStorage
 * (Scramjet namespaces those as "host@key" in this origin) and any IndexedDB databases that are not Shasta's.
 */
export async function clearSiteData(): Promise<void> {
  await direct.clearData()
  if (controller) {
    controller.cookieJar.clear()
    await controller.persistCookies()
  }
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) {
      if (key.includes('@') && !key.startsWith('shasta-')) storage.removeItem(key)
    }
  }
  const keep = new Set(['shasta', '__scramjet_controller'])
  const dbs = (await indexedDB.databases?.()) ?? []
  await Promise.all(
    dbs
      .filter((d) => d.name && !keep.has(d.name))
      .map(
        (d) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(d.name!)
            req.onsuccess = req.onerror = req.onblocked = () => resolve()
          }),
      ),
  )
  faviconCache.clear()
}

export interface SiteDataEntry {
  host: string
  cookies: number
  /** localStorage + sessionStorage keys Scramjet namespaced for this site */
  storageKeys: number
}

/** `host@key` is how Scramjet namespaces a site's web storage in Shasta's own origin (`\u0001Lhost@key` for a site's
 *  localStorage kept in sessionStorage on a shared origin, lib/sharedOrigin.ts). */
const storageHost = (key: string) => (key.includes('@') && !key.startsWith('shasta-') ? key.slice(key.startsWith('\u0001L') ? 2 : 0, key.indexOf('@')) : null)
const cookieHost = (id: string) => id.slice(0, id.indexOf('@')).replace(/^\./, '')

/**
 * What sites have stored, as counts only (no names or values), grouped by host. Cookies come from the controller's jar
 * (the supported dump()); the UI never receives cookie contents.
 */
export function listSiteData(): SiteDataEntry[] {
  const hosts = new Map<string, SiteDataEntry>()
  const entry = (host: string) => {
    let e = hosts.get(host)
    if (!e) hosts.set(host, (e = { host, cookies: 0, storageKeys: 0 }))
    return e
  }
  if (controller) {
    try {
      for (const id of Object.keys(JSON.parse(controller.cookieJar.dump()))) entry(cookieHost(id)).cookies++
    } catch {
      /* unreadable jar: list storage only */
    }
  }
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) {
      const h = storageHost(key)
      if (h) entry(h).storageKeys++
    }
  }
  return [...hosts.values()].sort((a, b) => a.host.localeCompare(b.host))
}

export interface CookieInfo {
  name: string
  domain: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
  /** ms since epoch, or null for a session cookie */
  expires: number | null
}

/**
 * Metadata of the cookies a site (and its parent domains) holds, for the site-information popover. Names and flags only:
 * values never leave the adapter.
 */
export function listCookies(host: string): CookieInfo[] {
  if (!controller) return []
  try {
    const all = JSON.parse(controller.cookieJar.dump()) as Record<string, { name?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: string; expires?: number }>
    return Object.entries(all)
      .filter(([id]) => {
        const h = cookieHost(id)
        return h === host || host.endsWith(`.${h}`)
      })
      .map(([id, c]) => ({ name: String(c.name ?? ''), domain: c.domain ?? cookieHost(id), secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: String(c.sameSite ?? ''), expires: typeof c.expires === 'number' ? c.expires : null }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** Removes one site's cookies (including those set for its parent domain, e.g. `.example.com`) and web storage. */
export async function clearSiteDataFor(host: string): Promise<void> {
  if (controller) {
    const all = JSON.parse(controller.cookieJar.dump()) as Record<string, unknown>
    const kept = Object.fromEntries(Object.entries(all).filter(([id]) => cookieHost(id) !== host))
    controller.cookieJar.load(JSON.stringify(kept))
    await controller.persistCookies()
  }
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) if (storageHost(key) === host) storage.removeItem(key)
  }
}

export async function updateServiceWorker(): Promise<void> {
  await swRegistration?.update()
}
