import { describe, expect, test } from 'vitest'
import SHIM from '@/proxy/inject/memory64.js?raw'
import FORWARD from '@/proxy/inject/consoleForward.js?raw'
import { wasmIs64 } from '@/proxy/memory64Shim'
import { prependBody } from '@/proxy/workerPrelude'

const HEAD = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]
const mod = (...sections: number[][]) => new Uint8Array([...HEAD, ...sections.flat()])
const sec = (id: number, body: number[]) => [id, body.length, ...body]
const name = (s: string) => [s.length, ...new TextEncoder().encode(s)]

describe('wasmIs64 (which .wasm files get converted)', () => {
  test('64-bit memories and tables, defined or imported', () => {
    expect(wasmIs64(mod(sec(5, [1, 0x04, 1])))).toBe(true)
    expect(wasmIs64(mod(sec(4, [1, 0x70, 0x04, 1])))).toBe(true)
    const fn = [...name('env'), ...name('f'), 0x00, 0x00]
    const mem = [...name('env'), ...name('memory'), 0x02, 0x07, 0x80, 0x80, 0x03, 0x80, 0x80, 0x10]
    expect(wasmIs64(mod(sec(1, [1, 0x60, 0, 0]), sec(2, [2, ...fn, ...mem])))).toBe(true)
  })
  test('32-bit modules and other files are left alone', () => {
    expect(wasmIs64(mod(sec(5, [1, 0x03, 1, 2])))).toBe(false)
    expect(wasmIs64(new TextEncoder().encode('<!doctype html>'))).toBe(false)
  })
  test('null while the declarations have not arrived yet (keep reading)', () => {
    expect(wasmIs64(new Uint8Array([...HEAD, 2, 40, 1]))).toBe(null)
  })
})

/** A fake realm that behaves like Chrome 126: no Memory64, 2 GiB view limits, no clip distances. */
function chrome126() {
  class Memory {
    desc: any
    constructor(d: any) {
      if (typeof d.initial === 'bigint' || typeof d.maximum === 'bigint') throw new TypeError('Cannot convert a BigInt value to a number')
      this.desc = d
    }
    grow(n: unknown) {
      if (typeof n === 'bigint') throw new TypeError('Cannot convert a BigInt value to a number')
      return 7
    }
  }
  class Table {
    desc: any
    constructor(d: any) {
      if (typeof d.initial === 'bigint') throw new TypeError('Cannot convert a BigInt value to a number')
      this.desc = d
    }
    get(i: unknown) {
      if (typeof i === 'bigint') throw new TypeError('Cannot convert a BigInt value to a number')
      return `fn${i}`
    }
    set() {}
    grow() {
      return 3
    }
  }
  const shaders: string[] = []
  class GPUDevice {
    features = new Set<string>()
    createShaderModule(d: { code: string }) {
      shaders.push(d.code)
      return {}
    }
    createTexture(d: unknown) {
      return { d }
    }
  }
  class GPUTexture {
    createView(d: unknown) {
      return d
    }
  }
  const logs: string[] = []
  const G: any = {
    WebAssembly: { Memory, Table, compile: async () => ({}), instantiate: async () => ({}) },
    GPUDevice,
    GPUTexture,
    console: { info: (m: string) => logs.push(m) },
  }
  return { G, shaders, logs }
}

const run = (G: unknown) => (new Function(`return (\n${SHIM}\n)`)() as (g: unknown) => void)(G)

describe('the Memory64 shim (inject/memory64.js)', () => {
  test('a 64-bit memory request becomes a 32-bit one, capped at 4 GiB', () => {
    const { G, logs } = chrome126()
    run(G)
    const m = new G.WebAssembly.Memory({ initial: 49152n, maximum: 262144n, shared: true, address: 'i64' })
    expect(m.desc).toEqual({ initial: 49152, maximum: 65536, shared: true })
    // grow takes and gives BigInts, like a 64-bit memory
    expect(m.grow(2n)).toBe(7n)
    expect(logs.some((l) => l.includes('giving it 32-bit memory (3072 MB, max 4096 MB, shared)'))).toBe(true)
  })
  test('32-bit requests are untouched; tables accept BigInt indexes', () => {
    const { G } = chrome126()
    run(G)
    const m = new G.WebAssembly.Memory({ initial: 16, maximum: 32 })
    expect(m.desc).toEqual({ initial: 16, maximum: 32 })
    expect(m.grow(1)).toBe(7)
    const t = new G.WebAssembly.Table({ initial: 4n, element: 'anyfunc', address: 'i64' })
    expect(t.get(BigInt(3))).toBe('fn3')
  })
  test('does nothing on a browser that has Memory64', () => {
    const { G } = chrome126()
    const Mem = class {
      constructor(_d: unknown) {}
    }
    G.WebAssembly.Memory = Mem
    run(G)
    expect(G.WebAssembly.Memory).toBe(Mem)
  })
  test('clip_distances is stripped from Tint shaders (struct member AND constructor argument)', () => {
    const { G, shaders } = chrome126()
    run(G)
    const code = `enable clip_distances;
var<private> o0 : vec4<f32>;
var<private> o3 : array<f32, 4u>;
struct tint_symbol_5 {
  @location(0u)
  o0 : vec4<f32>,
  @builtin(position)
  o2 : vec4<f32>,
  @builtin(clip_distances)
  o3 : array<f32, 4u>,
  @location(15u)
  tint_symbol_4 : vec4<f32>,
}
@vertex
fn main() -> tint_symbol_5 {
  return tint_symbol_5(o0, vec4<f32>(0.0), o3, vec4<f32>(o3[0u], o3[1u], o3[2u], o3[3u]));
}`
    new G.GPUDevice().createShaderModule({ code })
    const out = shaders[0]
    expect(out).not.toContain('enable clip_distances')
    expect(out).not.toContain('@builtin(clip_distances)')
    expect(out).toContain('return tint_symbol_5(o0, vec4<f32>(0.0), vec4<f32>(o3[0u], o3[1u], o3[2u], o3[3u]));')
  })
  test('a device that has clip distances keeps the shader as it is', () => {
    const { G, shaders } = chrome126()
    run(G)
    const dev = new G.GPUDevice()
    dev.features.add('clip-distances')
    dev.createShaderModule({ code: 'enable clip_distances;\nfn x() {}' })
    expect(shaders[0]).toContain('enable clip_distances')
  })
  test('snorm render targets become 16-bit float ones', () => {
    const { G } = chrome126()
    run(G)
    const t = new G.GPUDevice().createTexture({ format: 'rgba8snorm', usage: 0x10 | 0x04 })
    expect(t.d.format).toBe('rgba16float')
    const sampledOnly = new G.GPUDevice().createTexture({ format: 'rgba8snorm', usage: 0x04 })
    expect(sampledOnly.d.format).toBe('rgba8snorm')
  })
})

describe('worker prelude', () => {
  test('the console forwarder is valid script text', () => {
    expect(() => new Function(`return (\n${FORWARD}\n)`)).not.toThrow()
  })
  test('prepends to every body shape Scramjet hands the hooks', async () => {
    expect(prependBody('b()', 'a();')).toBe('a();b()')
    const fromBuffer = prependBody(new TextEncoder().encode('b()').buffer, 'a();') as ArrayBuffer
    expect(new TextDecoder().decode(fromBuffer)).toBe('a();b()')
    const stream = new Response('b()').body!
    expect(await new Response(prependBody(stream, 'a();') as ReadableStream).text()).toBe('a();b()')
    expect(await (prependBody(new Blob(['b()']), 'a();') as Blob).text()).toBe('a();b()')
  })
})
