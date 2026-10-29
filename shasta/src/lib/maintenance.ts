// Background housekeeping: runs while the browser is idle, never blocks the UI, and only touches
// data Shasta owns (history older than 90 days, orphaned site icons, old download records, log noise).
import { useLibrary } from '@/stores/libraryStore'
import { useDownloads } from '@/stores/downloadsStore'
import { useTabs } from '@/stores/tabsStore'
import { useSettings } from '@/stores/settingsStore'
import { useLog } from '@/stores/logStore'
import { originOf } from '@/lib/url'
import { tabUrl } from '@/lib/tabModel'
import * as proxy from '@/proxy/scramjetAdapter'

const DAY = 86_400_000
const HISTORY_MAX_AGE = 90 * DAY
const DOWNLOADS_MAX = 200
const DOWNLOADS_MAX_AGE = 30 * DAY

type Idle = (cb: () => void, opts?: { timeout: number }) => void
const whenIdle: Idle = (cb, opts) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, opts) : setTimeout(cb, 200))

export function runMaintenance(): { history: number; icons: number; downloads: number } {
  const lib = useLibrary.getState()
  if (!lib.loaded) return { history: 0, icons: 0, downloads: 0 }
  const open = new Set(useTabs.getState().tabs.map((t) => originOf(tabUrl(t))).filter(Boolean))
  const history = lib.pruneHistory(HISTORY_MAX_AGE)
  const icons = lib.pruneFavicons(open)
  const downloads = useDownloads.getState().prune(DOWNLOADS_MAX, DOWNLOADS_MAX_AGE)
  proxy.clearCaches()
  if (history || icons || downloads) useLog.getState().add('info', `Cleanup removed ${history} old history entries, ${icons} unused icons, ${downloads} old download records`)
  return { history, icons, downloads }
}

let started = false

export function startMaintenance() {
  if (started) return
  started = true
  const tick = () => {
    if (!useSettings.getState().settings.autoCleanup || document.hidden) return
    whenIdle(() => runMaintenance(), { timeout: 10_000 })
  }
  setTimeout(tick, 15_000) // after startup work has settled
  setInterval(tick, 30 * 60_000)
}
