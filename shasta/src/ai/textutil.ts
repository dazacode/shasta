// Text helpers for fitting documents, pages and conversations into a small model's context window. Pure, unit-tested.

/** Rough token count: about 3.5 characters per token for English text. Deliberately a little pessimistic. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5)
export const charsForTokens = (tokens: number) => Math.max(0, Math.floor(tokens * 3.5))

const STOP = new Set(
  'a an and are as at be but by for from has have how i if in into is it its of on or that the their then there these they this to was we were what when where which who why will with you your can could do does about tell me please explain summarize summary give make'.split(' '),
)

export const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []
const keywords = (s: string) => words(s).filter((w) => !STOP.has(w))

/** Splits text into paragraph-sized pieces of at most ~`size` characters. */
export function chunk(text: string, size = 700): string[] {
  const out: string[] = []
  for (const para of text.split(/\n{2,}|\r\n{2,}/)) {
    let p = para.trim()
    while (p.length > size) {
      let cut = p.lastIndexOf('. ', size)
      if (cut < size * 0.4) cut = p.lastIndexOf(' ', size)
      if (cut < size * 0.4) cut = size
      out.push(p.slice(0, cut + 1).trim())
      p = p.slice(cut + 1).trim()
    }
    if (p) out.push(p)
  }
  return out
}

/**
 * Picks the parts of `text` that fit `budget` characters. With a question, the pieces that share the most words with it
 * come first; with none (or no overlap) the pieces are spread evenly over the whole text so a summary sees the beginning,
 * middle and end. The result keeps the original order.
 */
export function fitText(text: string, query: string, budget: number): { text: string; trimmed: boolean } {
  const clean = text.replace(/[ \t]+\n/g, '\n').trim()
  if (clean.length <= budget) return { text: clean, trimmed: false }
  const pieces = chunk(clean)
  const q = new Set(keywords(query))
  const score = pieces.map((p) => {
    if (!q.size) return 0
    const w = new Set(words(p))
    let s = 0
    for (const k of q) if (w.has(k)) s++
    return s
  })
  const order = pieces.map((_, i) => i)
  if (score.some((s) => s > 0)) order.sort((a, b) => score[b] - score[a] || a - b)
  else {
    // even spread: first, last, then the middle, by repeatedly halving
    const spread: number[] = []
    const seen = new Set<number>()
    const add = (i: number) => !seen.has(i) && (seen.add(i), spread.push(i))
    add(0)
    add(pieces.length - 1)
    for (let step = pieces.length >> 1; step >= 1; step >>= 1) for (let i = step; i < pieces.length; i += step * 2) add(i)
    for (let i = 0; i < pieces.length; i++) add(i)
    order.splice(0, order.length, ...spread)
  }
  const chosen: number[] = []
  let used = 0
  for (const i of order) {
    const cost = pieces[i].length + 2
    if (used + cost > budget) continue
    chosen.push(i)
    used += cost
  }
  return { text: joinPieces(pieces, chosen) || clean.slice(0, budget), trimmed: true }
}

/** The chosen pieces in document order, with a […] wherever something was left out. */
export function joinPieces(pieces: string[], chosen: number[]): string {
  let out = ''
  let prev = -1
  for (const i of [...chosen].sort((a, b) => a - b)) {
    out += (prev >= 0 && i !== prev + 1 ? '\n[…]\n' : out ? '\n\n' : '') + pieces[i]
    prev = i
  }
  return out
}

/** How many distinct question words a piece contains. */
export function keywordScore(piece: string, query: string): number {
  const q = new Set(keywords(query))
  if (!q.size) return 0
  const w = new Set(words(piece))
  let s = 0
  for (const k of q) if (w.has(k)) s++
  return s
}

/** Keeps the newest turns that fit `budget` characters. Always keeps the last one. */
export function fitHistory<T extends { content: string }>(turns: T[], budget: number): T[] {
  const out: T[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    used += turns[i].content.length
    if (used > budget && out.length) break
    out.unshift(turns[i])
  }
  return out
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Office documents (docx, pptx) are zipped XML: paragraphs end at </w:p> or </a:p>; everything else inside tags is dropped. */
export function xmlToText(xml: string): string {
  return xml
    .replace(/<\/(w:p|a:p|text:p)>/g, '\n')
    .replace(/<(w:br|w:tab|a:br)\b[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Plain text of a markdown reply, for reading aloud or copying without symbols. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export const formatBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
export const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
