import { describe, expect, it } from 'vitest'
import { foldTitle, mergeRanked, titleScore } from '../src/watch/rank'
import type { Card } from '../src/watch/types'

const card = (kind: Card['kind'], id: string, title: string, extra: Partial<Card> = {}): Card => ({ kind, id, title, year: null, poster: null, score: 0, ...extra })

describe('watch search ranking', () => {
  it('folds titles like the server', () => {
    expect(foldTitle('Spider-Man: Into the Spider-Verse')).toBe('spider man into spider verse')
    expect(titleScore('frieren', 'Frieren: Beyond Journey’s End')).toBe(0.9)
  })

  it('ranks across kinds by title match, not by kind', () => {
    const ranked = mergeRanked('dune', [
      [card('anime', 'a1', 'Dune Buggy Racers')],
      [card('movie', 'm1', 'Dune', { year: 2021 })],
      [card('book', 'b1', 'Dune')],
    ])
    expect(ranked[0].card.title).toBe('Dune')
    expect(ranked.at(-1)!.card.id).toBe('a1')
  })

  it("uses a source's own order to break ties between equal matches", () => {
    const ranked = mergeRanked('spider man', [[card('movie', 'popular', 'Spider-Man'), card('tv', 'obscure', 'Spider-Man')]])
    expect(ranked.map((r) => r.card.id)).toEqual(['popular', 'obscure'])
  })

  it('keeps the anime entry when TMDB lists the same show', () => {
    const ranked = mergeRanked('frieren', [
      [card('tv', 't1', "Frieren: Beyond Journey's End", { year: 2023 })],
      [card('anime', 'a1', 'Frieren: Beyond Journey’s End', { year: 2023 })],
    ])
    expect(ranked.map((r) => r.card.kind)).toEqual(['anime'])
  })
})
