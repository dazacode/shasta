// Ranking for Watch search on the device. The search page asks each source on its own (films/TV, anime, manga, comics,
// books) so the fast ones show at once; their answers are merged here with the same rule the server uses
// (server/src/services/watch/meta.ts `relevance`): title match first, then the source's own order, then the rating.
import type { Card } from './types'

/** Same folding as the server's text.ts: lower-case, no accents/punctuation, no leading articles. */
export function foldTitle(s: string): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|le|la|les|el|los|las)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titleScore(a: string, b: string): number {
  const x = foldTitle(a)
  const y = foldTitle(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.startsWith(y) || y.startsWith(x)) return 0.9
  const sx = new Set(x.split(' '))
  const sy = new Set(y.split(' '))
  let shared = 0
  for (const t of sx) if (sy.has(t)) shared++
  return shared / Math.max(sx.size, sy.size)
}

export function relevance(q: string, c: Card, position: number): number {
  const words = foldTitle(q).split(' ').filter(Boolean)
  const title = foldTitle(c.title)
  const allWords = words.length > 0 && words.every((w) => title.includes(w)) ? 0.15 : 0
  return titleScore(q, c.title) + allWords + (Math.min(c.score, 100) / 100) * 0.08 - Math.min(position, 30) * 0.012
}

export interface Ranked {
  card: Card
  rank: number
}

/** Merge per-source lists (each in its source's own order) into one ranked list; the same show listed by AniList
 *  and TMDB keeps only its anime entry. */
export function mergeRanked(q: string, lists: Card[][]): Ranked[] {
  const anime = new Set(lists.flat().filter((c) => c.kind === 'anime').map((c) => `${foldTitle(c.title)}|${c.year ?? ''}`))
  const seen = new Set<string>()
  const out: Ranked[] = []
  for (const list of lists)
    list.forEach((c, i) => {
      const k = `${c.kind}:${c.id}`
      if (seen.has(k)) return
      if ((c.kind === 'tv' || c.kind === 'movie') && anime.has(`${foldTitle(c.title)}|${c.year ?? ''}`)) return
      seen.add(k)
      out.push({ card: c, rank: relevance(q, c, i) })
    })
  return out.sort((a, b) => b.rank - a.rank)
}
