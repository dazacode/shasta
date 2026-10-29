// The door between the Shasta AI store app and the on-device engine. The app is an ordinary Store package: it runs in a
// sandboxed iframe on its own origin and cannot touch Shasta's page or storage. Models live in the shell (one copy in
// memory, one download), so the app asks the shell through postMessage. Only the official Shasta AI app gets this door,
// and only the window of that exact frame, from that exact origin, is listened to.
import { answer, digestFile, type Digest, type TurnInput } from './chat'
import { ai, AbortedError, totalSizeMb, useAi } from './engine'
import { decodeAudio, recordMicrophone, type Recording } from './media'
import { fileKind } from './docs'
import { decideVisual } from './genui/prompt'
import { CHAT_MODELS, backendFor } from './catalog'
import { useSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { activeTier } from './engine'

export const AI_APP_SLUG = 'shasta-ai'
const TAG = 'shasta-ai-bridge'

interface Request {
  [TAG]: 1
  id: number
  op: 'status' | 'setup' | 'chat' | 'stop' | 'record.start' | 'record.stop' | 'prompt.take'
  text?: unknown
  files?: unknown
  history?: unknown
  target?: unknown
}

const isFile = (f: unknown): f is File => typeof File !== 'undefined' && f instanceof File
const cleanHistory = (h: unknown): TurnInput[] =>
  (Array.isArray(h) ? h : [])
    .filter((t): t is { role: string; content: string; note?: unknown } => !!t && typeof t === 'object' && ((t as { role?: unknown }).role === 'user' || (t as { role?: unknown }).role === 'assistant') && typeof (t as { content?: unknown }).content === 'string')
    .slice(-40)
    .map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content.slice(0, 8000), note: typeof t.note === 'string' ? t.note.slice(0, 1200) : undefined }))

export function snapshot() {
  const s = useAi.getState()
  const tier = activeTier()
  return {
    ready: ai.isAllCached() || s.models.chat.state === 'ready',
    setup: s.setup,
    speed: s.speed,
    model: CHAT_MODELS[tier].label,
    totalMb: s.profileReady ? totalSizeMb() : 0,
    device: { memoryGb: s.profile.memoryGb, cores: s.profile.cores, backend: backendFor(s.profile) },
  }
}

/** Starts answering requests from `frame` (which must be at `origin`). Returns a function that stops listening. */
export function attachBridge(frame: HTMLIFrameElement, origin: string): () => void {
  const jobs = new Map<number, AbortController>()
  let recording: Recording | null = null
  let subscribed = false

  const post = (msg: Record<string, unknown>) => frame.contentWindow?.postMessage({ [TAG]: 1, ...msg }, origin)
  const unsub = useAi.subscribe(() => subscribed && post({ type: 'status', status: snapshot() }))
  // a question typed on the new tab page while this app is already open
  const takePrompt = () => {
    const text = useUi.getState().pendingAiPrompt
    if (text) useUi.getState().setPendingAiPrompt(null)
    return text ?? ''
  }
  const unsubPrompt = useUi.subscribe((s) => {
    if (subscribed && s.pendingAiPrompt) post({ type: 'prompt', text: takePrompt() })
  })

  const onMessage = async (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || e.origin !== origin) return
    const req = e.data as Request
    if (!req || req[TAG] !== 1 || typeof req.id !== 'number') return
    const { id } = req
    const reply = (type: 'result' | 'error' | 'token' | 'stage', extra: Record<string, unknown> = {}) => post({ id, type, ...extra })
    try {
      switch (req.op) {
        case 'status':
          await ai.init()
          await ai.refreshCached()
          subscribed = true
          return reply('result', { status: snapshot() })
        case 'setup':
          await ai.init()
          await ai.prepareAll()
          return reply('result', { status: snapshot() })
        case 'prompt.take':
          return reply('result', { text: takePrompt() })
        case 'stop': {
          jobs.get(Number(req.target))?.abort()
          return reply('result')
        }
        case 'record.start':
          recording?.cancel()
          recording = await recordMicrophone()
          return reply('result')
        case 'record.stop': {
          if (!recording) return reply('result', { text: '' })
          const rec = recording
          recording = null
          const { samples } = await decodeAudio(await rec.stop(), 120)
          const parts = await ai.transcribe(samples)
          return reply('result', { text: parts.map((p) => p.text).join(' ').trim() })
        }
        case 'chat': {
          const text = typeof req.text === 'string' ? req.text.slice(0, 8000) : ''
          const files = (Array.isArray(req.files) ? req.files : []).filter(isFile).slice(0, 4)
          if (!text.trim() && !files.length) throw new Error('Type a message first.')
          const ctrl = new AbortController()
          jobs.set(id, ctrl)
          try {
            const digests: Digest[] = []
            for (const f of files) digests.push(await digestFile(f, { signal: ctrl.signal, onStage: (stage) => reply('stage', { stage }) }))
            const res = await answer(cleanHistory(req.history), text, digests, null, { signal: ctrl.signal, lookup: useSettings.getState().settings.ai.lookup, visual: decideVisual(useSettings.getState().settings.ai.visual, text, files.some((f) => fileKind(f) === 'image'), activeTier() !== 'light'), onStage: (stage) => reply('stage', { stage }), onToken: (t) => reply('token', { text: t }) })
            return reply('result', { text: res.text, note: res.note, sources: res.sources })
          } finally {
            jobs.delete(id)
          }
        }
      }
    } catch (err) {
      if (err instanceof AbortedError) return reply('result', { text: '', stopped: true })
      reply('error', { message: err instanceof Error ? err.message : 'Something went wrong.' })
    }
  }
  const listener = (e: MessageEvent) => void onMessage(e)
  window.addEventListener('message', listener)
  return () => {
    window.removeEventListener('message', listener)
    unsub()
    unsubPrompt()
    recording?.cancel()
    for (const c of jobs.values()) c.abort()
  }
}
