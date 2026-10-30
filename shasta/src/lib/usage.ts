// Anonymous usage counters (Settings -> Privacy -> "Share anonymous usage counts"). Sends only a feature name or the
// HOSTNAME of a site that was opened: no path, query, title, identifier or cookie, nothing from private tabs. The server
// keeps a running total per day (server/src/services/usage.ts). Fire and forget; failing changes nothing for the visitor.
// The same names also go to the stats dashboard (lib/stats.ts) when the build has one.
import { api } from '@/store/api'
import { getSettings } from '@/stores/settingsStore'
import { track } from './stats'

type Item = ['site' | 'event', string]
const FLUSH_MS = 15_000
let queue: Item[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function flush() {
  timer = undefined
  const items = queue.splice(0, 50)
  if (items.length) void api.post('/api/usage', { items }).catch(() => undefined)
  if (queue.length) timer = setTimeout(flush, FLUSH_MS)
}

function push(item: Item) {
  if (import.meta.env.MODE === 'test' || !getSettings().usageStats) return
  if (queue.length < 200) queue.push(item)
  timer ??= setTimeout(flush, FLUSH_MS)
}

/** A named feature was used, e.g. `page.store`, `ai.panel`, `app.launch`. Also an event on the stats dashboard. */
export function trackEvent(name: string) {
  push(['event', name.toLowerCase()])
  track(name.toLowerCase())
}

/** A site was opened. Only the hostname is kept; internal pages and private tabs are never passed here. */
export function trackSite(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
    const host = u.hostname.replace(/^www\./, '')
    push(['site', host])
    track('site', { host })
  } catch {
    /* not a URL */
  }
}

if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => {
    if (queue.length) flush()
  })
}
