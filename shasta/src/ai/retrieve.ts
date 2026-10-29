// Picks the parts of a long text that answer a question. Meaning first (embeddings: "money troubles" finds "financial
// hardship"), with shared words as a tie-breaker; plain keyword matching when the search model is not available.
import { chunk, fitText, joinPieces, keywordScore } from './textutil'

export type Embedder = (texts: string[]) => Promise<number[][] | null>

/** most pieces ever embedded for one question (a 200k-character file would otherwise take minutes on a small CPU) */
const MAX_PIECES = 100

const dot = (a: number[], b: number[]) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** A manageable set of candidate pieces: the best keyword matches, the opening, the end and an even spread. */
function shortlist(pieces: string[], query: string): number[] {
  if (pieces.length <= MAX_PIECES) return pieces.map((_, i) => i)
  const picked = new Set<number>([0, 1, 2, pieces.length - 1])
  const byWords = pieces.map((p, i) => [i, keywordScore(p, query)] as const).sort((a, b) => b[1] - a[1] || a[0] - b[0])
  for (const [i, s] of byWords) if (s > 0 && picked.size < MAX_PIECES / 2) picked.add(i)
  const step = pieces.length / (MAX_PIECES - picked.size)
  for (let x = 0; picked.size < MAX_PIECES && x < pieces.length; x += step) picked.add(Math.floor(x))
  return [...picked].sort((a, b) => a - b)
}

export async function semanticFit(text: string, query: string, budget: number, embed: Embedder): Promise<{ text: string; trimmed: boolean }> {
  const clean = text.trim()
  if (clean.length <= budget) return { text: clean, trimmed: false }
  const pieces = chunk(clean)
  if (!query.trim() || pieces.length < 3) return fitText(text, query, budget)

  const ids = shortlist(pieces, query)
  const vectors = await embed([query, ...ids.map((i) => pieces[i])]).catch(() => null)
  if (!vectors || vectors.length !== ids.length + 1) return fitText(text, query, budget)

  const [q, ...rest] = vectors
  const scored = ids.map((id, n) => ({ id, score: dot(q, rest[n]) + 0.04 * keywordScore(pieces[id], query) }))
  scored.sort((a, b) => b.score - a.score || a.id - b.id)

  const chosen: number[] = []
  let used = 0
  for (const { id } of scored) {
    const cost = pieces[id].length + 2
    if (used + cost > budget) continue
    chosen.push(id)
    used += cost
  }
  return { text: joinPieces(pieces, chosen) || clean.slice(0, budget), trimmed: true }
}
