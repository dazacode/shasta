import { create } from 'zustand'

export interface LogEntry {
  id: number
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

const LIMIT = 300
let seq = 0

interface LogState {
  entries: LogEntry[]
  add: (level: LogEntry['level'], message: string) => void
  clear: () => void
}

/** Diagnostics ring buffer. Callers must pass already-redacted text (no query strings, no credentials). */
export const useLog = create<LogState>()((set) => ({
  entries: [],
  add: (level, message) =>
    set((s) => ({ entries: [...s.entries.slice(-(LIMIT - 1)), { id: ++seq, at: Date.now(), level, message: message.slice(0, 500) }] })),
  clear: () => set({ entries: [] }),
}))
