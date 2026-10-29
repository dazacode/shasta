// Keeps Shasta from taking the whole device down. Web pages cannot read VRAM or system RAM, so this
// watches what is observable: JS heap pressure (Chromium only), frame pacing, and how many pages are loaded.
import { create } from 'zustand'
import { useTabs } from '@/stores/tabsStore'
import { useSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { useLog } from '@/stores/logStore'

export type Pressure = 'ok' | 'high' | 'critical'

interface Resources {
  pressure: Pressure
  usedMB: number | null
  limitMB: number | null
  /** average frames per second over the last sample window, null until measured */
  fps: number | null
  /** Compute Pressure API (Chromium): the system's own view of CPU load; null when unsupported */
  cpu: 'nominal' | 'fair' | 'serious' | 'critical' | null
  live: number
  cap: number
}

export const useResources = create<Resources>()(() => ({ pressure: 'ok', usedMB: null, limitMB: null, fps: null, cpu: null, live: 0, cap: 8 }))

type PerfWithMemory = Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }

/** Most pages worth keeping loaded: ~2 per GB of device memory (the API reports at most 8), 4–12. */
export function liveTabCap(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  return Math.min(12, Math.max(4, Math.round(gb * 2)))
}

const HIGH = 0.65
const CRITICAL = 0.85
const SLOW_FRAME_MS = 90
const WARN_COOLDOWN_MS = 90_000

let started = false
let lastWarn = 0
let slowWindows = 0

function warn(message: string, action = true) {
  const tabs = useTabs.getState()
  const suspendable = tabs.tabs.filter((t) => t.id !== tabs.activeId && t.frame && !t.suspended).length
  // a single busy tab (a game loading) has nothing to hand back: don't nag, just record it
  if (action && !suspendable) return void useLog.getState().add('info', message)
  const now = Date.now()
  if (now - lastWarn < WARN_COOLDOWN_MS) return
  lastWarn = now
  useLog.getState().add('warn', message)
  useUi.getState().toast(message, {
    tone: 'error',
    ms: 12_000,
    action: action ? { label: 'Suspend background tabs', run: () => useTabs.getState().suspendBackground(1) } : undefined,
  })
}

function sample() {
  if (!useSettings.getState().settings.resourceGuard || document.hidden) return
  const mem = (performance as PerfWithMemory).memory
  const cap = liveTabCap()
  const live = useTabs.getState().tabs.filter((t) => t.frame && !t.suspended).length
  let pressure: Pressure = 'ok'
  let usedMB: number | null = null
  let limitMB: number | null = null
  let ratio = 0
  if (mem) {
    usedMB = Math.round(mem.usedJSHeapSize / 1048576)
    limitMB = Math.round(mem.jsHeapSizeLimit / 1048576)
    ratio = mem.usedJSHeapSize / mem.jsHeapSizeLimit
    pressure = ratio >= CRITICAL ? 'critical' : ratio >= HIGH ? 'high' : 'ok'
  }
  const cpu = useResources.getState().cpu
  if ((slowWindows >= 2 || cpu === 'serious' || cpu === 'critical') && pressure === 'ok') pressure = 'high'
  if (cpu === 'critical' && slowWindows >= 2) pressure = 'critical'

  const prev = useResources.getState().pressure
  useResources.setState({ pressure, usedMB, limitMB, live, cap })

  // a heavy page (a game, a big app) is still loading while memory is already half used: give it the whole device
  const tabs = useTabs.getState()
  const active = tabs.tabs.find((t) => t.id === tabs.activeId)
  if (active?.loading && ratio >= 0.5) {
    const n = tabs.suspendBackground(1)
    if (n) useUi.getState().toast(`Paused ${n} background tab${n > 1 ? 's' : ''} so this page has the memory it needs to finish loading.`)
  }

  // too many loaded pages: quietly release the least recently used ones
  if (live > cap) {
    const n = useTabs.getState().suspendBackground(cap)
    if (n) useUi.getState().toast(`Paused ${n} background tab${n > 1 ? 's' : ''} to keep your device responsive. They reload when you open them.`)
  }
  if (pressure === 'critical') {
    const n = useTabs.getState().suspendBackground(1)
    warn(
      n
        ? `Memory is almost full, so Shasta paused ${n} background tab${n > 1 ? 's' : ''}. Close tabs or heavy games to avoid a crash.`
        : 'Memory is almost full. Close heavy tabs or games to avoid a crash.',
      false,
    )
  } else if (pressure === 'high' && prev !== 'high') {
    warn(cpu === 'serious' || cpu === 'critical' ? 'Your processor is under heavy load. Pause background tabs to keep Shasta and your device responsive.' : slowWindows >= 2 ? 'Shasta is running slowly. Your device may be short on memory or graphics power.' : 'Shasta is using a lot of memory, like a game close to its VRAM limit. Pause background tabs to keep things smooth.')
  }
}

/** Measures frame pacing: a sustained average gap over ~90ms means the CPU/GPU cannot keep up. */
function watchFrames() {
  let last = performance.now()
  let frames = 0
  let windowStart = last
  const tick = (now: number) => {
    if (document.hidden) {
      last = windowStart = now
      frames = 0
    } else {
      frames++
      last = now
      if (now - windowStart >= 5000) {
        const avg = (now - windowStart) / frames
        useResources.setState({ fps: Math.round(1000 / avg) })
        slowWindows = avg > SLOW_FRAME_MS ? slowWindows + 1 : 0
        frames = 0
        windowStart = now
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  void last
}

type PressureRecord = { state: NonNullable<Resources['cpu']> }
declare const PressureObserver: (new (cb: (records: PressureRecord[]) => void) => { observe(source: 'cpu', opts?: { sampleInterval: number }): Promise<void> }) | undefined

function watchCpuPressure() {
  try {
    if (typeof PressureObserver === 'undefined') return
    const observer = new PressureObserver((records) => useResources.setState({ cpu: records[records.length - 1].state }))
    void observer.observe('cpu', { sampleInterval: 2000 }).catch(() => undefined)
  } catch {
    /* blocked by permissions policy or unsupported */
  }
}

export function startResourceGuard() {
  if (started) return
  started = true
  watchCpuPressure()
  watchFrames()
  setInterval(sample, 5000)
  setTimeout(sample, 1500)
}
