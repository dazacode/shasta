// The browser assistant's conversation. Kept in memory only (never saved to disk, never sent anywhere) and cleared when
// the window closes. The Shasta AI store app keeps its own history in its own storage.
import { trackEvent } from '@/lib/usage'
import { create } from 'zustand'
import { answer, digestFile, type Digest, type TurnInput } from './chat'
import { activeTier, ai, AbortedError, useAi } from './engine'
import { quickPrompt, type QuickActionId } from './prompts'
import { readActivePage } from './pageContext'
import { fileKind } from './docs'
import { decideVisual, looksLikeOpenUi, plainFromOpenUi } from './genui/prompt'
import { useSettings } from '@/stores/settingsStore'
import { recordMicrophone, decodeAudio, type Recording } from './media'
import { useUi } from '@/stores/uiStore'

export interface Msg {
  id: number
  role: 'user' | 'assistant'
  content: string
  note?: string
  /** reference articles the answer was based on */
  sources?: { title: string; url: string }[]
  /** names of attached files, shown on the user's message */
  files?: { name: string; kind: string }[]
  /** a page was used as source material */
  page?: string
  stage?: string
  pending?: boolean
  error?: boolean
}

interface AssistantState {
  messages: Msg[]
  busy: boolean
  recording: boolean
  transcribing: boolean
  send: (text: string, opts?: { files?: File[]; usePage?: boolean; selection?: string; image?: Blob; label?: string; visual?: boolean }) => Promise<void>
  quick: (id: QuickActionId) => Promise<void>
  stop: () => void
  clear: () => void
  startDictation: () => Promise<void>
  stopDictation: () => Promise<string>
}

let seq = 0
let controller: AbortController | null = null
let recording: Recording | null = null

export const useAssistant = create<AssistantState>()((set, get) => {
  const patch = (id: number, p: Partial<Msg>) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }))

  return {
    messages: [],
    busy: false,
    recording: false,
    transcribing: false,

    async send(text, opts = {}) {
      trackEvent('ai.message')
      if (get().busy) return
      const files = opts.files ?? []
      const userMsg: Msg = {
        id: ++seq,
        role: 'user',
        content: opts.label ?? text,
        files: [...files.map((f) => ({ name: f.name, kind: fileKind(f) })), ...(opts.image ? [{ name: 'picture', kind: 'image' }] : [])],
      }
      const reply: Msg = { id: ++seq, role: 'assistant', content: '', pending: true, stage: 'Getting ready…' }
      const history: TurnInput[] = get().messages.filter((m) => !m.error && !m.pending && m.content).map((m) => ({ role: m.role, content: looksLikeOpenUi(m.content) ? plainFromOpenUi(m.content) : m.content, note: m.note }))
      set((s) => ({ messages: [...s.messages, userMsg, reply], busy: true }))
      const ctrl = (controller = new AbortController())
      try {
        const digests: Digest[] = []
        for (const f of files) digests.push(await digestFile(f, { signal: ctrl.signal, onStage: (stage) => patch(reply.id, { stage }) }))
        if (opts.image) digests.push({ kind: 'image', name: 'picture', image: opts.image })
        if (opts.selection) digests.push({ kind: 'text', name: 'selection', label: 'text selected on the page', text: opts.selection, truncated: false })
        let page = null
        if (opts.usePage) {
          page = readActivePage()
          if (!page) throw new Error("I can't read the page in this tab. Open a website first (Shasta's own pages can't be read).")
          patch(userMsg.id, { page: page.title })
        }
        let acc = ''
        const mode = useSettings.getState().settings.ai.visual
        const visual = mode !== 'off' && (opts.visual ?? decideVisual(mode, text, digests.some((d) => d.kind === 'image'), activeTier() !== 'light'))
        const res = await answer(history, text, digests, page, {
          signal: ctrl.signal,
          visual,
          lookup: useSettings.getState().settings.ai.lookup,
          onStage: (stage) => patch(reply.id, { stage }),
          onToken: (t) => {
            acc += t
            patch(reply.id, { content: acc, stage: undefined })
          },
        })
        patch(reply.id, { content: res.text || acc || 'I could not come up with an answer. Try asking a different way.', note: res.note, sources: res.sources, pending: false, stage: undefined })
      } catch (e) {
        if (e instanceof AbortedError || ctrl.signal.aborted) patch(reply.id, { pending: false, stage: undefined, content: get().messages.find((m) => m.id === reply.id)?.content || 'Stopped.' })
        else patch(reply.id, { pending: false, stage: undefined, error: true, content: e instanceof Error ? e.message : 'Something went wrong.' })
      } finally {
        controller = null
        set({ busy: false })
      }
    },

    quick: (id) => get().send(quickPrompt(id), { usePage: true, label: quickPrompt(id), visual: id === 'quiz' ? true : undefined }),

    stop() {
      controller?.abort()
    },

    clear() {
      controller?.abort()
      set({ messages: [] })
    },

    async startDictation() {
      if (recording || get().busy) return
      try {
        recording = await recordMicrophone()
        set({ recording: true })
      } catch {
        useUi.getState().toast('Shasta could not use the microphone. Allow it in the browser and try again.', { tone: 'error' })
      }
    },

    async stopDictation() {
      if (!recording) return ''
      const rec = recording
      recording = null
      set({ recording: false, transcribing: true })
      try {
        const blob = await rec.stop()
        const { samples } = await decodeAudio(blob, 120)
        const parts = await ai.transcribe(samples)
        return parts.map((p) => p.text).join(' ').trim()
      } catch (e) {
        useUi.getState().toast(e instanceof Error ? e.message : 'Could not understand the recording.', { tone: 'error' })
        return ''
      } finally {
        set({ transcribing: false })
      }
    },
  }
})

export const modelBusyLabel = (): string | null => {
  const { models } = useAi.getState()
  const downloading = (['chat', 'vision', 'speech', 'embed'] as const).find((k) => models[k].state === 'downloading')
  return downloading ? `Downloading the ${downloading === 'chat' ? 'language' : downloading === 'vision' ? 'picture' : downloading === 'embed' ? 'search' : 'speech'} model… ${Math.round(models[downloading].progress * 100)}%` : null
}
