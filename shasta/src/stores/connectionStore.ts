import { create } from 'zustand'
import * as proxy from '@/proxy/scramjetAdapter'
import { useSettings, wispOptions } from './settingsStore'
import { loadAdBlocker, setBlockPolicy } from '@/lib/adBlock'
import { useUi } from './uiStore'
import { useLog } from './logStore'
import { useDownloads } from './downloadsStore'
import { useTabs } from './tabsStore'
import { useCompat } from './compatStore'

interface ConnectionStore {
  info: proxy.ConnectionInfo
  /** the Scramjet controller exists, so frames can be attached (even if the transport is down) */
  engineReady: boolean
  /** the site has no backend configured at all (a frontend-only deployment says so with `X-Shasta-Backend: none`) */
  noBackend: boolean
  boot: () => Promise<void>
  reconnect: () => Promise<void>
  applySettings: () => Promise<void>
}

export const useConnection = create<ConnectionStore>()((set) => ({
  info: proxy.connectionInfo(),
  engineReady: false,
  noBackend: false,
  boot: async () => {
    try {
      await proxy.init(wispOptions())
      set({ engineReady: proxy.isReady() })
    } catch {
      /* surfaced through the connection state */
    }
  },
  reconnect: async () => {
    await proxy.reconnect(wispOptions())
    set({ engineReady: proxy.isReady() })
  },
  applySettings: async () => {
    await proxy.applyOptions(wispOptions())
  },
}))

let started = false
let checking = false

/** Asks the page's own host whether it has a backend, when the Wisp server on that host can't be reached. */
async function checkBackend() {
  if (checking || !navigator.onLine) return
  checking = true
  try {
    const endpoint = useConnection.getState().info.endpoint
    if (!endpoint || new URL(endpoint).host !== location.host) return
    const res = await fetch('/healthz', { cache: 'no-store' })
    useConnection.setState({ noBackend: res.headers.get('X-Shasta-Backend') === 'none' })
  } catch {
    /* unreachable: an ordinary disconnection */
  } finally {
    checking = false
  }
}

/** Routes adapter events into the stores. Called once at startup. */
export function startBridge() {
  if (started) return
  started = true
  const applyBlocking = () => {
    const s = useSettings.getState().settings
    setBlockPolicy({ ads: s.blockAds, popups: s.blockPopups })
    // loaded before the first page, so that page's scriptlets run before its own scripts
    // (after the shell has painted: its 5 MB must not compete with first paint; the plugin still waits for it before a page request)
    if (s.blockAds && import.meta.env.MODE !== 'test') {
      const load = () => void loadAdBlocker()
      if (document.readyState === 'complete') setTimeout(load, 1500)
      else window.addEventListener('load', () => setTimeout(load, 1500), { once: true })
    }
  }
  applyBlocking()
  useSettings.subscribe((s, prev) => {
    if (s.settings.blockAds !== prev.settings.blockAds || s.settings.blockPopups !== prev.settings.blockPopups) applyBlocking()
  })
  let lastPopupToast = 0
  proxy.subscribe((e) => {
    switch (e.type) {
      case 'connection':
        useConnection.setState({ info: e.info, engineReady: proxy.isReady() })
        if (e.info.state === 'disconnected') void checkBackend()
        else if (e.info.state === 'connected') useConnection.setState({ noBackend: false })
        break
      case 'log':
        useLog.getState().add(e.level, e.message)
        break
      case 'download':
        useDownloads.getState().apply(e.download)
        break
      case 'openTab':
        useTabs.getState().newTab(e.url, { afterId: e.openerTabId })
        break
      case 'unsupported':
        if (e.feature) useCompat.getState().report(e.tabId, e.feature)
        else useCompat.getState().clear(e.tabId)
        break
      case 'popupBlocked': {
        // a page firing pop-ups in a loop gets one notice, not a stack of them
        const now = Date.now()
        if (now - lastPopupToast < 3000) break
        lastPopupToast = now
        const { url, openerTabId } = e
        useUi.getState().toast(e.ad ? 'Blocked an ad pop-up' : 'Blocked a pop-up', {
          action: { label: 'Open anyway', run: () => useTabs.getState().newTab(url, { afterId: openerTabId }) },
        })
        break
      }
    }
  })
}
