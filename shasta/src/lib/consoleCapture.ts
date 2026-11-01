// In-app console (Settings -> Advanced -> Console): what DevTools' console would show, for people whose school
// blocks DevTools. Copies console.* calls and uncaught errors from Shasta's own window and from every proxied frame
// into a memory-only ring buffer. Nothing is sent anywhere; the person copies it out by hand.
import { create } from 'zustand'

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface ConsoleEntry {
  id: number
  at: number
  level: ConsoleLevel
  /** 'Shasta' for the app itself, else the page's hostname */
  source: string
  text: string
}

const LIMIT = 1000
const MAX_TEXT = 4000
const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
let seq = 0
let pending: ConsoleEntry[] = []
let timer: ReturnType<typeof setTimeout> | undefined

interface ConsoleState {
  entries: ConsoleEntry[]
  clear: () => void
}

export const useConsole = create<ConsoleState>()((set) => ({
  entries: [],
  clear: () => set({ entries: [] }),
}))

// pages can log thousands of lines a second: batch them so the store (and Settings, if open) updates a few times a second
function push(level: ConsoleLevel, source: string, text: string) {
  pending.push({ id: ++seq, at: Date.now(), level, source, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text })
  if (pending.length > LIMIT) pending = pending.slice(-LIMIT)
  timer ??= setTimeout(() => {
    timer = undefined
    const add = pending
    pending = []
    useConsole.setState((s) => ({ entries: [...s.entries, ...add].slice(-LIMIT) }))
  }, 250)
}

function describe(v: unknown, depth = 0): string {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (typeof v === 'symbol') return v.toString()
  if (typeof v === 'function') return `ƒ ${v.name || 'anonymous'}()`
  try {
    // cross-realm values (a proxied frame's Error) fail instanceof, so duck-type
    const o = v as Record<string, unknown>
    if (typeof o.message === 'string' && typeof o.name === 'string' && 'stack' in o) return typeof o.stack === 'string' && o.stack.includes(o.message) ? o.stack : `${o.name}: ${o.message}`
    if (typeof o.nodeType === 'number' && typeof o.nodeName === 'string') return `<${String(o.nodeName).toLowerCase()}>`
    if (depth >= 2) return Array.isArray(v) ? `Array(${v.length})` : '{…}'
    if (Array.isArray(v)) return `[${v.slice(0, 50).map((x) => describe(x, depth + 1)).join(', ')}${v.length > 50 ? ', …' : ''}]`
    const keys = Object.keys(o).slice(0, 30)
    const name = (o.constructor as { name?: string } | undefined)?.name
    const body = `{${keys.map((k) => `${k}: ${describe(o[k], depth + 1)}`).join(', ')}${Object.keys(o).length > 30 ? ', …' : ''}}`
    return name && name !== 'Object' ? `${name} ${body}` : body
  } catch {
    return Object.prototype.toString.call(v)
  }
}

// console.log('%cStyled', 'color: red', x): drop the format directives and their style arguments
function format(args: unknown[]): string {
  if (typeof args[0] === 'string' && /%[cdisfoO]/.test(args[0])) {
    const rest = args.slice(1)
    const first = args[0].replace(/%([cdisfoO%])/g, (m, f: string) => {
      if (f === '%') return '%'
      if (!rest.length) return m
      const a = rest.shift()
      return f === 'c' ? '' : describe(a, 1)
    })
    args = [first, ...rest]
  }
  return args.map((a) => describe(a)).join(' ')
}

const hooked = new WeakSet<object>()

/** Copies a window's console and uncaught errors into the in-app console. Safe to call twice for one window. */
export function captureConsole(win: Window, source: string | (() => string)) {
  const name = typeof source === 'function' ? source : () => source
  let con: Console
  try {
    con = (win as Window & { console: Console }).console
    if (!con || hooked.has(con)) return
    hooked.add(con)
  } catch {
    return
  }
  for (const level of LEVELS) {
    const original = con[level]
    if (typeof original !== 'function') continue
    try {
      con[level] = function (this: Console, ...args: unknown[]) {
        try {
          push(level, name(), format(args))
        } catch {
          // never break the page's own logging
        }
        return original.apply(this, args)
      }
    } catch {
      // read-only console in this frame
    }
  }
  try {
    win.addEventListener('error', (e: ErrorEvent) => {
      const where = e.filename ? ` (${e.filename.replace(/[?#].*$/, '')}:${e.lineno})` : ''
      push('error', name(), `Uncaught ${e.error ? describe(e.error) : e.message}${where}`)
    })
    win.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => push('error', name(), `Uncaught (in promise) ${describe(e.reason)}`))
  } catch {
    // no events on this window
  }
}

let listening = false
let workerChannel: BroadcastChannel | null = null
/**
 * Lines from proxied WORKERS (proxy/inject/consoleForward.js, put in front of every worker script): games run in
 * workers, whose console never reaches a window. Same-origin BroadcastChannel; shown as text only.
 */
export function listenToWorkers(channel = 'shasta-devtools') {
  if (listening || typeof BroadcastChannel === 'undefined') return
  listening = true
  try {
    // kept in a module variable so it is never collected
    workerChannel = new BroadcastChannel(channel)
    workerChannel.onmessage = (e: MessageEvent) => {
      // a message posted through Scramjet's patched postMessage arrives wrapped: { $scramjet$data: … }
      const raw = e.data as Record<string, unknown> | null
      const d = (raw && typeof raw === 'object' && '$scramjet$data' in raw ? raw.$scramjet$data : raw) as { kind?: unknown; level?: unknown; source?: unknown; text?: unknown } | null
      if (!d || d.kind !== 'shasta-console' || typeof d.text !== 'string' || typeof d.source !== 'string') return
      const level = LEVELS.includes(d.level as ConsoleLevel) ? (d.level as ConsoleLevel) : 'log'
      push(level, d.source.slice(0, 120), d.text)
    }
  } catch {
    listening = false
  }
}

export function consoleText(entries: ConsoleEntry[]): string {
  return entries.map((e) => `${new Date(e.at).toISOString()} [${e.source}] ${e.level.toUpperCase()} ${e.text}`).join('\n')
}

/** test hook */
export function _flush() {
  if (timer) clearTimeout(timer)
  timer = undefined
  const add = pending
  pending = []
  useConsole.setState((s) => ({ entries: [...s.entries, ...add].slice(-LIMIT) }))
}
