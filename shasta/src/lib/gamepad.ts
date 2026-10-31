// Controllers for browser games that only take the keyboard: the Gamepad API is read in the shell and every button
// held becomes a key held in the game's frame (proxy/inputMapper.ts `sendKey`). Polls once a second for a controller
// and at the screen's frame rate only while one is connected. Nothing is stored or sent anywhere.
import { create } from 'zustand'
import { diffKeys, keySpec, padKeys, playerMap, PAD_BUTTONS, type GameControls, type PadButton } from './gameInput'
import { keyTarget, pressDown, sendKey } from '@/proxy/inputMapper'
import { forceFocus } from './gameControl'
import { onPhoneInput, phoneHeldKeys, phonePadInputs, takePhoneMouse, usePhonePads } from './phonePad'
import { createPhoneMouse } from './phoneMouse'
import { setVirtualPads, type VirtualPadInput } from './virtualPads'

interface PadState {
  /** the first connected controller's name, null when none */
  name: string | null
  count: number
  /** buttons held right now (only tracked while `watching`, for the Controls dialog) */
  pressed: PadButton[]
  watching: boolean
}

export const usePads = create<PadState>(() => ({ name: null, count: 0, pressed: [], watching: false }))

export interface PadTarget {
  tabId: string
  /** the game's frame window that has focus (keys go where a real key press would) */
  win: Window
  /** the tab's own proxied frame (a phone's touchpad cursor moves over it) */
  frame?: HTMLIFrameElement
  controls: GameControls
}

const readPads = (nav: Navigator): Gamepad[] => {
  try {
    // our own phone gamepads (proxy/virtualGamepads.ts) show up in a game frame's list too: never read them back
    return [...(nav.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected && !p.id.startsWith('Shasta phone controller'))
  } catch {
    return []
  }
}

/** Starts the controller service. `target` says where keys go right now (null = nowhere). Returns a stop function. */
export function startGamepads(opts: { target: () => PadTarget | null; onConnect: (name: string) => void }): () => void {
  if (typeof navigator === 'undefined' || !('getGamepads' in navigator)) return () => undefined
  let raf = 0
  // the tab whose frames currently see virtual gamepads
  let virtualIn: string | null = null
  const showVirtual = (tabId: string | null, pads: VirtualPadInput[], taken?: ReadonlySet<number>) => {
    if (virtualIn && virtualIn !== tabId) setVirtualPads(virtualIn, [])
    virtualIn = pads.length ? tabId : null
    if (tabId) setVirtualPads(tabId, pads, taken)
  }
  let held = new Set<string>()
  let heldIn: Window | null = null
  let focused = false
  const known = new Set<string>()
  // phones in Touchpad mode: one cursor over the front tab (lib/phoneMouse.ts)
  const mouse = createPhoneMouse()
  let mouseFrame: HTMLIFrameElement | null = null

  const release = () => {
    if (heldIn) for (const code of held) {
      const spec = keySpec(code)
      if (spec) sendKey(heldIn, keyTarget(heldIn), 'keyup', spec)
    }
    held = new Set()
    heldIn = null
  }

  // Chrome may only give controller data to the frame that has focus, so ask the game's frame first
  const pads = (t: PadTarget | null) => {
    const own = t ? readPads(t.win.navigator) : []
    return own.length ? own : readPads(navigator)
  }

  /** One pass: reads every controller and phone and plays the result into the game. False = nothing connected. */
  const process = (): boolean => {
    const t = opts.target()
    const list = pads(t)
    // phones (lib/phonePad.ts) count as controllers too
    const phones = phonePadInputs()
    // the touchpad's moves, clicks and text go to the front tab; anything done while there is none is dropped
    const frame = t?.frame ?? null
    if (mouseFrame && mouseFrame !== frame) mouse.reset(mouseFrame)
    mouseFrame = frame
    mouse.step(frame, t?.win ?? null, takePhoneMouse())
    if (!list.length && !phones.length) {
      mouse.reset(mouseFrame)
      mouseFrame = null
      showVirtual(null, [])
      release()
      usePads.setState({ name: null, count: 0, pressed: [] })
      return false
    }
    const combine = (inputs: { buttons: number[]; axes: readonly number[] }[]) => {
      const buttons: number[] = []
      const axes: number[] = []
      for (const p of inputs) {
        p.buttons.forEach((v, i) => (buttons[i] = Math.max(buttons[i] ?? 0, v)))
        p.axes.forEach((a, i) => (axes[i] = Math.abs(a) > Math.abs(axes[i] ?? 0) ? a : (axes[i] ?? 0)))
      }
      return { buttons, axes }
    }
    // each controller is a player: the Nth real controller is player N, a phone is the player it joined as
    const real = list.map((p) => ({ player: p.index + 1, buttons: p.buttons.map((b) => (b.pressed ? Math.max(b.value, 1) : b.value)), axes: p.axes }))
    const all = combine([...real, ...phones])
    if (usePads.getState().watching) {
      const pressed = PAD_BUTTONS.filter((_, i) => (all.buttons[i] ?? 0) >= 0.5)
      if (pressed.join() !== usePads.getState().pressed.join()) usePads.setState({ pressed })
    }
    // a real controller may be read by the game itself (padToKeys off); a phone never can, so it always sends keys
    const next = new Set<string>()
    if (!t) showVirtual(null, [])
    if (t) {
      const byPlayer = new Map<number, { buttons: number[]; axes: readonly number[] }[]>()
      // a phone whose player has no keys (or every phone, for a game that reads controllers) is a real gamepad instead
      const asPad = (player: number) => t.controls.phonesAsGamepads || !playerMap(t.controls, player)
      const virtual: VirtualPadInput[] = phones.filter((p) => asPad(p.player))
      showVirtual(t.tabId, virtual, new Set(list.map((p) => p.index)))
      for (const p of [...(t.controls.padToKeys ? real : []), ...phones.filter((p) => !asPad(p.player))]) byPlayer.set(p.player, [...(byPlayer.get(p.player) ?? []), p])
      for (const [player, inputs] of byPlayer) {
        const merged = combine(inputs)
        for (const k of padKeys(t.controls, merged.buttons, merged.axes, player)) next.add(k)
      }
      // keys held on a phone's touchpad screen are keys as they are
      for (const k of phoneHeldKeys()) if (keySpec(k)) next.add(k)
    }
    if (t && heldIn && heldIn !== t.win) release()
    if (t && next.size) {
      // the first press wakes the game up, the way game mode's click does
      if (!focused) {
        focused = true
        if (!t.win.document.hasFocus()) forceFocus(t.win)
      }
      const { down, up } = diffKeys(held, next)
      const target = keyTarget(t.win)
      for (const code of up) {
        const spec = keySpec(code)
        if (spec) sendKey(t.win, target, 'keyup', spec)
      }
      for (const code of down) {
        const spec = keySpec(code)
        if (spec) pressDown(t.win, target, spec)
      }
      held = next
      heldIn = t.win
    } else {
      release()
      focused = false
    }
    return true
  }
  const tick = () => {
    raf = 0
    if (process()) raf = requestAnimationFrame(tick)
  }
  // A phone's press, move or click is played the moment it arrives, not at the next frame (up to 16 ms sooner); the
  // frame loop still runs for real controllers and to end taps held for their minimum press.
  const now = () => {
    if (process() && !raf) raf = requestAnimationFrame(tick)
  }

  const scan = () => {
    const list = pads(opts.target())
    usePads.setState({ name: list[0]?.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || (list.length ? 'Controller' : null), count: list.length })
    for (const p of list) {
      if (known.has(p.id)) continue
      known.add(p.id)
      opts.onConnect(p.id)
    }
    if (list.length && !raf) raf = requestAnimationFrame(tick)
  }
  const interval = window.setInterval(scan, 1000)
  const onConnected = () => scan()
  window.addEventListener('gamepadconnected', onConnected)
  // a phone button wakes the loop at once (no 1 s wait for the first press)
  const offPhones = usePhonePads.subscribe((st, prev) => {
    if (st.pads !== prev.pads && !raf && st.pads.some((p) => p.on)) raf = requestAnimationFrame(tick)
  })
  const offInput = onPhoneInput(now)
  scan()
  return () => {
    offInput()
    offPhones()
    clearInterval(interval)
    window.removeEventListener('gamepadconnected', onConnected)
    if (raf) cancelAnimationFrame(raf)
    mouse.reset(mouseFrame)
    release()
  }
}

/** The innermost frame of the page that has focus (a game is often an iframe inside its site's page). */
export function focusedFrame(top: Window): Window {
  let w = top
  for (let depth = 0; depth < 4; depth++) {
    try {
      const a = w.document.activeElement as HTMLIFrameElement | null
      if (!a || (a.tagName !== 'IFRAME' && a.tagName !== 'FRAME')) break
      const inner = a.contentWindow
      if (!inner || !inner.document) break
      w = inner
    } catch {
      break
    }
  }
  return w
}
