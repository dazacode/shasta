// Pure helpers for the community chat (shasta://chat): message types, a tiny Discord-style markdown tokenizer and
// message grouping. No DOM, no network: the page renders the tokens as React elements, never as HTML.

export interface ChatAuthor {
  name: string
  /** "#rrggbb" role colour */
  color: string | null
  bot: boolean
  /** sent from Shasta's chat */
  web: boolean
  avatarUrl: string | null
}

export interface ChatAttachment {
  name: string
  url: string
  type: 'image' | 'file'
  size: number
  width?: number
  height?: number
}

export interface ChatMessage {
  id: string
  channelId: string
  author: ChatAuthor
  content: string
  createdAt: number
  editedAt: number | null
  attachments: ChatAttachment[]
  replyTo: { id: string; author: string; content: string } | null
}

export interface ChatChannel {
  id: string
  name: string
  topic: string
  /** seconds */
  slowmode: number
  /** @everyone may not send here: read only */
  readOnly?: boolean
}

export interface ChatInfo {
  enabled: boolean
  paused: boolean
  server: { name: string; iconUrl: string | null }
  channels: ChatChannel[]
  rules: string
  maxLength: number
}

export interface Chatter {
  id: string
  name: string
  status: 'active' | 'banned' | 'timed_out'
  timeoutUntil: number | null
}

// ---- markdown ---------------------------------------------------------------------------------------------------------

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; v: string }
  | { t: 'bold' | 'italic' | 'strike' | 'spoiler'; c: Inline[] }

export type Block = { t: 'codeblock'; lang: string; v: string } | { t: 'para'; c: Inline[] }

// earliest match wins; order breaks ties (** before *)
const INLINE = [
  { kind: 'code', re: /`([^`\n]+)`/ },
  { kind: 'link', re: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]]/ },
  { kind: 'bold', re: /\*\*(?=\S)([\s\S]+?)\*\*/ },
  { kind: 'strike', re: /~~(?=\S)([\s\S]+?)~~/ },
  { kind: 'spoiler', re: /\|\|(?=\S)([\s\S]+?)\|\|/ },
  { kind: 'italic', re: /\*(?=\S)([^*]+?)\*/ },
  { kind: 'italic', re: /(?<![\w])_(?=\S)([^_]+?)_(?![\w])/ },
] as const

/** Only http(s) links are links; anything else (javascript:, data:, ...) stays text. */
export function safeHref(s: string): string | null {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = []
  const text = (v: string) => {
    if (!v) return
    const last = out[out.length - 1]
    if (last?.t === 'text') last.v += v
    else out.push({ t: 'text', v })
  }
  let rest = src
  while (rest) {
    let best: { kind: string; m: RegExpExecArray } | null = null
    for (const { kind, re } of INLINE) {
      if (depth > 4 && kind !== 'code' && kind !== 'link') continue
      const m = re.exec(rest)
      if (m && (!best || m.index < best.m.index)) best = { kind, m }
    }
    if (!best) {
      text(rest)
      break
    }
    const { kind, m } = best
    text(rest.slice(0, m.index))
    if (kind === 'code') out.push({ t: 'code', v: m[1] })
    else if (kind === 'link') {
      const href = safeHref(m[0])
      if (href) out.push({ t: 'link', href, v: m[0] })
      else text(m[0])
    } else out.push({ t: kind as 'bold' | 'italic' | 'strike' | 'spoiler', c: parseInline(m[1], depth + 1) })
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

/** Splits ```fenced``` code blocks from the rest; everything else is inline markdown. */
export function parseMessage(src: string): Block[] {
  const blocks: Block[] = []
  const fence = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g
  let at = 0
  for (let m = fence.exec(src); m; m = fence.exec(src)) {
    const before = src.slice(at, m.index)
    if (before.trim()) blocks.push({ t: 'para', c: parseInline(before.replace(/^\n+|\n+$/g, '')) })
    blocks.push({ t: 'codeblock', lang: m[1], v: m[2].replace(/\n$/, '') })
    at = m.index + m[0].length
  }
  const tail = src.slice(at)
  if (tail.trim() || !blocks.length) blocks.push({ t: 'para', c: parseInline(tail.replace(/^\n+|\n+$/g, '')) })
  return blocks
}

// ---- grouping ---------------------------------------------------------------------------------------------------------

export const GROUP_WINDOW_MS = 5 * 60_000

export interface MessageRow {
  message: ChatMessage
  /** first message of a run by the same author: shows the name and avatar */
  head: boolean
  /** a day separator goes before this message */
  newDay: boolean
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
const sameAuthor = (a: ChatAuthor, b: ChatAuthor) => a.name === b.name && a.web === b.web && a.bot === b.bot

/** Consecutive messages by the same author within 5 minutes (and on the same day, not replies) form one group. */
export function groupMessages(messages: ChatMessage[]): MessageRow[] {
  return messages.map((message, i) => {
    const prev = messages[i - 1]
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(message.createdAt)
    const head = newDay || !prev || !!message.replyTo || !sameAuthor(prev.author, message.author) || message.createdAt - prev.createdAt > GROUP_WINDOW_MS
    return { message, head, newDay }
  })
}

/** Merges a page of messages into the list: sorted by time, no duplicates (a newer copy replaces an older one). */
export function mergeMessages(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
}

export const NAME_MIN = 2
export const NAME_MAX = 24

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** A stable colour for an author without a role colour (initials avatars). */
export function nameHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}
