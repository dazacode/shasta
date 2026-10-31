// In every proxied frame: navigator.getGamepads() also lists the tab's virtual gamepads (phones playing as real
// controllers, lib/virtualPads.ts). Installed in init.post, before the page's own scripts, so engines that keep a
// reference to getGamepads (Emscripten/SDL, Construct, Phaser, Unity, EmulatorJS) see them from the start.
import { registerPadFrame, virtualPadsFor } from '@/lib/virtualPads'

export function applyVirtualGamepads(win: Window, tabId: string) {
  const nav = win.navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] }
  const real = typeof nav.getGamepads === 'function' ? nav.getGamepads.bind(nav) : () => [] as (Gamepad | null)[]
  const getGamepads = function getGamepads() {
    let list: (Gamepad | null)[]
    try {
      list = [...real()]
    } catch {
      list = []
    }
    for (const pad of virtualPadsFor(tabId)) {
      // a real controller at the same index wins; ours never hide one
      while (list.length <= pad.index) list.push(null)
      if (!list[pad.index]) list[pad.index] = pad as unknown as Gamepad
    }
    return list
  }
  try {
    Object.defineProperty((win as Window & typeof globalThis).Navigator.prototype, 'getGamepads', { value: getGamepads, configurable: true, writable: true })
  } catch {
    try {
      Object.defineProperty(nav, 'getGamepads', { value: getGamepads, configurable: true, writable: true })
    } catch {
      return
    }
  }
  registerPadFrame(tabId, win)
}
