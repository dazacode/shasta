/// <reference lib="webworker" />
// The inference worker. Everything heavy happens here, off the page's main thread: loading models, generating text,
// describing images and transcribing speech. It is the only file that imports transformers.js.
import { AutoModelForCausalLM, AutoModelForVision2Seq, AutoProcessor, AutoTokenizer, InterruptableStoppingCriteria, RawImage, TextStreamer, env, pipeline } from '@huggingface/transformers'
import { CHAT_MODELS, EMBED_MODEL, SPEECH_MODELS, VISION_MODEL, backendFor, dtypeFor, isSmallDevice, wasmThreads, type Backend, type DeviceProfile, type Kind, type Tier } from './catalog'
import type { ChatMessage, TranscriptChunk, WorkerEvent, WorkerRequest } from './types'

// transformers.js is loosely typed around generation inputs; keep the looseness in this one file
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

let profile: DeviceProfile
const post = (e: WorkerEvent) => self.postMessage(e)

interface Loaded {
  backend: Backend
  dispose: () => Promise<void> | void
  [k: string]: Any
}
const loaded = new Map<string, Loaded>() // key: chat:<tier> | vision | speech:<size>
/** kinds whose WebGPU run failed at run time: they use the CPU from then on (until the page reloads) */
const gpuBroken = new Set<Kind>()
const GPU_FAILURE = /memory|alloc|buffer|device (was )?lost|out of|OOM|exceeds|limit|GPU/i
// the picture model is CPU only: its WebGPU variants gave wrong answers in testing (see catalog.ts)
const preferred = (kind: Kind): Backend => (kind === 'vision' || gpuBroken.has(kind) ? 'wasm' : backendFor(profile))
const interrupts = new Map<number, InterruptableStoppingCriteria>()
const aborted = new Set<number>()

const kindOf = (key: string): Kind => (key.startsWith('chat') ? 'chat' : key.startsWith('vision') ? 'vision' : key.startsWith('embed') ? 'embed' : 'speech')

async function unload(kinds: Kind[], except?: string) {
  for (const [key, m] of [...loaded]) {
    if (key === except || !kinds.includes(kindOf(key))) continue
    loaded.delete(key)
    try {
      await m.dispose()
    } catch {
      /* already gone */
    }
  }
}

/** On a small device only one model may be resident: free the others before loading another. */
async function makeRoom(key: string) {
  if (isSmallDevice(profile)) await unload(['chat', 'vision', 'speech'], key)
  else await unload([kindOf(key)], key) // a different chat tier replaces the old one
}

function progressTo(id: number, kind: Kind) {
  return (p: Any) => {
    if (p?.status === 'progress' && typeof p.total === 'number' && p.file) post({ id, type: 'file', kind, file: String(p.file), loaded: p.loaded ?? 0, total: p.total })
    else if (p?.status === 'done' && p.file) post({ id, type: 'file', kind, file: String(p.file), loaded: 1, total: 1 })
  }
}

/** Try WebGPU first when the device has it; if the model will not start there, fall back to the CPU. */
async function withBackend<T>(prefer: Backend, make: (b: Backend) => Promise<T>): Promise<{ value: T; backend: Backend }> {
  if (prefer === 'webgpu') {
    try {
      return { value: await make('webgpu'), backend: 'webgpu' }
    } catch (e) {
      console.warn('WebGPU failed, using the CPU instead:', e)
    }
  }
  return { value: await make('wasm'), backend: 'wasm' }
}

/**
 * A model that is already loaded still says "ready": the page marks a model "downloading" when it asks for it, and with two
 * requests racing (setup and a first question) the second would otherwise find nothing to say and leave it stuck.
 */
function alreadyReady(id: number, kind: Kind, m: Loaded): Loaded {
  post({ id, type: 'stage', kind, stage: 'ready', backend: m.backend })
  return m
}

async function loadChat(id: number, tier: Tier): Promise<Loaded> {
  const key = `chat:${tier}`
  const have = loaded.get(key)
  if (have) return alreadyReady(id, 'chat', have)
  await makeRoom(key)
  const spec = CHAT_MODELS[tier]
  post({ id, type: 'stage', kind: 'chat', stage: 'loading' })
  const cb = progressTo(id, 'chat')
  const tokenizer = await AutoTokenizer.from_pretrained(spec.repo, { progress_callback: cb })
  const { value: model, backend } = await withBackend(preferred('chat'), (b) => AutoModelForCausalLM.from_pretrained(spec.repo, { dtype: dtypeFor(spec, profile, b) as Any, device: b, progress_callback: cb }))
  const m: Loaded = { backend, tokenizer, model, dispose: () => (model as Any).dispose?.() }
  loaded.set(key, m)
  post({ id, type: 'stage', kind: 'chat', stage: 'ready', backend })
  return m
}

async function loadVision(id: number): Promise<Loaded> {
  const have = loaded.get('vision')
  if (have) return alreadyReady(id, 'vision', have)
  await makeRoom('vision')
  post({ id, type: 'stage', kind: 'vision', stage: 'loading' })
  const cb = progressTo(id, 'vision')
  const processor = await AutoProcessor.from_pretrained(VISION_MODEL.repo, { progress_callback: cb })
  const { value: model, backend } = await withBackend(preferred('vision'), (b) => AutoModelForVision2Seq.from_pretrained(VISION_MODEL.repo, { dtype: dtypeFor(VISION_MODEL, profile, b) as Any, device: b, progress_callback: cb }))
  const m: Loaded = { backend, processor, model, dispose: () => (model as Any).dispose?.() }
  loaded.set('vision', m)
  post({ id, type: 'stage', kind: 'vision', stage: 'ready', backend })
  return m
}

async function loadSpeech(id: number, size: 'tiny' | 'base'): Promise<Loaded> {
  const key = `speech:${size}`
  const have = loaded.get(key)
  if (have) return alreadyReady(id, 'speech', have)
  await makeRoom(key)
  const spec = SPEECH_MODELS[size]
  post({ id, type: 'stage', kind: 'speech', stage: 'loading' })
  // Whisper's quantized files run well on the CPU and keep the memory use low everywhere
  const asr = await pipeline('automatic-speech-recognition', spec.repo, { dtype: spec.dtype.wasm as Any, device: 'wasm', progress_callback: progressTo(id, 'speech') })
  const m: Loaded = { backend: 'wasm', asr, dispose: () => (asr as Any).dispose?.() }
  loaded.set(key, m)
  post({ id, type: 'stage', kind: 'speech', stage: 'ready', backend: 'wasm' })
  return m
}

async function loadEmbed(id: number): Promise<Loaded> {
  const have = loaded.get('embed')
  if (have) return alreadyReady(id, 'embed', have)
  // deliberately no makeRoom(): 24 MB may sit next to the chat model even on a small device
  post({ id, type: 'stage', kind: 'embed', stage: 'loading' })
  const extractor = await pipeline('feature-extraction', EMBED_MODEL.repo, { dtype: EMBED_MODEL.dtype.wasm as Any, device: 'wasm', progress_callback: progressTo(id, 'embed') })
  const m: Loaded = { backend: 'wasm', extractor, dispose: () => (extractor as Any).dispose?.() }
  loaded.set('embed', m)
  post({ id, type: 'stage', kind: 'embed', stage: 'ready', backend: 'wasm' })
  return m
}

/** Unit-length vectors, so a dot product is the cosine similarity. */
async function embed(id: number, texts: string[]): Promise<number[][]> {
  const { extractor } = await loadEmbed(id)
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 16) {
    if (aborted.has(id)) break
    const res = await (extractor as Any)(texts.slice(i, i + 16), { pooling: 'mean', normalize: true })
    out.push(...(res.tolist() as number[][]))
    post({ id, type: 'progress', done: Math.min(texts.length, i + 16), total: texts.length })
  }
  return out
}

function generationCommon(id: number, tokenizer: Any, maxNewTokens: number, onText: () => void) {
  const stop = new InterruptableStoppingCriteria()
  interrupts.set(id, stop)
  if (aborted.has(id)) stop.interrupt()
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      onText()
      post({ id, type: 'token', text })
    },
  } as Any)
  return { stop, streamer, max_new_tokens: maxNewTokens }
}

/** The GPU can fail while reading a long prompt (before any text exists): switch that model to the CPU and run it again, once. */
async function onceMoreOnCpu(key: string, kind: Kind, e: unknown, streamed: boolean, attempt: number): Promise<boolean> {
  const m = loaded.get(key)
  if (attempt > 0 || streamed || m?.backend !== 'webgpu' || !GPU_FAILURE.test(e instanceof Error ? e.message : String(e))) return false
  console.warn('WebGPU failed while answering; retrying on the CPU:', e)
  gpuBroken.add(kind)
  loaded.delete(key)
  try {
    await m.dispose()
  } catch {
    /* already gone */
  }
  return true
}

async function chat(id: number, tier: Tier, messages: ChatMessage[], maxNewTokens: number, temperature: number) {
  for (let attempt = 0; ; attempt++) {
    const { tokenizer, model } = await loadChat(id, tier)
    post({ id, type: 'stage', kind: 'chat', stage: 'running' })
    // enable_thinking: Qwen3 would otherwise write a long hidden monologue before answering; other templates ignore it
    const inputs = (tokenizer as Any).apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, enable_thinking: false })
    let streamed = false
    const g = generationCommon(id, tokenizer, maxNewTokens, () => (streamed = true))
    try {
      await (model as Any).generate({ ...inputs, max_new_tokens: g.max_new_tokens, do_sample: temperature > 0, temperature: Math.max(temperature, 0.01), top_p: 0.9, repetition_penalty: 1.1, streamer: g.streamer, stopping_criteria: [g.stop] })
      return
    } catch (e) {
      if (await onceMoreOnCpu(`chat:${tier}`, 'chat', e, streamed, attempt)) continue
      throw e
    } finally {
      interrupts.delete(id)
    }
  }
}

async function vision(id: number, image: Blob, prompt: string, maxNewTokens: number) {
  for (let attempt = 0; ; attempt++) {
    const { processor, model } = await loadVision(id)
    post({ id, type: 'stage', kind: 'vision', stage: 'running' })
    const raw = await RawImage.fromBlob(image)
    const text = (processor as Any).apply_chat_template([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: prompt }] }], { add_generation_prompt: true })
    // one global view of the picture (no tiling): several times faster and lighter, which matters on a small CPU
    const inputs = await (processor as Any)(text, [raw], { do_image_splitting: false })
    let streamed = false
    const g = generationCommon(id, (processor as Any).tokenizer, maxNewTokens, () => (streamed = true))
    try {
      await (model as Any).generate({ ...inputs, max_new_tokens: g.max_new_tokens, do_sample: false, streamer: g.streamer, stopping_criteria: [g.stop] })
      return
    } catch (e) {
      if (await onceMoreOnCpu('vision', 'vision', e, streamed, attempt)) continue
      throw e
    } finally {
      interrupts.delete(id)
    }
  }
}

const WINDOW = 30 * 16_000

async function transcribe(id: number, audio: Float32Array, size: 'tiny' | 'base', language: string | undefined): Promise<TranscriptChunk[]> {
  const { asr } = await loadSpeech(id, size)
  post({ id, type: 'stage', kind: 'speech', stage: 'running' })
  const out: TranscriptChunk[] = []
  const windows = Math.max(1, Math.ceil(audio.length / WINDOW))
  for (let i = 0; i < windows; i++) {
    if (aborted.has(id)) break
    const slice = audio.subarray(i * WINDOW, Math.min(audio.length, (i + 1) * WINDOW))
    // a very short tail only produces noise
    if (slice.length < 8_000 && i > 0) break
    const r = (await (asr as Any)(slice, { language, task: 'transcribe', return_timestamps: false })) as { text: string }
    const text = r.text.trim()
    if (text) out.push({ start: (i * WINDOW) / 16_000, end: Math.min(audio.length, (i + 1) * WINDOW) / 16_000, text })
    post({ id, type: 'progress', done: i + 1, total: windows })
  }
  return out
}

/** Model downloads are many large requests; a busy server or a flaky school network should cost a retry, not the whole setup. */
async function fetchWithRetry(input: string | URL, init?: Any): Promise<Response> {
  let last: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)))
    try {
      const res = await fetch(input, init)
      if (res.status !== 429 && res.status !== 502 && res.status !== 503 && res.status !== 504) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('Network error')
}

function init(req: Extract<WorkerRequest, { op: 'init' }>) {
  profile = req.profile
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.remoteHost = req.modelHost
  env.remotePathTemplate = '{model}/resolve/{revision}/'
  env.useBrowserCache = true
  env.fetch = fetchWithRetry
  const wasm = env.backends.onnx.wasm
  if (wasm) {
    // the runtime files are served by Shasta itself (a school filter may block the CDN transformers.js defaults to)
    wasm.wasmPaths = { mjs: `${req.ortBase}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${req.ortBase}ort-wasm-simd-threaded.asyncify.wasm` }
    wasm.numThreads = wasmThreads(profile)
  }
}

async function handle(req: WorkerRequest) {
  const { id } = req
  try {
    switch (req.op) {
      case 'init':
        init(req)
        return post({ id, type: 'result' })
      case 'load':
        if (req.kind === 'chat') await loadChat(id, req.tier)
        else if (req.kind === 'vision') await loadVision(id)
        else if (req.kind === 'speech') await loadSpeech(id, req.speech)
        else await loadEmbed(id)
        return post({ id, type: 'result' })
      case 'chat':
        await chat(id, req.tier, req.messages, req.maxNewTokens, req.temperature)
        return post({ id, type: 'result' })
      case 'vision':
        await vision(id, req.image, req.prompt, req.maxNewTokens)
        return post({ id, type: 'result' })
      case 'transcribe':
        return post({ id, type: 'result', value: await transcribe(id, req.audio, req.speech, req.language) })
      case 'embed':
        return post({ id, type: 'result', value: await embed(id, req.texts) })
      case 'unload':
        await unload(req.kinds)
        return post({ id, type: 'result' })
    }
  } catch (e) {
    post({ id, type: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    aborted.delete(id)
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  if (req.op === 'abort') {
    aborted.add(req.target)
    interrupts.get(req.target)?.interrupt()
    return
  }
  void handle(req)
}
