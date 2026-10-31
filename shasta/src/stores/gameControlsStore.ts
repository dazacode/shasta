// Saved controls per game (lib/gameInput.ts), on this device only (localStorage `shasta-game-controls`). Not part of
// profile exports: key layouts are personal to a keyboard and controller, and nothing here ever leaves the browser.
import { create } from 'zustand'
import { cleanHint, defaultControls, isDefaultControls, normalizeControls, type ControlsHint, type GameControls } from '@/lib/gameInput'

const KEY = 'shasta-game-controls'
const HINTS_KEY = 'shasta-game-hints'

// profiles are kept as stored (untrusted) and read against the game's own defaults (engine + curated hint) in get()
function load(): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { v?: number; profiles?: Record<string, unknown> } | null
    if (!raw || raw.v !== 1 || !raw.profiles || typeof raw.profiles !== 'object') return {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw.profiles)) if (k.length < 300 && v && typeof v === 'object') out[k] = v
    return out
  } catch {
    return {}
  }
}

/** Curated layouts of Store games (from their launch info), kept so a restored tab has them before the Store answers. */
function loadHints(): Record<string, ControlsHint> {
  try {
    const raw = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '{}') as Record<string, unknown>
    const out: Record<string, ControlsHint> = {}
    for (const [k, v] of Object.entries(raw).slice(0, 500)) {
      const h = cleanHint(v)
      if (h) out[k] = h
    }
    return out
  } catch {
    return {}
  }
}

function save(profiles: Record<string, unknown>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, profiles }))
  } catch {
    /* storage full or blocked: the controls still work until the page closes */
  }
}

interface GameControlsState {
  profiles: Record<string, unknown>
  hints: Record<string, ControlsHint>
  /** the dialog: which tab it is open for */
  dialogTab: string | null
  /** the controls for `key`: what was saved, over `base` (the game's defaults) */
  get: (key: string | null, base?: GameControls) => GameControls
  set: (key: string, c: GameControls, base?: GameControls) => void
  reset: (key: string) => void
  setHint: (slug: string, hint: unknown) => void
  openDialog: (tabId: string) => void
  closeDialog: () => void
}

export const useGameControls = create<GameControlsState>((set, get) => ({
  profiles: load(),
  hints: loadHints(),
  dialogTab: null,
  get: (key, base = defaultControls()) => {
    const saved = key ? get().profiles[key] : undefined
    return saved ? normalizeControls(saved, base) : base
  },
  set: (key, c, base = defaultControls()) => {
    const profiles = { ...get().profiles }
    // a profile that is back to the game's defaults is not kept
    if (isDefaultControls(c, base)) delete profiles[key]
    else profiles[key] = c
    save(profiles)
    set({ profiles })
  },
  reset: (key) => {
    const profiles = { ...get().profiles }
    delete profiles[key]
    save(profiles)
    set({ profiles })
  },
  setHint: (slug, raw) => {
    const hint = cleanHint(raw)
    const hints = { ...get().hints }
    if (JSON.stringify(hints[slug] ?? null) === JSON.stringify(hint)) return
    if (hint) hints[slug] = hint
    else delete hints[slug]
    try {
      localStorage.setItem(HINTS_KEY, JSON.stringify(hints))
    } catch {
      /* the hint still applies until the page closes */
    }
    set({ hints })
  },
  openDialog: (tabId) => set({ dialogTab: tabId }),
  closeDialog: () => set({ dialogTab: null }),
}))

export const openControls = (tabId: string) => useGameControls.getState().openDialog(tabId)
