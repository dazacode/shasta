// Shasta's own stats dashboard: Umami (MIT, self-hosted on the VPS, scripts/vps/umami.service). Page views, visits,
// realtime, journeys and events for every host Shasta runs on (the Pages site and Shasta Lite), told apart by hostname.
// Part of "Share anonymous usage counts" (settings.usageStats): when that is off the script is never loaded, and turning
// it off later stops it at once. Never in private tabs (callers skip them), never in the installed app (its CSP allows
// no remote script), never in tests. Only on builds that name a server: VITE_STATS_URL (https) + VITE_STATS_WEBSITE_ID.
//
// Events anywhere: `track('name', {key: 'value'})` in code, or `data-umami-event="name"` (plus `data-umami-event-<key>`
// for properties) on any element in Shasta's own UI. Never put typed text, a full URL, a page title or an id in one.
import { getSettings, useSettings } from '@/stores/settingsStore'
import { inInstalledApp } from './shastaApp'

type Umami = {
  track: (nameOrProps?: string | ((p: Record<string, unknown>) => Record<string, unknown>), data?: Record<string, unknown>) => void
}

const url = (v: unknown) => (typeof v === 'string' && v.startsWith('https://') ? v.replace(/\/+$/, '') : '')
const STATS_URL = url(import.meta.env.VITE_STATS_URL)
const WEBSITE = typeof import.meta.env.VITE_STATS_WEBSITE_ID === 'string' ? import.meta.env.VITE_STATS_WEBSITE_ID.trim() : ''
const AVAILABLE = !!STATS_URL && !!WEBSITE && import.meta.env.MODE !== 'test' && typeof document !== 'undefined' && !inInstalledApp()

// calls made before the script arrives (it loads after first paint)
const pending: Array<(u: Umami) => void> = []
let loading = false

const umami = (): Umami | undefined => (window as unknown as { umami?: Umami }).umami
const enabled = () => AVAILABLE && getSettings().usageStats

function call(fn: (u: Umami) => void) {
  if (!enabled()) return
  const u = umami()
  if (u) fn(u)
  else if (pending.length < 100) pending.push(fn)
}

// the tracker's own off switch, read on every send: covers the clicks it records by itself (data-umami-event)
function setDisabled(off: boolean) {
  try {
    if (off) localStorage.setItem('umami.disabled', '1')
    else localStorage.removeItem('umami.disabled')
  } catch {
    /* storage blocked: our own calls are still gated by the setting */
  }
}

function load() {
  if (loading || !enabled()) return
  loading = true
  setDisabled(false)
  const s = document.createElement('script')
  s.defer = true
  s.src = `${STATS_URL}/s.js`
  s.dataset.websiteId = WEBSITE
  s.dataset.hostUrl = STATS_URL
  // the start page is "/" whatever query opened it (?app=, ?online): no query or hash is sent
  s.dataset.excludeSearch = 'true'
  s.dataset.excludeHash = 'true'
  s.onload = () => {
    const u = umami()
    if (u) for (const fn of pending.splice(0)) fn(u)
  }
  s.onerror = () => {
    pending.length = 0
  }
  document.head.appendChild(s)
}

/** Once at startup: loads the tracker when allowed, and follows the setting from then on. */
export function startStats() {
  if (!AVAILABLE) return
  const go = () => setTimeout(load, 1000)
  if (document.readyState === 'complete') go()
  else addEventListener('load', go, { once: true })
  useSettings.subscribe((s, prev) => {
    if (s.settings.usageStats === prev.settings.usageStats) return
    setDisabled(!s.settings.usageStats)
    if (s.settings.usageStats) load()
    else pending.length = 0
  })
  if (!getSettings().usageStats) setDisabled(true)
}

/** A custom event, e.g. `track('store.install', { kind: 'game' })`. Values must not identify anyone. */
export function track(name: string, data?: Record<string, string | number | boolean>) {
  call((u) => u.track(name, data))
}

/** A page view for one of Shasta's own pages (`/store`, `/settings`), so journeys and realtime show where people are. */
export function trackPage(path: string) {
  call((u) => u.track((p) => ({ ...p, url: path, title: `Shasta ${path}` })))
}
