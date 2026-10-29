// "This page needs a newer Chrome": turns a crash in a proxied page into the browser feature it was missing. Only says
// so when the feature really is missing here (tested in this browser, wasm-feature-detect for WebAssembly), so an
// ordinary bug in a site never shows up as "your Chrome is too old". School Chromebooks past their last update (e.g.
// Chrome 126) are the case this is for: games built for 64-bit WebAssembly memory crash there at start.
import * as wasm from 'wasm-feature-detect'

export interface MissingFeature {
  /** plain words: what the page uses */
  name: string
  /** first Chrome version that has it */
  minChrome: number
}

/** This browser's Chrome major version, or null when it is not Chrome. */
export function chromeVersion(ua = navigator.userAgent): number | null {
  const m = /\b(?:Chrome|Chromium|CriOS)\/(\d+)/.exec(ua)
  return m ? Number(m[1]) : null
}

type Probe = () => Promise<boolean>

// WebAssembly features and the Chrome that shipped them, newest first (the first missing one is named)
const WASM: { name: string; minChrome: number; probe: Probe }[] = [
  { name: 'WebAssembly exception handling (exnref)', minChrome: 137, probe: wasm.exceptionsFinal },
  { name: 'WebAssembly stack switching (JSPI)', minChrome: 137, probe: wasm.jspi },
  { name: '64-bit WebAssembly memory', minChrome: 133, probe: wasm.memory64 },
  { name: 'WebAssembly string built-ins', minChrome: 130, probe: wasm.jsStringBuiltins },
  { name: 'WebAssembly multiple memories', minChrome: 120, probe: wasm.multiMemory },
  { name: 'WebAssembly garbage collection', minChrome: 119, probe: wasm.gc },
  { name: 'WebAssembly typed function references', minChrome: 119, probe: wasm.typedFunctionReferences },
  { name: 'WebAssembly relaxed SIMD', minChrome: 114, probe: wasm.relaxedSimd },
  { name: 'WebAssembly extended constants', minChrome: 114, probe: wasm.extendedConst },
  { name: 'WebAssembly tail calls', minChrome: 112, probe: wasm.tailCall },
  { name: 'WebAssembly SIMD', minChrome: 91, probe: wasm.simd },
]

const has = (path: string): boolean => {
  let v: unknown = globalThis
  for (const k of path.split('.')) {
    if (v == null) return false
    v = (v as Record<string, unknown>)[k]
  }
  return v !== undefined
}

// newer JavaScript built-ins a page may call: matched by name in "X is not a function / not defined"
const JS_APIS: { api: string; minChrome: number; present: () => boolean }[] = [
  { api: 'Uint8Array.fromBase64', minChrome: 140, present: () => has('Uint8Array.fromBase64') },
  { api: 'RegExp.escape', minChrome: 136, present: () => has('RegExp.escape') },
  { api: 'Float16Array', minChrome: 135, present: () => has('Float16Array') },
  { api: 'Error.isError', minChrome: 134, present: () => has('Error.isError') },
  { api: 'Promise.try', minChrome: 128, present: () => has('Promise.try') },
  { api: 'Set.prototype.union', minChrome: 122, present: () => has('Set.prototype.union') },
  { api: 'Iterator.prototype.toArray', minChrome: 122, present: () => has('Iterator.prototype.toArray') },
  { api: 'Array.fromAsync', minChrome: 121, present: () => has('Array.fromAsync') },
  { api: 'Promise.withResolvers', minChrome: 119, present: () => has('Promise.withResolvers') },
  { api: 'Object.groupBy', minChrome: 117, present: () => has('Object.groupBy') },
]

const firstMissing = async (list: typeof WASM): Promise<MissingFeature | null> => {
  for (const f of list) if (!(await f.probe().catch(() => false))) return { name: f.name, minChrome: f.minChrome }
  return null
}

/**
 * The feature a crash came from, when this browser lacks it; null for anything else (a site's own bug, a network
 * failure). `message` is the error's text as the page or worker reported it.
 */
export async function diagnoseCrash(message: string): Promise<MissingFeature | null> {
  // 64-bit memory: Chrome before 133 ignores `address: "i64"` and chokes on the BigInt sizes
  if (/Cannot convert a BigInt value to a number|memory64|address.{0,20}i64/i.test(message)) {
    if (!(await wasm.memory64().catch(() => false))) return { name: '64-bit WebAssembly memory', minChrome: 133 }
  }
  // a module this browser cannot compile: name the newest WebAssembly feature it lacks
  if (/CompileError|LinkError|WebAssembly\.(instantiate|compile|Module)|invalid (opcode|value type|heap type|type)|unknown (type|opcode)/i.test(message)) {
    const missing = await firstMissing(WASM)
    if (missing) return missing
  }
  if (/navigator\.gpu|requestAdapter|WebGPU/i.test(message) && !('gpu' in navigator)) return { name: 'WebGPU', minChrome: 113 }
  if (/is not (a function|defined|a constructor)/.test(message)) {
    for (const j of JS_APIS) {
      const short = j.api.split('.').pop()!
      if (message.includes(short) && !j.present()) return { name: `the JavaScript feature ${j.api}`, minChrome: j.minChrome }
    }
  }
  return null
}

/** The notice's words, e.g. "This game needs Chrome 133 or newer (64-bit WebAssembly memory); this device has Chrome 126." */
export function describeMissing(f: MissingFeature, what: 'game' | 'app' | 'page', version = chromeVersion()): string {
  const have = version ? `; this device has Chrome ${version}` : ''
  return `This ${what} needs Chrome ${f.minChrome} or newer (${f.name})${have}.`
}
