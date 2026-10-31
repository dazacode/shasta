// Key remapping inside every proxied frame (lib/gameInput.ts). A real key press that the tab's controls remap is
// stopped before the page sees it and replayed as the key the game expects, with `key`, `code` and the legacy
// `keyCode`/`which` (old and Emscripten games read only those). The controller's key presses (lib/gamepad.ts) go out
// through `sendKey` the same way. Synthetic events are never remapped again (isTrusted is false for them).
import { controlsForTab, keySpec, remapKey, type KeySpec } from '@/lib/gameInput'

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true)
}

type Mods = Pick<KeyboardEventInit, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>

/** Dispatches one synthetic key event at `target` in `win`. Returns false if the page cancelled it. */
export function sendKey(win: Window, target: EventTarget, type: 'keydown' | 'keyup' | 'keypress', spec: KeySpec, mods: Mods = {}): boolean {
  try {
    const KE = (win as Window & typeof globalThis).KeyboardEvent
    const printable = spec.key.length === 1
    const e = new KE(type, { key: spec.key, code: spec.code, bubbles: true, cancelable: true, composed: true, ...mods })
    const legacy = type === 'keypress' ? (printable ? spec.key.charCodeAt(0) : spec.keyCode) : spec.keyCode
    for (const p of ['keyCode', 'which'] as const) Object.defineProperty(e, p, { get: () => legacy })
    if (type === 'keypress') Object.defineProperty(e, 'charCode', { get: () => (printable ? spec.key.charCodeAt(0) : 0) })
    return target.dispatchEvent(e)
  } catch {
    return true
  }
}

/** Where a key press lands in `win`: the focused element, like a real key. */
export function keyTarget(win: Window): EventTarget {
  try {
    return win.document.activeElement ?? win.document.body ?? win
  } catch {
    return win
  }
}

/** A key press with keypress for printable keys and Enter, as browsers send them. */
export function pressDown(win: Window, target: EventTarget, spec: KeySpec, mods: Mods = {}) {
  const ok = sendKey(win, target, 'keydown', spec, mods)
  if (ok && (spec.key.length === 1 || spec.key === 'Enter')) sendKey(win, target, 'keypress', spec, mods)
}

export function applyInputMapper(win: Window, tabId: string) {
  // physical key -> what we sent for it, so its release matches even if the remap changed meanwhile
  const held = new Map<string, KeySpec>()
  const onKey = (e: KeyboardEvent) => {
    if (!e.isTrusted || isEditable(e.target)) return
    let spec: KeySpec | null | undefined
    if (e.type === 'keydown') {
      const to = remapKey(controlsForTab(tabId), e.code)
      spec = to ? keySpec(to, e.shiftKey) : null
      if (spec) held.set(e.code, spec)
    } else {
      spec = held.get(e.code)
      held.delete(e.code)
    }
    if (!spec) return
    e.stopImmediatePropagation()
    e.preventDefault()
    const mods = { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat }
    const target = e.target ?? win
    if (e.type === 'keydown') pressDown(win, target, spec, mods)
    else sendKey(win, target, 'keyup', spec, mods)
  }
  // (a cancelled keydown gets no keypress from the browser, so the original key's keypress never reaches the page)
  for (const type of ['keydown', 'keyup']) win.addEventListener(type, onKey as EventListener, { capture: true })
  // a remapped key still held when the window loses focus is released like the real one
  win.addEventListener('blur', () => {
    for (const spec of held.values()) sendKey(win, keyTarget(win), 'keyup', spec)
    held.clear()
  })
}
