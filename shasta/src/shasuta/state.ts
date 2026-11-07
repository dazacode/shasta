// Stand-in for shasuta/state.ts in a build WITHOUT Shasuta, the gaming mode (docs/notes/shasuta.md "What ships").
// Production builds use these files (vite.config.ts aliases `@/shasuta/*` here), and the public source snapshot ships
// them at the real paths (scripts/publish-source.ts), so everything outside shasuta/ builds and typechecks either way.
// Nothing here has any behaviour: Shasuta is off, never visible, and "leave the browser" does nothing.

/** false here, true in the real module: UI that only makes sense with Shasuta (settings rows, the shortcut, a What's New slide) checks it */
export const SHASUTA_BUILT = false

export type Avatar = { kind: 'preset'; id: number } | { kind: 'picture'; stamp: string }

export interface ShasutaPrefs {
  enabled: boolean
  browserLook: boolean
  visited: boolean
  avatar: Avatar
}

interface OffState {
  visible: boolean
  quick: boolean
  prefs: ShasutaPrefs
  setPrefs: (patch: Partial<ShasutaPrefs>) => void
  hide: () => void
}

const OFF: OffState = {
  visible: false,
  quick: false,
  prefs: { enabled: false, browserLook: false, visited: false, avatar: { kind: 'preset', id: 0 } },
  setPrefs: () => {},
  hide: () => {},
}

export const useShasuta = Object.assign(<T,>(select: (s: OffState) => T): T => select(OFF), { getState: () => OFF })

export const exitBrowser = (_screen?: unknown): boolean => false
export const consoleLookOn = (_prefs: ShasutaPrefs): boolean => false
