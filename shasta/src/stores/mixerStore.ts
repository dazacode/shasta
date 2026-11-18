// The sound mixer's levels (lib/mixer.ts has the maths). `master` and the per-source `levels` are remembered on this device
// (localStorage `shasta-mixer`); `muted` is for this session only. proxy/mediaWatch.ts applies them to every proxied page.
import { create } from 'zustand'
import { clampLevel, sanitizeMixer } from '@/lib/mixer'

const KEY = 'shasta-mixer'

interface MixerState {
  master: number
  levels: Record<string, number>
  muted: Record<string, boolean>
  setMaster: (v: number) => void
  setLevel: (key: string, v: number) => void
  toggleMute: (key: string) => void
  /** back to full volume for everything */
  reset: () => void
}

function load() {
  try {
    return sanitizeMixer(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return sanitizeMixer(null)
  }
}

export const useMixer = create<MixerState>()((set) => {
  const saved = load()
  return {
    master: saved.master,
    levels: saved.levels,
    muted: {},
    setMaster: (master) => set({ master: clampLevel(master) }),
    setLevel: (key, v) =>
      set((s) => {
        const levels = { ...s.levels }
        // raising a muted source is an answer to "louder": it unmutes
        const next = clampLevel(v)
        if (next >= 0.999) delete levels[key]
        else levels[key] = next
        return { levels, muted: s.muted[key] ? { ...s.muted, [key]: false } : s.muted }
      }),
    toggleMute: (key) => set((s) => ({ muted: { ...s.muted, [key]: !s.muted[key] } })),
    reset: () => set({ master: 1, levels: {}, muted: {} }),
  }
})

let timer: ReturnType<typeof setTimeout> | undefined
useMixer.subscribe((s, prev) => {
  if (s.master === prev.master && s.levels === prev.levels) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      const { master, levels } = useMixer.getState()
      localStorage.setItem(KEY, JSON.stringify({ master, levels }))
    } catch {
      /* private mode: the levels last for this session */
    }
  }, 400)
})
