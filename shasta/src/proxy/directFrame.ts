// The direct page engine: a <controlledframe> per tab, only in the installed app (an Isolated Web App).
//
// A controlled frame loads the real site in its own storage partition, under the site's own security policy, so
// it runs pages the proxy cannot run in the app (sites that call eval/new Function; see docs/on-device-wisp.md).
// It speaks the same contract as a proxied frame (`FrameEvents`, go/back/forward/reload/stop/print), so tabs do
// not know which engine they have. The connection goes from the device to the site, like the on-device relay.
import type { FrameEvents } from './scramjetAdapter'
import { emit } from './scramjetAdapter'
import { guestScript } from './directGuest'
import { isAdPopup, loadAdBlocker } from '@/lib/adBlock'
import type { PageAccess } from '@/stores/settingsStore'

/** The parts of `HTMLControlledFrameElement` Shasta uses (Chrome 156). */
export interface ControlledFrame extends HTMLElement {
  src: string
  partition: string
  readonly contentWindow: Window | null
  back(): Promise<boolean>
  forward(): Promise<boolean>
  reload(): void
  stop(): void
  print(): void
  executeScript(details: { code: string }): Promise<unknown[]>
  addContentScripts(scripts: unknown[]): Promise<void>
  clearData(options: { since: number }, types: Record<string, boolean>): Promise<void>
}

interface Entry {
  tabId: string
  el: ControlledFrame
  events: FrameEvents
  token: string
  text: string
  selection: string
  disposeTimer: number | null
  listeners: [string, EventListener][]
  /** read on every request, so a change in Settings applies at once */
  access: () => PageAccess
}

/** Shared by every normal tab; a private tab gets an in-memory partition of its own. */
export const PERSISTENT_PARTITION = 'persist:shasta-web'
export const partitionFor = (tabId: string, isPrivate: boolean) => (isPrivate ? `private-${tabId}` : PERSISTENT_PARTITION)

/** True in the installed app, where Chrome provides <controlledframe>. */
export const available = (): boolean => typeof (globalThis as { HTMLControlledFrameElement?: unknown }).HTMLControlledFrameElement === 'function'

const byTab = new Map<string, Entry>()
const byEl = new WeakMap<ControlledFrame, Entry>()

export const owns = (tabId: string) => byTab.has(tabId)

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

// Chrome's network error names, said the way a person would understand them
const FRIENDLY: Record<string, string> = {
  ERR_NAME_NOT_RESOLVED: "That address doesn't exist, or this device can't look it up.",
  ERR_INTERNET_DISCONNECTED: 'This device is offline.',
  ERR_CONNECTION_REFUSED: 'The site refused the connection.',
  ERR_CONNECTION_TIMED_OUT: 'The site took too long to answer.',
  ERR_CONNECTION_RESET: 'The connection was interrupted.',
  ERR_CERT_AUTHORITY_INVALID: "The site's certificate is not trusted.",
  ERR_BLOCKED_BY_ADMINISTRATOR: 'Your administrator blocks this site.',
  ERR_BLOCKED_BY_CLIENT: 'This site was blocked on this device.',
}

function onMessage(e: MessageEvent) {
  const d = e.data as { $shasta?: string; type?: string; [k: string]: unknown } | null
  if (!d || typeof d !== 'object' || typeof d.$shasta !== 'string') return
  for (const entry of byTab.values()) {
    if (e.source !== entry.el.contentWindow || d.$shasta !== entry.token) continue
    handleGuest(entry, d)
    return
  }
}

function handleGuest(entry: Entry, d: Record<string, unknown>) {
  const { events } = entry
  switch (d.type) {
    case 'state':
      if (typeof d.url === 'string' && /^https?:/.test(d.url)) events.url(d.url)
      if (typeof d.title === 'string' && d.title) events.title(d.title.slice(0, 500))
      break
    case 'favicon':
      if (typeof d.origin === 'string' && typeof d.dataUrl === 'string' && d.dataUrl.startsWith('data:image/')) events.favicon(d.origin, d.dataUrl)
      break
    case 'text':
      if (typeof d.text === 'string') entry.text = d.text
      break
    case 'selection':
      if (typeof d.text === 'string') entry.selection = d.text
      break
    case 'key':
      events.key(
        new KeyboardEvent('keydown', {
          key: String(d.key),
          code: String(d.code),
          ctrlKey: !!d.ctrlKey,
          metaKey: !!d.metaKey,
          altKey: !!d.altKey,
          shiftKey: !!d.shiftKey,
          repeat: !!d.repeat,
          cancelable: true,
        }),
      )
      break
    case 'context': {
      const r = entry.el.getBoundingClientRect()
      const str = (v: unknown) => (typeof v === 'string' && /^https?:/.test(v) ? v : null)
      const selection = typeof d.selection === 'string' ? d.selection : ''
      events.contextMenu({
        x: r.left + Number(d.x || 0),
        y: r.top + Number(d.y || 0),
        linkUrl: str(d.linkUrl),
        imageUrl: str(d.imageUrl),
        selection,
        editable: !!d.editable,
        win: null,
        element: null,
        imageElement: null,
        inPage: true,
        exec: (cmd) => exec(entry, cmd, selection),
      })
      break
    }
  }
}

/** Clipboard commands for a right-click in a direct tab: the shell holds the user's click, so it owns the clipboard. */
async function exec(entry: Entry, cmd: 'cut' | 'copy' | 'paste' | 'selectAll', selection: string) {
  const post = (m: object) => entry.el.contentWindow?.postMessage(m, '*')
  if (cmd === 'copy' || cmd === 'cut') {
    if (selection) await navigator.clipboard.writeText(selection)
    if (cmd === 'cut') post({ cmd: 'exec', op: 'cut' })
  } else if (cmd === 'paste') {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      throw new Error('Shasta was not allowed to read the clipboard. Use the Paste keyboard shortcut instead.')
    }
    post({ cmd: 'exec', op: 'paste', text })
  } else post({ cmd: 'exec', op: 'selectAll' })
}

/** Grants what Settings → Privacy allows; Chrome still asks the person for camera, microphone and location. */
function permission(access: PageAccess, e: Event & { permission?: string; request?: { allow(): void; deny(): void } }) {
  const ok: Record<string, boolean> = {
    media: access.camera || access.microphone,
    geolocation: access.location,
    hid: access.devices,
    // a game needs the pointer and fullscreen; files are saved by the browser's own download flow
    pointerLock: true,
    fullscreen: true,
    download: true,
  }
  if (e.permission && ok[e.permission]) e.request?.allow()
  else e.request?.deny()
}

/**
 * Binds a direct tab to its <controlledframe>. Returns true when the frame is new (the caller then navigates it),
 * false when it was already bound (React StrictMode remount). The partition must be set before the first navigation.
 */
export function attach(tabId: string, el: ControlledFrame, events: FrameEvents, access: () => PageAccess): boolean {
  const existing = byEl.get(el)
  if (existing) {
    if (existing.disposeTimer) clearTimeout(existing.disposeTimer)
    existing.disposeTimer = null
    existing.events = events
    existing.access = access
    byTab.set(tabId, existing)
    return false
  }
  const entry: Entry = { tabId, el, events, token: token(), text: '', selection: '', disposeTimer: null, listeners: [], access }
  const on = (type: string, fn: (e: never) => void) => {
    el.addEventListener(type, fn as EventListener)
    entry.listeners.push([type, fn as EventListener])
  }
  type Load = Event & { url?: string; isTopLevel?: boolean; reason?: string }
  on('loadstart', (e: Load) => {
    if (e.isTopLevel === false) return
    entry.text = ''
    entry.selection = ''
    entry.events.navStart({ committed: false })
  })
  on('loadcommit', (e: Load) => {
    if (e.isTopLevel === false || !e.url) return
    entry.events.navStart({ committed: true })
    if (/^https?:/.test(e.url)) entry.events.url(e.url)
  })
  // the guest is in place once the document exists: say hello so it knows where to report
  on('contentload', () => el.contentWindow?.postMessage({ $shastaHello: true }, '*'))
  on('loadstop', () => {
    entry.events.loaded()
    el.contentWindow?.postMessage({ $shastaHello: true }, '*')
  })
  on('loadabort', (e: Load) => {
    // ERR_ABORTED is a navigation replaced by another one (or stopped): not a failure
    if (e.isTopLevel === false || e.reason === 'ERR_ABORTED') return
    const reason = e.reason ?? 'ERR_FAILED'
    entry.events.failed({ message: FRIENDLY[reason] ?? `The page could not be loaded (${reason}).`, url: e.url ?? '' })
  })
  on('newwindow', (e: Event & { targetUrl?: string; window?: { discard(): void } }) => {
    // popups become tabs, as with proxied pages
    e.window?.discard()
    if (!e.targetUrl || !/^https?:/.test(e.targetUrl)) return
    // the browser already requires a click for these; ad hosts are refused on top (lib/adBlock.ts)
    const target = e.targetUrl
    void loadAdBlocker().then(() => {
      if (isAdPopup(new URL(target))) emit({ type: 'popupBlocked', url: target, openerTabId: entry.tabId, ad: true })
      else emit({ type: 'openTab', url: target, openerTabId: entry.tabId })
    })
  })
  on('permissionrequest', (e: Parameters<typeof permission>[1]) => permission(entry.access(), e))
  void el.addContentScripts([
    {
      name: 'shasta',
      // URLPattern strings and web-style enum values ('document-start'), not Chrome apps' '<all_urls>'/'document_start'
      urlPatterns: ['https://*/*', 'http://*/*'],
      js: { code: guestScript({ token: entry.token, blockDevtools: import.meta.env.PROD && !import.meta.env.VITE_ALLOW_DEVTOOLS }) },
      runAt: 'document-start',
      allFrames: false,
    },
  ])
  byTab.set(tabId, entry)
  byEl.set(el, entry)
  if (byTab.size === 1) window.addEventListener('message', onMessage)
  return true
}

function dispose(entry: Entry) {
  for (const [type, fn] of entry.listeners) entry.el.removeEventListener(type, fn)
  if (byTab.get(entry.tabId) === entry) byTab.delete(entry.tabId)
  byEl.delete(entry.el)
  if (!byTab.size) window.removeEventListener('message', onMessage)
}

/** Releases a tab's frame. Deferred a tick so a synchronous re-attach (StrictMode) keeps it. */
export function detach(tabId: string) {
  const entry = byTab.get(tabId)
  if (!entry) return
  if (entry.disposeTimer) clearTimeout(entry.disposeTimer)
  entry.disposeTimer = window.setTimeout(() => dispose(entry), 100)
}

export function go(tabId: string, url: string) {
  const entry = byTab.get(tabId)
  if (!entry) return
  entry.events.navStart({ committed: false })
  entry.el.src = url
}

export const back = (tabId: string) => void byTab.get(tabId)?.el.back()
export const forward = (tabId: string) => void byTab.get(tabId)?.el.forward()

export function reload(tabId: string): boolean {
  const entry = byTab.get(tabId)
  if (!entry) return false
  entry.el.reload()
  return true
}

export function stop(tabId: string) {
  const entry = byTab.get(tabId)
  if (!entry) return
  entry.el.stop()
  entry.events.loaded()
}

export const print = (tabId: string) => byTab.get(tabId)?.el.print()

/** The page's readable text, as the guest last reported it (for the assistant). */
export const pageText = (tabId: string): string | null => byTab.get(tabId)?.text ?? null
export const selectionOf = (tabId: string): string => byTab.get(tabId)?.selection ?? ''

/** Clears cookies, storage and caches of every direct tab (Settings → clear site data). */
export async function clearData(): Promise<void> {
  if (!available()) return
  // clearData acts on the frame's partition: a hidden frame reaches the shared one even with no tab open
  const el = document.createElement('controlledframe') as ControlledFrame
  el.setAttribute('partition', PERSISTENT_PARTITION)
  el.style.display = 'none'
  document.body.append(el)
  try {
    await el.clearData({ since: 0 }, { appcache: true, cache: true, cookies: true, fileSystems: true, indexedDB: true, localStorage: true, persistentCookies: true, sessionCookies: true, serviceWorkers: true, webSQL: true })
  } finally {
    el.remove()
  }
}
