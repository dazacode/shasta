import { describe, expect, it } from 'vitest'
import { CHAT_MODELS, DEFAULT_PROFILE, SPEECH_MODELS, VISION_MODEL, backendFor, downloadMb, dtypeFor, isSmallDevice, offeredTiers, recommendTier, speechSize, wasmThreads, type DeviceProfile } from '@/ai/catalog'

const dev = (over: Partial<DeviceProfile> = {}): DeviceProfile => ({ ...DEFAULT_PROFILE, ...over })

describe('choosing a model for the device', () => {
  it('gives a 4 GB Chromebook the Light model, and never two models at once', () => {
    const chromebook = dev({ memoryGb: 4, cores: 2 })
    expect(recommendTier(chromebook)).toBe('light')
    expect(isSmallDevice(chromebook)).toBe(true)
    expect(offeredTiers(chromebook)).toEqual(['light', 'standard'])
    expect(speechSize(chromebook)).toBe('tiny')
  })
  it('treats a browser that does not report memory as small (a crashed tab is worse than a simpler model)', () => {
    expect(recommendTier(dev({ memoryGb: null }))).toBe('light')
  })
  it('recommends Standard from 8 GB, and never offers a model too big for one browser-side session', () => {
    expect(recommendTier(dev({ memoryGb: 8 }))).toBe('standard')
    expect(recommendTier(dev({ memoryGb: 16, webgpu: true, f16: true }))).toBe('standard')
    expect(offeredTiers(dev({ memoryGb: 16, webgpu: true }))).toEqual(['light', 'standard'])
    for (const t of Object.values(CHAT_MODELS)) expect(Math.max(t.mb.wasm, t.mb.webgpu, t.mb.webgpuF16)).toBeLessThan(1000)
    expect(speechSize(dev({ memoryGb: 8 }))).toBe('base')
  })
})

describe('files fetched per backend', () => {
  it('uses the CPU on devices without WebGPU, with 8-bit weights', () => {
    const p = dev({ memoryGb: 4 })
    expect(backendFor(p)).toBe('wasm')
    expect(dtypeFor(CHAT_MODELS.light, p, 'wasm')).toBe('q8')
    expect(downloadMb(CHAT_MODELS.light, p, 'wasm')).toBe(365)
  })
  it('picks the 16-bit friendly files only when the GPU supports shader-f16', () => {
    const f16 = dev({ webgpu: true, f16: true })
    const no16 = dev({ webgpu: true, f16: false })
    expect(dtypeFor(CHAT_MODELS.standard, f16, 'webgpu')).toBe('q4f16')
    expect(dtypeFor(CHAT_MODELS.standard, no16, 'webgpu')).toBe('q4')
    expect(downloadMb(CHAT_MODELS.standard, f16, 'webgpu')).toBeLessThan(downloadMb(CHAT_MODELS.standard, no16, 'webgpu'))
  })
  it('keeps every model small enough for its tier', () => {
    expect(CHAT_MODELS.light.needsMb).toBeLessThan(1000)
    expect(SPEECH_MODELS.tiny.mb.wasm).toBeLessThan(SPEECH_MODELS.base.mb.wasm)
    for (const t of Object.values(CHAT_MODELS)) expect(t.repo).toMatch(/^(onnx-community|HuggingFaceTB)\//)
  })
})

describe('the picture model', () => {
  it('uses the same verified 8-bit files on every device', () => {
    expect(VISION_MODEL.dtype.webgpu).toEqual(VISION_MODEL.dtype.wasm)
    expect(VISION_MODEL.dtype.webgpuF16).toEqual(VISION_MODEL.dtype.wasm)
    expect(JSON.stringify(VISION_MODEL.dtype.wasm)).not.toMatch(/q4|fp16/)
  })
})

describe('threads', () => {
  it('is single threaded without cross-origin isolation, and leaves a core free otherwise', () => {
    expect(wasmThreads(dev({ isolated: false, cores: 8 }))).toBe(1)
    expect(wasmThreads(dev({ isolated: true, cores: 2 }))).toBe(2)
    expect(wasmThreads(dev({ isolated: true, cores: 4 }))).toBe(3)
    expect(wasmThreads(dev({ isolated: true, cores: 16 }))).toBe(4)
  })
})
