// "Online now" (the new tab's live strip): one pulse socket per open Shasta window, from start until the window closes,
// whatever the window is showing. The full site and every Lite host (Base44, Vercel, jsDelivr) reach the same backend,
// so the server's count is all of them together. Only the count comes back; nothing identifies a window.
// A window is counted while "Share anonymous usage counts" is on, or while its new tab shows the live strip (which needs
// the number anyway); never in tests.
import { openLiveSocket, type LiveSocket } from './liveSocket'
import { getSettings, useSettings } from '@/stores/settingsStore'

let sock: LiveSocket | null = null
let online: number | null = null
let strips = 0
const listeners = new Set<(n: number) => void>()

function wanted() {
  return import.meta.env.MODE !== 'test' && (strips > 0 || getSettings().usageStats)
}

function sync() {
  if (wanted() && !sock) {
    sock = openLiveSocket(
      '/api/pulse/ws',
      (raw) => {
        try {
          const m = JSON.parse(raw)
          if (m.type === 'online' && typeof m.online === 'number') {
            online = m.online
            for (const fn of listeners) fn(m.online)
          }
        } catch {
          /* ignore */
        }
      },
      () => undefined,
    )
  } else if (!wanted() && sock) {
    sock.close()
    sock = null
    online = null
  }
}

/** Called once at start (App bootstrap); follows the usage setting from then on. */
export function startPulse() {
  sync()
  useSettings.subscribe(sync)
}

/** The live strip is on screen: keep the socket open and hear the count. Returns the cleanup. */
export function watchOnline(fn: (n: number) => void): () => void {
  strips++
  listeners.add(fn)
  sync()
  if (online !== null) fn(online)
  return () => {
    strips--
    listeners.delete(fn)
    sync()
  }
}
