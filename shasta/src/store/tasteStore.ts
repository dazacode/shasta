// Where the taste profile lives: this browser's localStorage, nowhere else. See taste.ts for what it holds.
import { getSettings } from '@/stores/settingsStore'
import { decay, emptyTaste, record, type Features, type Taste, type TasteEvent } from './taste'

const KEY = 'shasta-store-taste'

function valid(x: unknown): x is Taste {
  if (!x || typeof x !== 'object') return false
  const t = x as Taste
  return t.v === 1 && typeof t.at === 'number' && !!t.f && typeof t.f === 'object' && Object.values(t.f).every((w) => typeof w === 'number' && Number.isFinite(w))
}

export function loadTaste(): Taste {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return valid(raw) ? decay(raw) : emptyTaste()
  } catch {
    return emptyTaste()
  }
}

const listeners = new Set<() => void>()
export const onTasteChange = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn))

function save(t: Taste) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t))
  } catch {
    /* storage full or blocked: recommendations just stay as they were */
  }
  listeners.forEach((fn) => fn())
}

/** Records an event if recommendations are on (the caller checks private tabs). */
export function noteTaste(app: Features, event: TasteEvent) {
  if (import.meta.env.MODE === 'test') return
  if (!getSettings().storeForYou) return
  save(record(loadTaste(), app, event))
}

export function clearTaste() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
  listeners.forEach((fn) => fn())
}
