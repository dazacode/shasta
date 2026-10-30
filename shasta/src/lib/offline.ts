// The page side of the offline application shell (public/sw.js). Asks the service worker what is cached, drives
// "Download for offline use" one file at a time (so an interrupted download resumes where it stopped, and no single
// service-worker event runs for long), asks the browser to keep the data, and applies updates.
//
// Offline here means Shasta itself: its interface, settings, bookmarks, history, the library and AI models already
// on the device. Opening websites always needs a network and a reachable Wisp relay.

import { BASE, LITE } from './edition'

export type OfflineGroup = 'core' | 'ai'

export interface OfflineFile {
  url: string
  size: number
  group: OfflineGroup
  cached: boolean
}

export interface ShellStatus {
  /** false in a dev build (`bun run dev`): the shell is never cached there */
  enabled: boolean
  version: string | null
  app: string | null
  files: OfflineFile[]
  /** why the file list could not be read (e.g. offline before anything was downloaded) */
  error: { code: string; message: string } | null
}

export interface GroupSummary {
  files: number
  bytes: number
  cachedFiles: number
  cachedBytes: number
  complete: boolean
}

export interface DownloadProgress {
  /** bytes of the requested groups already on the device */
  done: number
  total: number
}

export class OfflineError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Errors that a later attempt can get past on its own (a dropped connection, a stalled or restarted worker). */
export const isRetryable = (e: unknown) => e instanceof OfflineError && ['network', 'stalled', 'http', 'no-worker'].includes(e.code)

export function summarize(files: OfflineFile[], group: OfflineGroup): GroupSummary {
  const list = files.filter((f) => f.group === group)
  const cached = list.filter((f) => f.cached)
  const bytes = (l: OfflineFile[]) => l.reduce((n, f) => n + f.size, 0)
  return { files: list.length, bytes: bytes(list), cachedFiles: cached.length, cachedBytes: bytes(cached), complete: list.length > 0 && cached.length === list.length }
}

const STALL_MS = 45_000

async function activeWorker(timeoutMs = 15_000): Promise<ServiceWorker> {
  if (!('serviceWorker' in navigator)) throw new OfflineError('unsupported', 'This browser has no service workers, so Shasta cannot be kept for offline use.')
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
  const sw = reg?.active
  if (!sw) throw new OfflineError('no-worker', "Shasta's service worker is not running yet.")
  return sw
}

/** One request to the service worker; `onProgress` gets byte counts while a file downloads. */
function ask<T>(sw: ServiceWorker, msg: Record<string, unknown>, onProgress?: (received: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel()
    let timer = 0
    const arm = () => {
      clearTimeout(timer)
      // a worker that was stopped mid-download never answers: give up and let the caller retry (it resumes)
      timer = window.setTimeout(() => finish(() => reject(new OfflineError('stalled', 'The download stalled.'))), STALL_MS)
    }
    const finish = (fn: () => void) => {
      clearTimeout(timer)
      port1.close()
      fn()
    }
    port1.onmessage = (e: MessageEvent) => {
      const d = e.data as { type: string; received?: number; code?: string; message?: string }
      if (d.type === 'progress') {
        arm()
        onProgress?.(d.received ?? 0)
      } else if (d.type === 'error') finish(() => reject(new OfflineError(d.code ?? 'unknown', d.message ?? 'Unknown error')))
      else finish(() => resolve(d as T))
    }
    arm()
    sw.postMessage({ $shastaOffline: msg }, [port2])
  })
}

export async function getStatus(): Promise<ShellStatus> {
  const s = await ask<ShellStatus & { type: string }>(await activeWorker(), { op: 'status' })
  return { enabled: s.enabled, version: s.version, app: s.app ?? null, files: s.files ?? [], error: s.error ?? null }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Downloads every missing file of `groups` into the offline shell, with retries. Files already cached are skipped,
 * so calling it again after an interruption continues where it stopped. Throws OfflineError (code `quota` when the
 * browser has no room, `version` when the server already has a newer Shasta).
 */
export async function download(groups: OfflineGroup[], onProgress: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<ShellStatus> {
  const status = await getStatus()
  if (!status.enabled) throw new OfflineError('dev', 'Offline use needs a production build (bun run build); the dev server is never cached.')
  if (!status.files.length) throw status.error ? new OfflineError(status.error.code, status.error.message) : new OfflineError('unknown', 'The list of files could not be read.')
  const wanted = status.files.filter((f) => groups.includes(f.group))
  const total = wanted.reduce((n, f) => n + f.size, 0)
  let done = wanted.filter((f) => f.cached).reduce((n, f) => n + f.size, 0)
  onProgress({ done, total })
  for (const file of wanted.filter((f) => !f.cached)) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new OfflineError('aborted', 'The download was stopped.')
      try {
        await ask(await activeWorker(), { op: 'cache', url: file.url }, (received) => onProgress({ done: done + Math.min(received, file.size), total }))
        break
      } catch (e) {
        if (!isRetryable(e) || attempt >= 3 || !navigator.onLine) throw e
        await sleep(1000 * 2 ** attempt)
      }
    }
    done += file.size
    file.cached = true
    onProgress({ done, total })
  }
  return { ...status, files: status.files }
}

/** Removes one group's files (the AI runtime when that setting is turned off). */
export async function dropGroup(group: OfflineGroup): Promise<void> {
  await ask(await activeWorker(), { op: 'drop', group })
}

/** Deletes every cached copy of Shasta's files. Shasta keeps working online; nothing else is touched. */
export async function clearShell(): Promise<void> {
  await ask(await activeWorker(), { op: 'clear' })
}

export interface StorageInfo {
  usage: number | null
  quota: number | null
  /** true when the browser promised not to evict Shasta's data under storage pressure */
  persisted: boolean | null
}

export async function storageInfo(): Promise<StorageInfo> {
  const s = navigator.storage
  const [estimate, persisted] = await Promise.all([s?.estimate?.().catch(() => null) ?? null, s?.persisted?.().catch(() => null) ?? null])
  return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted }
}

/**
 * Asks the browser to keep Shasta's data even when the device runs low on space. Chrome decides on its own (installed
 * apps and frequently used sites get it) and never shows a prompt; Firefox asks the person. Only call this from
 * something the person clicked.
 */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persist?.()) ?? null
  } catch {
    return null
  }
}

// ---- sign-in gates ------------------------------------------------------------------------

/**
 * True when the site answers with a redirect instead of the file, which is what an access gate (Cloudflare Access on
 * the private deployment) does once the sign-in has expired. The offline copy keeps starting without it, but updates,
 * the Store and Wisp then fail until the person signs in again at SIGN_IN_URL.
 */
export async function signInExpired(): Promise<boolean> {
  if (!navigator.onLine) return false
  try {
    const res = await fetch(`${BASE}offline-manifest.json`, { cache: 'no-store', redirect: 'manual', credentials: 'same-origin' })
    return res.type === 'opaqueredirect'
  } catch {
    return false
  }
}

/** A navigation the service worker never answers from the cache (see shellKey in sw.js). */
export const SIGN_IN_URL = '/?online'

/** Removes the `online` marker after such a navigation, so a reload is an ordinary (cached) start again. */
export function clearSignInMarker() {
  const url = new URL(location.href)
  if (!url.searchParams.has('online')) return
  url.searchParams.delete('online')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

// ---- updates ------------------------------------------------------------------------------

const UPDATE_CHECK_MS = 60 * 60_000

/**
 * Calls `onUpdated` when a new version has taken over. It is complete in its own cache by then (an update that fails
 * to download never takes over). Scramjet's worker activates new versions at once (skipWaiting + clients.claim) and
 * revives open pages, so nothing reloads by itself: this window keeps running its version (the worker keeps that
 * version's files as a fallback) until the person restarts.
 */
export function watchUpdates(onUpdated: () => void): void {
  if (!('serviceWorker' in navigator)) return
  let hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // the first visit gets its controller this way too (clients.claim); only a replacement is an update
    if (hadController) onUpdated()
    hadController = true
  })
  void navigator.serviceWorker.ready.then((reg) => {
    // an installed app can stay open for days; the browser itself only checks on navigation
    setInterval(() => {
      if (navigator.onLine) reg.update().catch(() => undefined)
    }, UPDATE_CHECK_MS)
  })
}

export type UpdateState = 'current' | 'updated' | 'failed' | 'offline' | 'signin'

export interface UpdateCheck {
  state: UpdateState
  /** the version this device runs (the active worker's), null in a dev build */
  version: string | null
  /** the version on the server */
  latest: string | null
  /** why the newest version did not install */
  error: { code: string; message: string } | null
}

async function serverVersion(): Promise<string | null | 'signin'> {
  const res = await fetch(`${BASE}offline-manifest.json`, { cache: 'no-store', redirect: 'manual', credentials: 'same-origin' })
  if (res.type === 'opaqueredirect') return 'signin'
  if (!res.ok) return null
  return ((await res.json()) as { version?: string }).version ?? null
}

/** resolves when a worker that is installing either takes over (true) or is thrown away (false) */
function settled(worker: ServiceWorker, timeoutMs = 120_000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer)
      worker.removeEventListener('statechange', onChange)
      resolve(ok)
    }
    const onChange = () => {
      if (worker.state === 'activated') done(true)
      else if (worker.state === 'redundant') done(false)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    worker.addEventListener('statechange', onChange)
    onChange()
  })
}

/**
 * Asks the server for a newer Shasta and installs it, then says how it went. An update downloads every file and checks
 * it against the build's manifest; when that fails the browser keeps the old version, which used to happen silently.
 */
export async function checkUpdate(): Promise<UpdateCheck> {
  const reg = await navigator.serviceWorker?.getRegistration()
  const info = async () => (reg?.active ? ask<{ version: string | null; lastUpdateError: ({ version: string } & UpdateCheck['error']) | null }>(reg.active, { op: 'updateInfo' }).catch(() => null) : null)
  const before = await info()
  const version = before?.version ?? null
  if (!navigator.onLine) return { state: 'offline', version, latest: null, error: null }
  // Shasta Lite has no offline shell to update, and its host caches offline-manifest.json for an hour, so comparing
  // versions would report updates that "failed": let the browser look for a new worker and leave it at that
  if (LITE) {
    await reg?.update().catch(() => undefined)
    return { state: 'current', version, latest: null, error: null }
  }
  let latest: string | null | 'signin'
  try {
    latest = await serverVersion()
  } catch {
    return { state: 'offline', version, latest: null, error: null }
  }
  if (latest === 'signin') return { state: 'signin', version, latest: null, error: null }
  // a dev build, or a server without an offline manifest: nothing to compare
  if (!version || !latest || latest === version) return { state: 'current', version, latest, error: null }
  await reg?.update().catch(() => undefined)
  const installing = reg?.installing ?? reg?.waiting
  if (installing && (await settled(installing))) return { state: 'updated', version: latest, latest, error: null }
  const after = await info()
  if (after?.version === latest) return { state: 'updated', version: latest, latest, error: null }
  const failure = after?.lastUpdateError && after.lastUpdateError.version === latest ? { code: after.lastUpdateError.code, message: after.lastUpdateError.message } : null
  return { state: 'failed', version: after?.version ?? version, latest, error: failure ?? { code: 'unknown', message: 'The browser did not install it.' } }
}

/** Kept for callers that only want the browser to look for a new version. */
export async function checkForUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration()
  await reg?.update()
}

/**
 * Starts Shasta straight from the server, skipping the copy saved on this device for this one load (also what an
 * access gate needs to sign in again). Tabs, settings and data are untouched; the saved copy updates afterwards.
 */
export function reloadFromServer() {
  location.assign(SIGN_IN_URL)
}

/** Starts the new version in this window (a worker still waiting, should there ever be one, is activated first). */
export async function applyUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration()
  if (reg?.waiting) {
    const changed = new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }))
    await ask(reg.waiting, { op: 'skipWaiting' })
    await Promise.race([changed, sleep(5000)])
  }
  location.reload()
}
