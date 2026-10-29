// The page side of the on-device AI: detects what the device can do, owns the inference worker, runs one job at a
// time (a 4 GB Chromebook cannot run two models), reports download progress, and frees memory when idle.
import { APP_API_ORIGIN } from '@/lib/appApi'
import { create } from 'zustand'
import { CHAT_MODELS, DEFAULT_PROFILE, EMBED_MODEL, SERVER_MODEL_PREFIX, SPEECH_MODELS, VISION_MODEL, backendFor, downloadMb, isSmallDevice, offeredTiers, recommendTier, speechSize, type Backend, type DeviceProfile, type Kind, type Tier } from './catalog'
import type { ChatMessage, TranscriptChunk, WorkerEvent, WorkerRequest } from './types'
import { createThinkFilter } from './think'
import { useSettings } from '@/stores/settingsStore'

export type ModelState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error'
export interface ModelStatus {
  state: ModelState
  /** 0-1 while downloading */
  progress: number
  backend: Backend | null
  error: string | null
}

interface AiState {
  profile: DeviceProfile
  profileReady: boolean
  models: Record<Kind, ModelStatus>
  /** a job is running */
  busy: boolean
  /** tokens per second of the last answer */
  speed: number | null
  /** repos whose files are in this device's cache */
  cached: Record<string, true>
  /** the one-click "download everything" onboarding */
  setup: { running: boolean; step: string; progress: number; error: string | null }
  set: (patch: Partial<AiState>) => void
}

const idle = (): ModelStatus => ({ state: 'idle', progress: 0, backend: null, error: null })

export const useAi = create<AiState>()((set) => ({
  profile: DEFAULT_PROFILE,
  profileReady: false,
  models: { chat: idle(), vision: idle(), speech: idle(), embed: idle() },
  busy: false,
  speed: null,
  cached: {},
  setup: { running: false, step: '', progress: 0, error: null },
  set: (patch) => set(patch),
}))

const patchModel = (kind: Kind, p: Partial<ModelStatus>) => useAi.setState((s) => ({ models: { ...s.models, [kind]: { ...s.models[kind], ...p } } }))

/** Where model files come from. Shasta's own server mirrors them, so a network that blocks huggingface.co still works. */
export function modelHost(): string {
  const custom = import.meta.env.VITE_AI_MODEL_HOST as string | undefined
  // the installed app's own origin has no mirror: use the backend's (lib/appApi.ts)
  const base = custom || `${APP_API_ORIGIN || location.origin}${SERVER_MODEL_PREFIX}`
  return base.endsWith('/') ? base : `${base}/`
}

export async function detectProfile(): Promise<DeviceProfile> {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }
  let webgpu = false
  let f16 = false
  try {
    const adapter = await nav.gpu?.requestAdapter()
    if (adapter) {
      webgpu = true
      f16 = adapter.features.has('shader-f16')
    }
  } catch {
    /* no usable GPU */
  }
  return { memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null, cores: navigator.hardwareConcurrency || 2, webgpu, f16, isolated: typeof crossOriginIsolated === 'boolean' && crossOriginIsolated }
}

/** The tier in use: the user's choice when it suits this device, otherwise the recommended one. */
export function activeTier(): Tier {
  const { profile } = useAi.getState()
  const pick = useSettings.getState().settings.ai.chatModel
  return pick !== 'auto' && offeredTiers(profile).includes(pick) ? pick : recommendTier(profile)
}

export const chatSizeMb = (tier = activeTier()) => {
  const { profile } = useAi.getState()
  return downloadMb(CHAT_MODELS[tier], profile, backendFor(profile))
}

/** Everything the AI can use, in MB: language + pictures + speech. */
export const totalSizeMb = () => {
  const { profile } = useAi.getState()
  const b = backendFor(profile)
  return chatSizeMb() + downloadMb(VISION_MODEL, profile, b) + downloadMb(SPEECH_MODELS[speechSize(profile)], profile, b) + downloadMb(EMBED_MODEL, profile, b)
}

// ---- worker -----------------------------------------------------------------------------

interface Job {
  id: number
  req: WorkerRequest
  onEvent?: (e: WorkerEvent) => void
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  started: boolean
}

let worker: Worker | null = null
let seq = 0
const jobs = new Map<number, Job>()
const queue: Job[] = []
let running: Job | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let initDone: Promise<void> | null = null
const fileProgress = new Map<Kind, Map<string, { loaded: number; total: number }>>()

export class AbortedError extends Error {
  constructor() {
    super('Stopped.')
  }
}

function spawn(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerEvent>) => onWorkerEvent(e.data)
  w.onerror = (e) => {
    const job = running
    e.preventDefault()
    killWorker()
    if (job) fail(job, new Error('The AI engine stopped unexpectedly. It may have run out of memory; try the Light model.'))
  }
  return w
}

function killWorker() {
  worker?.terminate()
  worker = null
  initDone = null
  fileProgress.clear()
  useAi.setState({ models: { chat: idle(), vision: idle(), speech: idle(), embed: idle() } })
}

function fail(job: Job, err: Error) {
  jobs.delete(job.id)
  if (running === job) running = null
  job.reject(err)
  pump()
}

function onWorkerEvent(e: WorkerEvent) {
  const job = jobs.get(e.id)
  if (!job) return
  if (e.type === 'file') {
    const files = fileProgress.get(e.kind) ?? new Map()
    fileProgress.set(e.kind, files)
    files.set(e.file, e.total === 1 && e.loaded === 1 ? { loaded: 1, total: 1 } : { loaded: e.loaded, total: e.total })
    let loaded = 0
    let total = 0
    for (const f of files.values()) {
      loaded += f.loaded
      total += f.total
    }
    patchModel(e.kind, { state: 'downloading', progress: total ? Math.min(0.99, loaded / total) : 0 })
  } else if (e.type === 'stage') {
    if (e.stage === 'loading') patchModel(e.kind, { state: 'loading', progress: 1 })
    else if (e.stage === 'ready') {
      fileProgress.delete(e.kind)
      patchModel(e.kind, { state: 'ready', progress: 1, backend: e.backend ?? null, error: null })
      // on a small device the worker unloads the other models to make room
      if (isSmallDevice(useAi.getState().profile) && e.kind !== 'embed') for (const k of ['chat', 'vision', 'speech'] as Kind[]) if (k !== e.kind) patchModel(k, { ...idle() })
    }
  } else if (e.type === 'result') {
    jobs.delete(e.id)
    running = null
    job.resolve(e.value)
    pump()
  } else if (e.type === 'error') {
    const message = friendlyError(e.message)
    for (const kind of ['chat', 'vision', 'speech', 'embed'] as Kind[]) if (useAi.getState().models[kind].state === 'downloading' || useAi.getState().models[kind].state === 'loading') patchModel(kind, { state: 'error', error: message })
    fail(job, new Error(message))
    return
  }
  job.onEvent?.(e)
}

/** Raw runtime errors are numbers and file names; say what a student can act on. */
export function friendlyError(message: string): string {
  console.warn('Shasta AI error:', message)
  if (/fetch|network|Failed to load|trying to load file|404|502|503|Unauthorized|Could not locate/i.test(message)) return 'The model could not be downloaded. Check the connection and try again; if it keeps failing, the Shasta server may be busy or offline.'
  if (/memory|alloc|OOM|out of|buffer|exceeds/i.test(message)) return `The AI ran out of memory on this device. Close some tabs, or choose the Light model in Settings → AI. (${message.replace(/\s+/g, ' ').slice(0, 140)})`
  return message
}

function pump() {
  if (running) return
  const job = queue.shift()
  if (!job || !worker) return
  running = job
  job.started = true
  worker.postMessage(job.req)
}

function schedule() {
  useAi.setState({ busy: running !== null || queue.length > 0 })
}

async function ensureWorker(): Promise<void> {
  if (!worker) worker = spawn()
  if (!initDone) {
    const profile = useAi.getState().profileReady ? useAi.getState().profile : await detectProfile()
    useAi.setState({ profile, profileReady: true })
    const base = new URL(import.meta.env.BASE_URL || '/', location.origin)
    const req: WorkerRequest = { id: ++seq, op: 'init', profile, modelHost: modelHost(), ortBase: new URL('ort/', base).href }
    initDone = new Promise<void>((resolve, reject) => {
      const job: Job = { id: req.id, req, resolve: () => resolve(), reject, started: true }
      jobs.set(job.id, job)
      worker!.postMessage(req)
    })
  }
  await initDone
}

type JobRequest = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

/** Queue one job. Resolves with the worker's result; `signal` stops it (queued jobs are dropped, running ones interrupted). */
async function run<T = void>(req: JobRequest, onEvent?: (e: WorkerEvent) => void, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new AbortedError()
  await ensureWorker()
  if (signal?.aborted) throw new AbortedError()
  if (idleTimer) clearTimeout(idleTimer)
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    const job: Job = { id, req: { ...req, id } as WorkerRequest, onEvent, resolve: resolve as (v: unknown) => void, reject, started: false }
    const onAbort = () => {
      if (!job.started) {
        const i = queue.indexOf(job)
        if (i >= 0) queue.splice(i, 1)
        jobs.delete(id)
        reject(new AbortedError())
        schedule()
      } else worker?.postMessage({ id: ++seq, op: 'abort', target: id } satisfies WorkerRequest)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => {
      signal?.removeEventListener('abort', onAbort)
      schedule()
      armIdleUnload()
    }
    const origResolve = job.resolve
    job.resolve = (v) => (done(), origResolve(v))
    const origReject = job.reject
    job.reject = (e) => (done(), origReject(e))
    jobs.set(id, job)
    queue.push(job)
    schedule()
    pump()
  })
}

function armIdleUnload() {
  if (idleTimer) clearTimeout(idleTimer)
  const minutes = useSettings.getState().settings.ai.idleUnloadMinutes
  if (!minutes || queue.length || running) return
  idleTimer = setTimeout(() => void ai.unload(), minutes * 60_000)
}

// ---- public API -------------------------------------------------------------------------------

export interface ChatOptions {
  maxNewTokens?: number
  temperature?: number
  signal?: AbortSignal
  onToken?: (text: string) => void
}

export const ai = {
  async init() {
    if (useAi.getState().profileReady) return
    const profile = await detectProfile()
    useAi.setState({ profile, profileReady: true })
    void ai.refreshCached()
  },

  /** Download (first time) and load a model so the first answer is not slow. */
  async prepare(kind: Kind, signal?: AbortSignal) {
    await ensureWorker()
    const { profile } = useAi.getState()
    patchModel(kind, { state: 'downloading', progress: 0, error: null })
    try {
      await run({ op: 'load', kind, tier: activeTier(), speech: speechSize(profile) }, undefined, signal)
      void navigator.storage?.persist?.().catch(() => undefined)
      void ai.refreshCached()
    } catch (e) {
      if (e instanceof AbortedError) patchModel(kind, { state: 'idle', progress: 0 })
      else patchModel(kind, { state: 'error', error: (e as Error).message })
      throw e
    }
  },

  /**
   * Onboarding in one step: downloads the picture and speech models, then the language model last so it is the one left
   * in memory on a small device. Models already on the device are skipped quickly (they load from the cache).
   */
  async prepareAll() {
    if (useAi.getState().setup.running) return
    await ensureWorker()
    const { profile } = useAi.getState()
    const b = backendFor(profile)
    const steps: { kind: Kind; step: string; mb: number }[] = [
      { kind: 'vision', step: 'picture model', mb: downloadMb(VISION_MODEL, profile, b) },
      { kind: 'speech', step: 'speech model', mb: downloadMb(SPEECH_MODELS[speechSize(profile)], profile, b) },
      { kind: 'embed', step: 'search model', mb: downloadMb(EMBED_MODEL, profile, b) },
      { kind: 'chat', step: 'language model', mb: chatSizeMb() },
    ]
    const total = steps.reduce((n, x) => n + x.mb, 0)
    let done = 0
    const setup = (p: Partial<AiState['setup']>) => useAi.setState((s) => ({ setup: { ...s.setup, ...p } }))
    setup({ running: true, step: steps[0].step, progress: 0, error: null })
    const unsub = useAi.subscribe((st, prev) => {
      const cur = steps.find((x) => st.models[x.kind].state === 'downloading')
      if (cur && st.models[cur.kind].progress !== prev.models[cur.kind].progress) setup({ step: cur.step, progress: Math.min(0.99, (done + st.models[cur.kind].progress * cur.mb) / total) })
    })
    try {
      for (const x of steps) {
        setup({ step: x.step })
        await ai.prepare(x.kind)
        done += x.mb
        setup({ progress: Math.min(0.99, done / total) })
      }
      setup({ running: false, progress: 1, step: '' })
    } catch (e) {
      setup({ running: false, error: e instanceof Error ? e.message : 'The download failed.' })
      throw e
    } finally {
      unsub()
    }
  },

  /** True when every model the AI uses is already on this device. */
  isAllCached(): boolean {
    return (['chat', 'vision', 'speech', 'embed'] as Kind[]).every((k) => ai.isCached(k))
  },

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const filter = createThinkFilter()
    let text = ''
    let tokens = 0
    let first = 0
    await ai.prepareIfNeeded('chat', opts.signal)
    try {
      await run(
        { op: 'chat', tier: activeTier(), messages, maxNewTokens: opts.maxNewTokens ?? 512, temperature: opts.temperature ?? 0.6 },
        (e) => {
          if (e.type !== 'token' || !e.text) return
          tokens++
          first ||= performance.now()
          const out = filter.push(e.text)
          if (out) {
            text += out
            opts.onToken?.(out)
          }
        },
        opts.signal,
      )
    } catch (e) {
      if (!(e instanceof AbortedError)) throw e
    }
    const rest = filter.flush()
    if (rest) {
      text += rest
      opts.onToken?.(rest)
    }
    if (first && tokens > 3) useAi.setState({ speed: (tokens - 1) / Math.max(0.001, (performance.now() - first) / 1000) })
    return text.trim()
  },

  async describeImage(image: Blob, prompt: string, opts: ChatOptions = {}): Promise<string> {
    let text = ''
    await ai.prepareIfNeeded('vision', opts.signal)
    try {
      await run(
        { op: 'vision', image, prompt, maxNewTokens: opts.maxNewTokens ?? 300 },
        (e) => {
          if (e.type === 'token' && e.text) {
            text += e.text
            opts.onToken?.(e.text)
          }
        },
        opts.signal,
      )
    } catch (e) {
      if (!(e instanceof AbortedError)) throw e
    }
    return text.trim()
  },

  async transcribe(audio: Float32Array, opts: { signal?: AbortSignal; language?: string; onProgress?: (done: number, total: number) => void } = {}): Promise<TranscriptChunk[]> {
    await ai.prepareIfNeeded('speech', opts.signal)
    const { profile } = useAi.getState()
    return run<TranscriptChunk[]>(
      { op: 'transcribe', audio, speech: speechSize(profile), language: opts.language },
      (e) => e.type === 'progress' && opts.onProgress?.(e.done, e.total),
      opts.signal,
    )
  },

  /** Vectors for texts (see EMBED_MODEL), or null when the search model is unavailable: callers fall back to keyword matching. */
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
    try {
      await ai.prepareIfNeeded('embed', signal)
      return await run<number[][]>({ op: 'embed', texts }, undefined, signal)
    } catch (e) {
      if (e instanceof AbortedError) throw e
      return null
    }
  },

  async prepareIfNeeded(kind: Kind, signal?: AbortSignal) {
    await ensureWorker()
    if (useAi.getState().models[kind].state !== 'ready') await ai.prepare(kind, signal)
  },

  /** Frees the memory the models use. They reload (from the on-device cache) the next time they are needed. */
  async unload(kinds: Kind[] = ['chat', 'vision', 'speech', 'embed']) {
    if (!worker || running || queue.length) return
    await run({ op: 'unload', kinds })
    useAi.setState((s) => ({ models: Object.fromEntries(Object.entries(s.models).map(([k, m]) => [k, kinds.includes(k as Kind) ? idle() : m])) as AiState['models'] }))
  },

  /** Deletes every downloaded model from this device. */
  async removeDownloads() {
    killWorker()
    queue.length = 0
    running = null
    try {
      await caches.delete('transformers-cache')
    } catch {
      /* no Cache API */
    }
    useAi.setState({ cached: {}, busy: false })
  },

  /** Which models are already on this device. */
  async refreshCached() {
    const cached: Record<string, true> = {}
    try {
      if (await caches.has('transformers-cache')) {
        const cache = await caches.open('transformers-cache')
        for (const req of await cache.keys()) {
          const m = /\/ai-models\/(.+?)\/resolve\//.exec(req.url) ?? /huggingface\.co\/(.+?)\/resolve\//.exec(req.url)
          if (m && /\.onnx$/.test(req.url)) cached[decodeURIComponent(m[1])] = true
        }
      }
    } catch {
      /* private mode: nothing cached */
    }
    useAi.setState({ cached })
  },

  isCached(kind: Kind): boolean {
    const { cached, profile } = useAi.getState()
    const repo = kind === 'chat' ? CHAT_MODELS[activeTier()].repo : kind === 'vision' ? VISION_MODEL.repo : kind === 'embed' ? EMBED_MODEL.repo : SPEECH_MODELS[speechSize(profile)].repo
    return !!cached[repo]
  },
}
