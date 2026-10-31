// Phones as real gamepads (for games that read controllers, not keys: emulators, engine games, 3-4 player games).
// The shell decides which players are gamepads (lib/gamepad.ts) and writes their state here; every proxied frame of
// the tab sees them through its own navigator.getGamepads() (proxy/virtualGamepads.ts). No stores: the proxy layer
// reads this module like lib/gameControl.ts.

export interface VirtualPadInput {
  /** the player (1-4), which decides the gamepad's index */
  player: number
  /** pressed values in standard gamepad order (16 buttons) */
  buttons: number[]
  /** left stick x, y (-1..1) */
  axes: number[]
}

/** The shape games read (the Gamepad interface): a plain object, since Gamepad itself cannot be constructed. */
export interface FakeGamepad {
  id: string
  index: number
  connected: boolean
  mapping: 'standard'
  timestamp: number
  axes: number[]
  buttons: { pressed: boolean; touched: boolean; value: number }[]
  vibrationActuator: null
  hapticActuators: never[]
}

const byTab = new Map<string, FakeGamepad[]>()
const frames = new Map<string, Set<Window>>()

export const virtualPadsFor = (tabId: string): FakeGamepad[] => byTab.get(tabId) ?? []

/** A frame of the tab that should hear gamepadconnected/gamepaddisconnected for the virtual pads. */
export function registerPadFrame(tabId: string, win: Window) {
  let set = frames.get(tabId)
  if (!set) frames.set(tabId, (set = new Set()))
  set.add(win)
}

function announce(tabId: string, type: 'gamepadconnected' | 'gamepaddisconnected', pad: FakeGamepad) {
  const set = frames.get(tabId)
  if (!set) return
  for (const win of set) {
    try {
      if (win.closed) {
        set.delete(win)
        continue
      }
      // GamepadEvent insists on a real Gamepad, so a plain Event carries ours
      const e = new (win as Window & typeof globalThis).Event(type)
      Object.defineProperty(e, 'gamepad', { value: pad })
      win.dispatchEvent(e)
    } catch {
      set.delete(win)
    }
  }
}

/**
 * Sets the tab's virtual gamepads. `taken` are indexes real controllers already use; player N gets index N-1 when it
 * is free (so phone 2 is gamepad 2, as games number players), else the next free one.
 */
export function setVirtualPads(tabId: string, inputs: VirtualPadInput[], taken: ReadonlySet<number> = new Set()) {
  const before = byTab.get(tabId) ?? []
  const used = new Set(taken)
  const now = performance.now()
  const next: FakeGamepad[] = []
  for (const input of [...inputs].sort((a, b) => a.player - b.player)) {
    let index = Math.max(0, input.player - 1)
    while (used.has(index)) index++
    used.add(index)
    const old = before.find((p) => p.index === index)
    const buttons = Array.from({ length: 17 }, (_, i) => {
      const v = input.buttons[i] ?? 0
      return { pressed: v >= 0.5, touched: v > 0, value: v }
    })
    const axes = [input.axes[0] ?? 0, input.axes[1] ?? 0, 0, 0]
    const changed = !old || old.axes.some((a, i) => a !== axes[i]) || old.buttons.some((b, i) => b.value !== buttons[i].value)
    next.push({
      id: `Shasta phone controller (player ${input.player}) (STANDARD GAMEPAD Vendor: 5348 Product: 0001)`,
      index,
      connected: true,
      mapping: 'standard',
      timestamp: changed ? now : old!.timestamp,
      axes,
      buttons,
      vibrationActuator: null,
      hapticActuators: [],
    })
  }
  byTab.set(tabId, next)
  for (const p of before) if (!next.some((n) => n.index === p.index)) announce(tabId, 'gamepaddisconnected', { ...p, connected: false })
  for (const p of next) if (!before.some((b) => b.index === p.index)) announce(tabId, 'gamepadconnected', p)
}
