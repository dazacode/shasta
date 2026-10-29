// Which models Shasta's on-device AI can run, and which one suits this device. Pure data and logic (unit-tested).
// Every model runs in the visitor's browser through ONNX Runtime (WebGPU when the device has it, otherwise WebAssembly on
// the CPU). Sizes are the real file sizes of the quantized ONNX files on Hugging Face.

export type Kind = 'chat' | 'vision' | 'speech' | 'embed'
export type Tier = 'light' | 'standard'
export type Backend = 'webgpu' | 'wasm'

export interface DeviceProfile {
  /** navigator.deviceMemory (rounded down to 0.25-8 by the browser); null when the browser does not say */
  memoryGb: number | null
  cores: number
  webgpu: boolean
  /** WebGPU shader-f16: lets the smaller fp16 / q4f16 files run */
  f16: boolean
  /** SharedArrayBuffer is available, so WebAssembly can use several threads */
  isolated: boolean
}

export type Dtype = string | Record<string, string>

export interface ModelSpec {
  repo: string
  /** dtype per backend; the choice for webgpu depends on shader-f16 */
  dtype: { wasm: Dtype; webgpu: Dtype; webgpuF16: Dtype }
  /** download size in MB for the files each backend actually fetches */
  mb: { wasm: number; webgpu: number; webgpuF16: number }
}

export interface ChatModel extends ModelSpec {
  tier: Tier
  label: string
  blurb: string
  /** memory the model needs while loaded, roughly (weights + runtime + cache) */
  needsMb: number
  /** token budget for prompt + answer */
  context: number
}

export const CHAT_MODELS: Record<Tier, ChatModel> = {
  light: {
    tier: 'light',
    label: 'Light',
    blurb: 'SmolLM2 360M. Fits a 4 GB Chromebook. Quick, good for summaries and simple questions, weaker at reasoning.',
    repo: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    dtype: { wasm: 'q8', webgpu: 'q4', webgpuF16: 'q4f16' },
    mb: { wasm: 365, webgpu: 388, webgpuF16: 273 },
    needsMb: 800,
    context: 2048,
  },
  standard: {
    tier: 'standard',
    label: 'Standard',
    blurb: 'Qwen3 0.6B. Noticeably better answers, writing and maths. Wants about 1.5 GB free, so use it on 8 GB devices.',
    repo: 'onnx-community/Qwen3-0.6B-ONNX',
    dtype: { wasm: 'q8', webgpu: 'q4', webgpuF16: 'q4f16' },
    mb: { wasm: 618, webgpu: 919, webgpuF16: 570 },
    needsMb: 1500,
    context: 4096,
  },
}

/**
 * Describes pictures and answers questions about them. 256M parameters, Apache-2.0.
 * Always run on the CPU with 8-bit files (see worker.ts): measured on the same test picture, the 4-bit and 16-bit WebGPU
 * variants rambled or invented objects, while this combination described it correctly, and it is just as fast.
 */
const VISION_DTYPE = { embed_tokens: 'q8', vision_encoder: 'q8', decoder_model_merged: 'q8' }
export const VISION_MODEL: ModelSpec = {
  repo: 'HuggingFaceTB/SmolVLM-256M-Instruct',
  dtype: { wasm: VISION_DTYPE, webgpu: VISION_DTYPE, webgpuF16: VISION_DTYPE },
  mb: { wasm: 260, webgpu: 260, webgpuF16: 260 },
}

/**
 * Turns text into vectors so long documents can be searched by meaning ("money troubles" finds "financial hardship"), not just
 * by shared words. 23 MB, Apache-2.0, English. Tiny enough to stay loaded next to a chat model, even on a 4 GB device.
 */
const EMBED_DTYPE = 'q8'
export const EMBED_MODEL: ModelSpec = {
  repo: 'Xenova/all-MiniLM-L6-v2',
  dtype: { wasm: EMBED_DTYPE, webgpu: EMBED_DTYPE, webgpuF16: EMBED_DTYPE },
  mb: { wasm: 24, webgpu: 24, webgpuF16: 24 },
}

/** Speech to text (Whisper). Tiny on small devices, Base elsewhere; both are multilingual. */
export const SPEECH_MODELS: Record<'tiny' | 'base', ModelSpec> = {
  tiny: {
    repo: 'onnx-community/whisper-tiny',
    dtype: { wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }, webgpu: { encoder_model: 'q8', decoder_model_merged: 'q8' }, webgpuF16: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
    mb: { wasm: 43, webgpu: 43, webgpuF16: 43 },
  },
  base: {
    repo: 'onnx-community/whisper-base',
    dtype: { wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }, webgpu: { encoder_model: 'q8', decoder_model_merged: 'q8' }, webgpuF16: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
    mb: { wasm: 80, webgpu: 80, webgpuF16: 80 },
  },
}

export const DEFAULT_PROFILE: DeviceProfile = { memoryGb: null, cores: 2, webgpu: false, f16: false, isolated: false }

/** Is a device small enough that two models must never be in memory at once? (4 GB class and unknown devices.) */
export const isSmallDevice = (p: DeviceProfile) => p.memoryGb === null || p.memoryGb <= 4

/** The model a device should start with. Unknown memory counts as small: a crashed tab is worse than a simpler model. */
export function recommendTier(p: DeviceProfile): Tier {
  if (isSmallDevice(p)) return 'light'
  return 'standard'
}

/**
 * Tiers worth offering on this device. There is deliberately nothing bigger than Standard: ONNX Runtime in a browser tab
 * cannot create a session for a single model file of about 1 GB or more (std::bad_alloc, measured with Qwen3-1.7B q4f16),
 * and a model that cannot load is worse than a smaller one that does.
 */
export function offeredTiers(_p: DeviceProfile): Tier[] {
  return ['light', 'standard']
}

export function speechSize(p: DeviceProfile): 'tiny' | 'base' {
  return isSmallDevice(p) ? 'tiny' : 'base'
}

export const backendFor = (p: DeviceProfile): Backend => (p.webgpu ? 'webgpu' : 'wasm')

export function dtypeFor(spec: ModelSpec, p: DeviceProfile, backend: Backend): Dtype {
  return backend === 'wasm' ? spec.dtype.wasm : p.f16 ? spec.dtype.webgpuF16 : spec.dtype.webgpu
}

export function downloadMb(spec: ModelSpec, p: DeviceProfile, backend: Backend): number {
  return backend === 'wasm' ? spec.mb.wasm : p.f16 ? spec.mb.webgpuF16 : spec.mb.webgpu
}

/** WebAssembly threads to use: leave a core for the browser when there are more than two. */
export function wasmThreads(p: DeviceProfile): number {
  if (!p.isolated) return 1
  return Math.max(1, Math.min(4, p.cores > 2 ? p.cores - 1 : p.cores))
}

export const SERVER_MODEL_PREFIX = '/ai-models/'
