// What people browse by, all derived from tags on the server (an app can be in several). Games: genres. Apps: topics
// (AI tools, Productivity, ...), or their stored category on an older server. The "Games" category itself is only
// the games/apps split, never a chip.
import type { CategoryRef, GenreCount, GenreRef } from './types'

export type Kind = 'all' | 'games' | 'apps'

export interface Facet {
  /** the /api/catalog/apps and /search parameter */
  param: 'genre' | 'category'
  id: string
  name: string
  /** unknown on pages that only have the category list */
  count: number | null
  isGame: boolean
}

export function facetsOf(categories: (CategoryRef & { count?: number })[], genres: (GenreCount | GenreRef)[] | undefined, kind: Kind): Facet[] {
  const all: Facet[] = (genres ?? []).map((x) => ({ param: 'genre', id: x.id, name: x.name, count: 'count' in x ? x.count : null, isGame: 'isGame' in x ? x.isGame !== false : true }))
  const g = all.filter((x) => x.isGame)
  const topics = all.filter((x) => !x.isGame)
  // an older server sends no genres/topics: fall back to the stored categories so everything stays browsable
  const gameCats = g.length ? [] : categories.filter((c) => c.isGame)
  const appCats = topics.length ? [] : categories.filter((c) => !c.isGame)
  const c: Facet[] = [...gameCats, ...appCats]
    .filter((x) => x.count === undefined || x.count > 0)
    .map((x) => ({ param: 'category', id: x.id, name: x.name, count: x.count ?? null, isGame: x.isGame }))
  const bySize = (a: Facet, b: Facet) => (b.count ?? 0) - (a.count ?? 0)
  const games = [...g, ...c.filter((x) => x.isGame)].sort(bySize)
  const apps = [...topics, ...c.filter((x) => !x.isGame)].sort(bySize)
  return kind === 'games' ? games : kind === 'apps' ? apps : [...games, ...apps]
}

export const facetQuery = (f: Pick<Facet, 'param' | 'id'>) => `${f.param}=${encodeURIComponent(f.id)}`
