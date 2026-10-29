// One answer, end to end: turns attachments into something the models can read, fits everything into the small
// context window, picks the right model (text, vision) and streams the reply. Used by the browser's assistant panel and
// by the Shasta AI store app (through the bridge), so both behave the same.
import { CHAT_MODELS, isSmallDevice } from './catalog'
import { ai, activeTier, useAi } from './engine'
import { extractText, fileKind, type FileKind } from './docs'
import { MAX_MEDIA_BYTES, MAX_VIDEO_AUDIO_SECONDS, decodeAudio, downscaleImage, sampleVideoFrames } from './media'
import { SYSTEM_PROMPT, contextBlock, describeImagePrompt, questionWithMaterial, type PageInfo } from './prompts'
import { charsForTokens, estimateTokens, fitHistory, formatClock } from './textutil'
import { genuiPrompt } from './genui/prompt'
import { fetchFactsFor, lookupQueries, needsLookup } from './lookup'
import { semanticFit } from './retrieve'
import type { ChatMessage } from './types'

/** What an attachment became. Images stay images until a question needs them; everything else is already text. */
export type Digest =
  | { kind: 'image'; name: string; image: Blob }
  | { kind: 'text'; name: string; label: string; text: string; truncated: boolean }

export interface TurnInput {
  role: 'user' | 'assistant'
  content: string
  /** hidden notes the model should remember about this turn, e.g. what an attached picture showed */
  note?: string
}

export interface Hooks {
  signal?: AbortSignal
  onToken?: (text: string) => void
  /** short human-readable progress line: "Reading report.pdf…" */
  onStage?: (stage: string) => void
  /** answer as an OpenUI Lang program (cards, tables, steps, quizzes) instead of prose */
  visual?: boolean
  /** look up the topic of a factual question (see lookup.ts) */
  lookup?: boolean
}

/** most of a prompt (material + history + question) in tokens */
const MAX_PROMPT_TOKENS = 1700
const FRAMES_LIGHT = 4
const FRAMES_REGULAR = 6

export async function digestFile(file: File, hooks: Hooks = {}): Promise<Digest> {
  const kind: FileKind = fileKind(file)
  if (kind === 'unsupported') throw new Error(`Shasta AI can't read ${file.name}. It handles pictures, PDFs, Word/PowerPoint files, text and code, audio and video.`)
  if (kind === 'image') {
    hooks.onStage?.(`Preparing ${file.name}…`)
    return { kind: 'image', name: file.name, image: await downscaleImage(file) }
  }
  if (kind === 'document') {
    hooks.onStage?.(`Reading ${file.name}…`)
    const t = await extractText(file)
    if (!t.text.trim()) throw new Error(`${file.name} has no text I can read (a scanned PDF is only pictures).`)
    return { kind: 'text', name: file.name, label: `${file.name} (${t.summary})`, text: t.text, truncated: t.truncated }
  }
  if (file.size > MAX_MEDIA_BYTES) throw new Error(`${file.name} is larger than ${MAX_MEDIA_BYTES / 1048576} MB. Try a shorter clip.`)
  if (kind === 'audio') {
    hooks.onStage?.(`Listening to ${file.name}…`)
    const { samples, seconds } = await decodeAudio(file)
    const parts = await ai.transcribe(samples, { signal: hooks.signal, onProgress: (d, t) => hooks.onStage?.(`Transcribing ${file.name} (${d}/${t})…`) })
    const text = parts.map((p) => `[${formatClock(p.start)}] ${p.text}`).join('\n')
    if (!text.trim()) throw new Error('I could not hear any speech in that recording.')
    return { kind: 'text', name: file.name, label: `${file.name} (audio transcript, ${formatClock(seconds)})`, text, truncated: false }
  }
  // video: a few described frames plus what is said
  hooks.onStage?.(`Opening ${file.name}…`)
  const count = isSmallDevice(useAi.getState().profile) ? FRAMES_LIGHT : FRAMES_REGULAR
  const { frames, duration } = await sampleVideoFrames(file, count)
  let lines = ''
  for (let i = 0; i < frames.length; i++) {
    hooks.onStage?.(`Looking at ${file.name} (scene ${i + 1}/${frames.length})…`)
    const d = await ai.describeImage(frames[i].image, 'Describe this video frame in one or two sentences.', { signal: hooks.signal, maxNewTokens: 70 })
    lines += `[${formatClock(frames[i].time)}] ${d}\n`
  }
  let speech = ''
  try {
    const { samples } = await decodeAudio(file, MAX_VIDEO_AUDIO_SECONDS)
    const parts = await ai.transcribe(samples, { signal: hooks.signal, onProgress: (d, t) => hooks.onStage?.(`Transcribing the sound (${d}/${t})…`) })
    speech = parts.map((p) => `[${formatClock(p.start)}] ${p.text}`).join('\n')
  } catch {
    speech = '' // a silent video, or a codec this browser cannot decode
  }
  const text = `What the video shows (${formatClock(duration)} long):\n${lines}${speech ? `\nWhat is said:\n${speech}` : '\n(No speech could be read from it.)'}`
  return { kind: 'text', name: file.name, label: `${file.name} (video)`, text, truncated: duration > MAX_VIDEO_AUDIO_SECONDS && !!speech }
}

export interface Source {
  title: string
  url: string
}

export interface Answer {
  text: string
  /** where reference facts came from (shown under the answer) */
  sources?: Source[]
  /** a note to keep with this turn for later questions */
  note?: string
}

/**
 * Answers one user message.
 * - Only a picture attached: the vision model answers directly, streamed.
 * - Anything else: files and the page become source material (trimmed to fit) for the chat model.
 * - A picture together with other material: the picture is described first, then the chat model answers from everything.
 */
export async function answer(history: TurnInput[], user: string, digests: Digest[], page: PageInfo | null, hooks: Hooks = {}): Promise<Answer> {
  const images = digests.filter((d): d is Extract<Digest, { kind: 'image' }> => d.kind === 'image').slice(0, 2)
  const texts = digests.filter((d): d is Extract<Digest, { kind: 'text' }> => d.kind === 'text')
  const question = user.trim()

  if (images.length && !texts.length && !page) {
    hooks.onStage?.('Looking at the picture…')
    let out = ''
    for (const [i, img] of images.entries()) {
      if (i) hooks.onToken?.('\n\n')
      out += (i ? '\n\n' : '') + (await ai.describeImage(img.image, question || describeImagePrompt, { signal: hooks.signal, onToken: hooks.onToken }))
    }
    return { text: out, note: `The user attached ${images.length > 1 ? 'pictures' : 'a picture'} (${images.map((i) => i.name).join(', ')}). What ${images.length > 1 ? 'they show' : 'it shows'}: ${out.slice(0, 600)}` }
  }

  let note: string | undefined
  const material: { label: string; text: string }[] = []
  if (images.length) {
    let seen = ''
    for (const img of images) {
      hooks.onStage?.(`Looking at ${img.name}…`)
      seen += `${img.name}: ${await ai.describeImage(img.image, describeImagePrompt, { signal: hooks.signal, maxNewTokens: 200 })}\n`
    }
    material.push({ label: 'Picture description', text: seen.trim() })
    note = `The user attached picture(s). What they show: ${seen.slice(0, 600)}`
  }
  let sources: Source[] | undefined
  if (hooks.lookup && !images.length && needsLookup(question, { attachments: texts.length > 0, pageChars: page?.text.length ?? 0 })) {
    hooks.onStage?.('Looking it up…')
    const facts = await fetchFactsFor(lookupQueries(question, page?.title ?? null), hooks.signal)
    if (facts.length) {
      for (const f of facts) material.push({ label: `Reference (Wikipedia, ${f.title})`, text: f.extract })
      sources = facts.map((f) => ({ title: `Wikipedia · ${f.title}`, url: f.url }))
    }
  }
  for (const t of texts) material.push({ label: t.label, text: t.text })
  if (page) material.push({ label: `Web page “${page.title}” (${page.url})`, text: page.text })

  const spec = CHAT_MODELS[activeTier()]
  const small = spec.context <= 2048
  const visual = !!hooks.visual
  // what earlier turns showed (a picture, say) goes in the system prompt: appended to a turn, a small model echoes it back
  const notes = history.map((t) => t.note).filter((n): n is string => !!n).slice(-2)
  const system = [SYSTEM_PROMPT, notes.length ? `Earlier in this chat: ${notes.join(' ')}` : '', visual ? genuiPrompt(small) : ''].filter(Boolean).join('\n\n')
  const maxNew = visual ? (small ? 600 : 800) : small ? 384 : 512
  // Long prompts are slow on a CPU and can overload a graphics chip, so cap what is read at once whatever the model could take
  const room = charsForTokens(Math.min(spec.context - maxNew - estimateTokens(system) - 40, MAX_PROMPT_TOKENS))
  const historyBudget = Math.floor(room * (material.length ? 0.25 : 0.7))
  // A small model is easily pulled off course by earlier turns: with fresh reference facts it sees none, with a page or file
  // only the last exchange, and the Light model never more than a few turns.
  const messagesAllowed = sources ? 0 : material.length ? 2 : small ? 6 : 12
  const recent = messagesAllowed === 0 ? [] : history.slice(-messagesAllowed)
  const kept = fitHistory(
    recent.map((t) => ({ role: t.role, content: t.content })),
    historyBudget,
  )
  const used = kept.reduce((n, t) => n + t.content.length, 0)
  const perItem = Math.max(400, Math.floor((room - used - question.length - 200) / Math.max(1, material.length)))
  const blocks: string[] = []
  for (const m of material) {
    // long material: pick the passages that match the question by meaning (falls back to shared words)
    const fit = m.text.length > perItem ? await semanticFit(m.text, question, perItem, (texts) => ai.embed(texts, hooks.signal)) : { text: m.text, trimmed: false }
    blocks.push(contextBlock(m.label + (fit.trimmed ? ', excerpts' : ''), fit.text))
  }
  const content = blocks.length ? questionWithMaterial(blocks, question) : question
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...kept, { role: 'user', content }]
  hooks.onStage?.('Thinking…')
  const text = await ai.chat(messages, { signal: hooks.signal, onToken: hooks.onToken, maxNewTokens: maxNew, temperature: visual ? 0.3 : material.length ? 0.2 : 0.6 })
  return { text, note, sources }
}
