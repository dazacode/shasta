// Per-game controls: key remaps and a controller (Gamepad API) turned into key presses. Pure model, no DOM, no stores:
// the proxy layer reads the controls of a tab through `controlsForTab` (like lib/gameControl.ts), the shell keeps that
// map up to date (hooks/useGameInput.ts) and stores profiles on this device (stores/gameControlsStore.ts).

/** What a key press looks like to a page: `code` (physical key), `key` (its meaning) and the legacy `keyCode`. */
export interface KeySpec {
  code: string
  key: string
  keyCode: number
}

const KEYS: Record<string, [key: string, keyCode: number, label?: string]> = {
  ArrowUp: ['ArrowUp', 38, '↑'],
  ArrowDown: ['ArrowDown', 40, '↓'],
  ArrowLeft: ['ArrowLeft', 37, '←'],
  ArrowRight: ['ArrowRight', 39, '→'],
  Space: [' ', 32, 'Space'],
  Enter: ['Enter', 13],
  Escape: ['Escape', 27, 'Esc'],
  Tab: ['Tab', 9],
  Backspace: ['Backspace', 8],
  ShiftLeft: ['Shift', 16, 'Shift'],
  ShiftRight: ['Shift', 16, 'Right Shift'],
  ControlLeft: ['Control', 17, 'Ctrl'],
  ControlRight: ['Control', 17, 'Right Ctrl'],
  AltLeft: ['Alt', 18, 'Alt'],
  AltRight: ['Alt', 18, 'Right Alt'],
  Comma: [',', 188],
  Period: ['.', 190],
  Slash: ['/', 191],
  Semicolon: [';', 186],
  Quote: ["'", 222],
  BracketLeft: ['[', 219],
  BracketRight: [']', 221],
  Minus: ['-', 189],
  Equal: ['=', 187],
  Backquote: ['`', 192],
  Backslash: ['\\', 220],
}
for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(97 + i)
  KEYS[`Key${ch.toUpperCase()}`] = [ch, 65 + i, ch.toUpperCase()]
}
for (let i = 0; i <= 9; i++) KEYS[`Digit${i}`] = [String(i), 48 + i]

/** Whether `code` is a key Shasta can send (the remap pickers only accept these). */
export const isKnownKey = (code: string) => Object.prototype.hasOwnProperty.call(KEYS, code)

export function keySpec(code: string, shift = false): KeySpec | null {
  const k = KEYS[code]
  if (!k) return null
  const key = shift && k[0].length === 1 && /[a-z]/.test(k[0]) ? k[0].toUpperCase() : k[0]
  return { code, key, keyCode: k[1] }
}

export const keyLabel = (code: string | null | undefined): string => (code ? (KEYS[code]?.[2] ?? KEYS[code]?.[0] ?? code) : '—')

/** Buttons of the browser's "standard" gamepad layout, in its index order (Xbox names; PlayStation in the labels). */
export const PAD_BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'ls', 'rs', 'up', 'down', 'left', 'right'] as const
export type PadButton = (typeof PAD_BUTTONS)[number]

export const PAD_LABELS: Record<PadButton, string> = {
  a: 'A / ✕',
  b: 'B / ○',
  x: 'X / □',
  y: 'Y / △',
  lb: 'LB / L1',
  rb: 'RB / R1',
  lt: 'LT / L2',
  rt: 'RT / R2',
  back: 'Back / Select',
  start: 'Start',
  ls: 'Left stick press',
  rs: 'Right stick press',
  up: 'D-pad up',
  down: 'D-pad down',
  left: 'D-pad left',
  right: 'D-pad right',
}

export type PadMap = Record<PadButton, string | null>

export interface GameControls {
  /** physical key -> the key the game receives instead */
  keys: Record<string, string>
  /** player 1's controller: button -> the key it presses (null = nothing) */
  pad: PadMap
  /** players 2-4 (index 0 = player 2): their own keys, as two players share one keyboard; null = no keys for them */
  players: (PadMap | null)[]
  /** send controller buttons as keys; off for games that read the controller themselves */
  padToKeys: boolean
  /** the left stick moves like the D-pad */
  stickAsDpad: boolean
  /** phones appear to the game as real gamepads instead of pressing keys (games that support controllers) */
  phonesAsGamepads: boolean
}

const none = (): PadMap => Object.fromEntries(PAD_BUTTONS.map((b) => [b, null])) as PadMap
const map = (m: Partial<PadMap>): PadMap => ({ ...none(), ...m })

/** Arrow keys, Space to jump, Z/X/C for actions, Enter to start: what most browser games expect. */
export const DEFAULT_PAD: PadMap = {
  a: 'Space',
  b: 'KeyX',
  x: 'KeyZ',
  y: 'KeyC',
  lb: 'KeyQ',
  rb: 'KeyE',
  lt: 'ShiftLeft',
  rt: 'KeyF',
  back: 'Escape',
  start: 'Enter',
  ls: null,
  rs: null,
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
}

/**
 * Whole layouts a player can take. Two-player browser games split one keyboard (Fireboy & Watergirl: arrows and WASD),
 * MAME and PICO-8 have fixed keys for each player (docs.mamedev.org "Default Keyboard Controls", the PICO-8 manual).
 */
export const LAYOUTS = {
  standard: { label: 'Arrows + Space, X, Z', pad: DEFAULT_PAD },
  // none of the standard layout's keys, so both can be held at once
  wasd: { label: 'WASD + G, H, T, Y', pad: map({ up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', a: 'KeyG', b: 'KeyH', x: 'KeyT', y: 'KeyY' }) },
  mame1: { label: 'Arcade player 1', pad: map({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'ControlLeft', b: 'AltLeft', x: 'Space', y: 'ShiftLeft', start: 'Digit1', back: 'Digit5' }) },
  mame2: { label: 'Arcade player 2', pad: map({ up: 'KeyR', down: 'KeyF', left: 'KeyD', right: 'KeyG', a: 'KeyA', b: 'KeyS', x: 'KeyQ', y: 'KeyW', start: 'Digit2', back: 'Digit6' }) },
  pico1: { label: 'PICO-8 player 1', pad: map({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'KeyZ', b: 'KeyX', start: 'Enter' }) },
  pico2: { label: 'PICO-8 player 2', pad: map({ up: 'KeyE', down: 'KeyD', left: 'KeyS', right: 'KeyF', a: 'ShiftLeft', b: 'KeyQ' }) },
} as const satisfies Record<string, { label: string; pad: PadMap }>
export type LayoutName = keyof typeof LAYOUTS

/** How a game reads its players, which decides everyone's default keys. */
export type Engine = 'generic' | 'mame' | 'pico8'
export const ENGINE_LAYOUTS: Record<Engine, (LayoutName | null)[]> = {
  generic: ['standard', 'wasd', null, null],
  mame: ['mame1', 'mame2', null, null],
  pico8: ['pico1', 'pico2', null, null],
}

/** Internet Archive games run in MAME/MESS-based players; Lexaloffle's widget is the PICO-8 web player. */
export function detectEngine(url: string): Engine {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'generic'
  }
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'archive.org' && u.pathname.startsWith('/embed/')) return 'mame'
  if (host.endsWith('lexaloffle.com') && (u.pathname.startsWith('/bbs/widget.php') || u.pathname.startsWith('/bbs/') || u.pathname.startsWith('/embed'))) return 'pico8'
  return 'generic'
}

/** A Store app's curated layout (owner-set, server/src/services/controls.ts): an engine and per-player changes. */
export interface ControlsHint {
  engine?: Engine
  players?: (Partial<PadMap> | null)[]
  /** the game reads controllers itself: phones become gamepads */
  gamepads?: boolean
}

export const MAX_PLAYERS = 4

export function defaultControls(engine: Engine = 'generic', hint?: ControlsHint | null): GameControls {
  const layouts = ENGINE_LAYOUTS[hint?.engine ?? engine]
  const at = (i: number): PadMap | null => {
    const base = layouts[i] ? { ...LAYOUTS[layouts[i]!].pad } : null
    const change = hint?.players?.[i]
    if (!change) return base
    return { ...(base ?? none()), ...change }
  }
  return {
    keys: {},
    pad: at(0) ?? { ...DEFAULT_PAD },
    players: Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => at(i + 1)),
    padToKeys: true,
    stickAsDpad: true,
    phonesAsGamepads: !!hint?.gamepads,
  }
}

export const PRESETS = {
  wasdToArrows: { label: 'WASD → arrow keys', keys: { KeyW: 'ArrowUp', KeyA: 'ArrowLeft', KeyS: 'ArrowDown', KeyD: 'ArrowRight' } },
  arrowsToWasd: { label: 'Arrow keys → WASD', keys: { ArrowUp: 'KeyW', ArrowLeft: 'KeyA', ArrowDown: 'KeyS', ArrowRight: 'KeyD' } },
} as const
export type PresetName = keyof typeof PRESETS

export const DPAD_PRESETS = {
  arrows: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
  wasd: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
} as const

const cleanMap = (raw: unknown, into: PadMap) => {
  if (!raw || typeof raw !== 'object') return into
  const m = raw as Record<string, unknown>
  for (const b of PAD_BUTTONS) {
    if (!(b in m)) continue
    const v = m[b]
    into[b] = v === null ? null : typeof v === 'string' && isKnownKey(v) ? v : into[b]
  }
  return into
}

/** Stored data is untrusted (other versions, hand edits): keep only known keys and buttons. Missing parts come from `base`. */
export function normalizeControls(raw: unknown, base: GameControls = defaultControls()): GameControls {
  const c: GameControls = { ...base, keys: {}, pad: { ...base.pad }, players: base.players.map((p) => (p ? { ...p } : null)) }
  if (!raw || typeof raw !== 'object') return c
  const r = raw as Partial<Record<keyof GameControls, unknown>>
  if (r.keys && typeof r.keys === 'object') {
    for (const [from, to] of Object.entries(r.keys as Record<string, unknown>)) {
      if (isKnownKey(from) && typeof to === 'string' && isKnownKey(to) && from !== to) c.keys[from] = to
    }
  }
  cleanMap(r.pad, c.pad)
  if (Array.isArray(r.players)) {
    r.players.slice(0, MAX_PLAYERS - 1).forEach((p, i) => {
      c.players[i] = p === null ? null : p && typeof p === 'object' ? cleanMap(p, { ...(c.players[i] ?? none()) }) : c.players[i]
    })
  }
  if (typeof r.padToKeys === 'boolean') c.padToKeys = r.padToKeys
  if (typeof r.stickAsDpad === 'boolean') c.stickAsDpad = r.stickAsDpad
  if (typeof r.phonesAsGamepads === 'boolean') c.phonesAsGamepads = r.phonesAsGamepads
  return c
}

/** A curated layout from the Store (untrusted like everything from the network). */
export function cleanHint(raw: unknown): ControlsHint | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { engine?: unknown; players?: unknown }
  const hint: ControlsHint = {}
  if (r.engine === 'generic' || r.engine === 'mame' || r.engine === 'pico8') hint.engine = r.engine
  if ((raw as { gamepads?: unknown }).gamepads === true) hint.gamepads = true
  if (Array.isArray(r.players)) {
    hint.players = r.players.slice(0, MAX_PLAYERS).map((p) => {
      if (!p || typeof p !== 'object') return null
      const out: Partial<PadMap> = {}
      for (const [b, v] of Object.entries(p as Record<string, unknown>)) {
        if ((PAD_BUTTONS as readonly string[]).includes(b) && (v === null || (typeof v === 'string' && isKnownKey(v)))) out[b as PadButton] = v as string | null
      }
      return Object.keys(out).length ? out : null
    })
  }
  return hint.engine || hint.gamepads || hint.players?.some(Boolean) ? hint : null
}

const sameMap = (a: PadMap | null, b: PadMap | null) => (a === null || b === null ? a === b : PAD_BUTTONS.every((k) => a[k] === b[k]))

export const isDefaultControls = (c: GameControls, base: GameControls = defaultControls()): boolean =>
  Object.keys(c.keys).length === 0 &&
  c.padToKeys === base.padToKeys &&
  c.stickAsDpad === base.stickAsDpad &&
  c.phonesAsGamepads === base.phonesAsGamepads &&
  sameMap(c.pad, base.pad) &&
  c.players.every((p, i) => sameMap(p, base.players[i] ?? null))

/** The layout of player `n` (1-4), or null when that player has no keys. */
export const playerMap = (c: GameControls, n: number): PadMap | null => (n <= 1 ? c.pad : (c.players[n - 2] ?? null))

/** The key a physical key press becomes, or null to leave it alone. */
export const remapKey = (c: GameControls | null | undefined, code: string): string | null => (c && Object.prototype.hasOwnProperty.call(c.keys, code) ? c.keys[code] : null)

const STICK_DEADZONE = 0.5
const TRIGGER_PRESSED = 0.5

/** Which keys player `player`'s controller is holding right now. `buttons` are pressed values (0..1), `axes` the sticks. */
export function padKeys(c: GameControls, buttons: readonly number[], axes: readonly number[], player = 1): Set<string> {
  const held = new Set<string>()
  const layout = playerMap(c, player)
  if (!layout) return held
  const press = (b: PadButton) => {
    const code = layout[b]
    if (code) held.add(code)
  }
  PAD_BUTTONS.forEach((b, i) => {
    if ((buttons[i] ?? 0) >= TRIGGER_PRESSED) press(b)
  })
  if (c.stickAsDpad) {
    const x = axes[0] ?? 0
    const y = axes[1] ?? 0
    if (x <= -STICK_DEADZONE) press('left')
    if (x >= STICK_DEADZONE) press('right')
    if (y <= -STICK_DEADZONE) press('up')
    if (y >= STICK_DEADZONE) press('down')
  }
  return held
}

export function diffKeys(prev: ReadonlySet<string>, next: ReadonlySet<string>): { down: string[]; up: string[] } {
  return { down: [...next].filter((k) => !prev.has(k)), up: [...prev].filter((k) => !next.has(k)) }
}

/** Which profile a tab uses: the Store app it belongs to, else the site. */
export function controlsKey(tab: { app: { scheme: string; slug: string } | null }, host: string): string | null {
  if (tab.app) return `${tab.app.scheme}:${tab.app.slug}`
  return host ? `site:${host}` : null
}

// ---- shared with the proxy layer ----------------------------------------------------------------------

const byTab = new Map<string, GameControls>()

export const controlsForTab = (tabId: string): GameControls | null => byTab.get(tabId) ?? null
export function setTabControls(tabId: string, c: GameControls | null) {
  if (c) byTab.set(tabId, c)
  else byTab.delete(tabId)
}
