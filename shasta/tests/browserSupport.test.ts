import { beforeEach, describe, expect, it, vi } from 'vitest'

// what the WebAssembly probes answer: set per test (true = the feature exists in "this browser")
const wasmHas: Record<string, boolean> = {}
vi.mock('wasm-feature-detect', () => {
  const probe = (name: string) => async () => wasmHas[name] ?? true
  const names = ['exceptionsFinal', 'jspi', 'memory64', 'jsStringBuiltins', 'multiMemory', 'gc', 'typedFunctionReferences', 'relaxedSimd', 'extendedConst', 'tailCall', 'simd']
  return Object.fromEntries(names.map((n) => [n, probe(n)]))
})

const { chromeVersion, describeMissing, diagnoseCrash } = await import('@/lib/browserSupport')

// the user's school Chromebook (board "snappy", past its last update)
const CHROMEBOOK_126 = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

beforeEach(() => {
  for (const k of Object.keys(wasmHas)) delete wasmHas[k]
})

describe('diagnoseCrash', () => {
  it('names 64-bit WebAssembly memory when a game crashes on it (fiveplay.lol on Chrome 126)', async () => {
    wasmHas.memory64 = false
    expect(await diagnoseCrash('Uncaught TypeError: Cannot convert a BigInt value to a number')).toEqual({ name: '64-bit WebAssembly memory', minChrome: 133 })
  })

  it('says nothing when the browser has the feature: the crash is the site’s own', async () => {
    expect(await diagnoseCrash('Uncaught TypeError: Cannot convert a BigInt value to a number')).toBeNull()
    expect(await diagnoseCrash('TypeError: Cannot read properties of undefined (reading "x")')).toBeNull()
  })

  it('names the newest missing WebAssembly feature for a module that does not compile', async () => {
    wasmHas.gc = false
    wasmHas.typedFunctionReferences = false
    expect(await diagnoseCrash('CompileError: WebAssembly.instantiate(): invalid value type 0x64')).toEqual({ name: 'WebAssembly garbage collection', minChrome: 119 })
  })

  it('names a newer JavaScript built-in the page called', async () => {
    const saved = (Promise as { try?: unknown }).try
    delete (Promise as { try?: unknown }).try
    try {
      expect(await diagnoseCrash('TypeError: Promise.try is not a function')).toEqual({ name: 'the JavaScript feature Promise.try', minChrome: 128 })
    } finally {
      if (saved) (Promise as { try?: unknown }).try = saved
    }
  })
})

describe('describeMissing', () => {
  it('reads the Chrome version and says what is needed', () => {
    expect(chromeVersion(CHROMEBOOK_126)).toBe(126)
    expect(chromeVersion('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/140.0')).toBeNull()
    expect(describeMissing({ name: '64-bit WebAssembly memory', minChrome: 133 }, 'game', 126)).toBe(
      'This game needs Chrome 133 or newer (64-bit WebAssembly memory); this device has Chrome 126.',
    )
  })
})
