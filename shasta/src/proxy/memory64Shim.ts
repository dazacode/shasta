// Memory64 games on a Chrome without Memory64 (school Chromebooks stuck on Chrome 126; Memory64 shipped in 133).
//
// Two halves, both generic (nothing here knows about any one game):
// 1. The game's .wasm is converted on Shasta's server (binaryen --memory64-lowering, server/src/services/wasmLower.ts):
//    its memory and function table become 32-bit, every load/store wraps its 64-bit address. Function signatures keep
//    their i64 pointers, so the game's own JS keeps passing BigInts to wasm functions and that still works.
// 2. This shim runs in every proxied window AND worker before the page's own scripts. A Memory64 build's JS creates its
//    memory as `new WebAssembly.Memory({initial: 49152n, maximum: 262144n, address: 'i64'})` and indexes its table with
//    BigInts; Chrome 126 throws "Cannot convert a BigInt value to a number" there. The shim turns those into the 32-bit
//    equivalents (maximum capped at 4 GiB) and hands BigInts back where a 64-bit memory/table would.
//
// Limit: a game that really needs more than 4 GiB cannot be lowered; the server refuses it and the "needs a newer
// Chrome" notice stays. The shim is a no-op on a browser that has Memory64.
//
// The shim itself is plain JS in inject/memory64.js (a list of every patch is at its top), imported as text: it is
// prepended to worker scripts as-is, and `installMemory64Shim` runs the same text in a window. Text, not
// `fn.toString()`: the production obfuscator moves string literals into a shared table a serialized function cannot reach.

import SHIM from './inject/memory64.js?raw'

/** Source text of the shim as one self-running statement, for prepending to worker scripts. */
export const SHIM_SOURCE = `;(\n${SHIM}\n)(self);\n`

/** Runs the shim in a window (a proxied frame's init.post). */
export function installMemory64Shim(win: Window) {
  if (hasMemory64()) return
  try {
    // the shell's own Function: a page's CSP cannot refuse it (the installed app's CSP does; there it simply stays off)
    ;(new Function(`return (\n${SHIM}\n)`)() as (g: unknown) => void)(win)
  } catch {
    // never break the page
  }
}

let support: boolean | undefined
/** Whether THIS browser has Memory64 (the shell's own check; the shim checks again in each realm). */
export function hasMemory64(): boolean {
  if (support === undefined) {
    try {
      new (WebAssembly as any).Memory({ initial: 1n, maximum: 1n, address: 'i64' })
      support = true
    } catch {
      support = false
    }
  }
  return support
}

/**
 * Does this wasm binary declare a 64-bit memory or table? Reads only the import, table and memory sections (they sit near
 * the start; the code section comes after), so the first few hundred KB of the file are enough. Returns null when the
 * bytes end before those sections were seen.
 */
export function wasmIs64(bytes: Uint8Array): boolean | null {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) return false
  let p = 8
  const u = () => {
    let r = 0
    let s = 0
    let b
    do {
      if (p >= bytes.length) throw new RangeError('eof')
      b = bytes[p++]
      if (s < 35) r += (b & 0x7f) * 2 ** s
      s += 7
    } while (b & 0x80)
    return r
  }
  const skipName = () => {
    const n = u()
    p += n
  }
  // limits flags: bit 2 (0x04) = 64-bit index
  const limits64 = () => {
    const f = bytes[p++]
    u()
    if (f & 1) u()
    return (f & 4) !== 0
  }
  try {
    while (p < bytes.length) {
      const id = bytes[p++]
      const size = u()
      const end = p + size
      if (id === 10 || id === 11) return false // code/data: every declaration is behind us
      if (end > bytes.length && (id === 2 || id === 4 || id === 5)) return null
      if (id === 2) {
        const n = u()
        for (let i = 0; i < n; i++) {
          skipName()
          skipName()
          const kind = bytes[p++]
          if (kind === 0) u()
          else if (kind === 1) {
            readRefType()
            if (limits64()) return true
          } else if (kind === 2) {
            if (limits64()) return true
          } else if (kind === 3) {
            readValType()
            p++
          } else if (kind === 4) {
            p++
            u()
          } else return false
        }
      } else if (id === 4) {
        const n = u()
        for (let i = 0; i < n; i++) {
          const withInit = bytes[p] === 0x40
          if (withInit) p += 2 // a table with an init expression: 0x40 0x00, then the table type, then the expression
          readRefType()
          if (limits64()) return true
          if (withInit) break // init expressions are not parsed; skip the rest of the section
        }
      } else if (id === 5) {
        const n = u()
        for (let i = 0; i < n; i++) if (limits64()) return true
      }
      if (end > bytes.length) return null
      p = end
    }
  } catch {
    return null
  }
  return false

  function readRefType() {
    const t = bytes[p++]
    if (t === 0x63 || t === 0x64) readHeapType()
  }
  function readValType() {
    const t = bytes[p++]
    if (t === 0x63 || t === 0x64) readHeapType()
  }
  function readHeapType() {
    // s33: one LEB byte for the abstract types, more for a type index
    let b
    do b = bytes[p++]
    while (b & 0x80)
  }
}
