// Watch's local, device-only state: My List and watch progress. No account, no server record — mirrors the rest of
// Shasta (Continue watching / library live in the browser). Cards are stored whole so a row renders with no round-trip.
import { create } from 'zustand'
import type { Card, Continue, Kind } from './types'

const LIST_KEY = 'shasta-watch-list'
const PROG_KEY = 'shasta-watch-continue'

function load<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v ?? fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private window */
  }
}
const keyOf = (kind: Kind, id: string) => `${kind}:${id}`

interface WatchState {
  list: Card[]
  progress: Continue[]
  inList: (kind: Kind, id: string) => boolean
  toggleList: (c: Card) => boolean
  progressFor: (kind: Kind, id: string, episode: number) => Continue | undefined
  setProgress: (e: Omit<Continue, 'at'>) => void
  removeProgress: (kind: Kind, id: string, episode: number) => void
  clearProgress: () => void
}

export const useWatch = create<WatchState>((set, get) => ({
  list: load<Card[]>(LIST_KEY, []).slice(0, 400),
  progress: load<Continue[]>(PROG_KEY, []).slice(0, 60),

  inList: (kind, id) => get().list.some((c) => keyOf(c.kind, c.id) === keyOf(kind, id)),

  toggleList: (c) => {
    const has = get().list.some((x) => keyOf(x.kind, x.id) === keyOf(c.kind, c.id))
    const list = has ? get().list.filter((x) => keyOf(x.kind, x.id) !== keyOf(c.kind, c.id)) : [{ ...c }, ...get().list].slice(0, 400)
    save(LIST_KEY, list)
    set({ list })
    return !has
  },

  progressFor: (kind, id, episode) =>
    get().progress.find((p) => p.kind === kind && p.id === id && p.episode === episode),

  setProgress: (e) => {
    // ignore the first few seconds so a quick open does not add a title
    const rest = get().progress.filter((p) => !(p.kind === e.kind && p.id === e.id && p.episode === e.episode))
    const entry: Continue = { ...e, at: Date.now() }
    const progress = [entry, ...rest].sort((a, b) => b.at - a.at).slice(0, 60)
    save(PROG_KEY, progress)
    set({ progress })
  },

  removeProgress: (kind, id, episode) => {
    const progress = get().progress.filter((p) => !(p.kind === kind && p.id === id && p.episode === episode))
    save(PROG_KEY, progress)
    set({ progress })
  },

  clearProgress: () => {
    save(PROG_KEY, [])
    set({ progress: [] })
  },
}))
