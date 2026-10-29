// "Picked for you": a taste profile that lives ONLY in this browser (localStorage `shasta-store-taste`).
// What feeds it: opening an app's page, installing, launching and uninstalling. What it keeps: weights per genre,
// developer, storefront and tag, never a list of what was viewed, never a time line. Nothing here is sent, synced,
// exported with a profile or tied to anyone; the server only sees the ordinary catalogue requests any visitor's
// browsing makes (a genre sorted by popularity). Weights fade (half-life HALF_LIFE_DAYS) so tastes can change.
// Off with Settings -> Privacy -> "Recommendations in the Store" (which also wipes it); private tabs never record.
// This file is the pure model (unit-tested); tasteStore.ts keeps it in localStorage.
import type { AppCard } from './types'

const DAY = 86_400_000
export const HALF_LIFE_DAYS = 21
const MAX_FEATURES = 200
/** below this much genre interest the profile says nothing (one page view is not a taste; one install or two views are) */
const MIN_SIGNAL = 2

export type TasteEvent = 'view' | 'install' | 'launch' | 'uninstall'
const WEIGHT: Record<TasteEvent, number> = { view: 1, install: 4, launch: 1.5, uninstall: -4 }

export interface Taste {
  v: 1
  /** when the weights were last faded */
  at: number
  /** feature -> weight. g:<genre id>, c:<category id>, d:<developer>, s:<storefront id>, t:<tag> */
  f: Record<string, number>
}

export type Features = Pick<AppCard, 'developer' | 'category' | 'store' | 'genres'> & { tags?: string[] }

/** The features an app contributes, with how much each counts relative to the event's weight. */
export function featuresOf(app: Features): [string, number][] {
  const out: [string, number][] = []
  // a game's genres say what it is; its category ("Games") says almost nothing, an app's category is its genre
  for (const g of (app.genres ?? []).slice(0, 4)) out.push([`g:${g.id}`, 1])
  if (app.category) out.push([`c:${app.category.id}`, app.category.isGame && app.genres?.length ? 0.2 : 1])
  if (app.developer?.trim()) out.push([`d:${app.developer.trim().toLowerCase()}`, 0.8])
  if (app.store) out.push([`s:${app.store.id}`, 0.3])
  for (const t of (app.tags ?? []).slice(0, 8)) if (t.trim()) out.push([`t:${t.trim().toLowerCase()}`, 0.4])
  return out
}

export const emptyTaste = (now = Date.now()): Taste => ({ v: 1, at: now, f: {} })

/** Fades every weight by the time passed since `taste.at`, dropping the ones that no longer matter. Pure. */
export function decay(taste: Taste, now = Date.now()): Taste {
  const k = Math.pow(0.5, Math.max(0, now - taste.at) / (HALF_LIFE_DAYS * DAY))
  const f: Record<string, number> = {}
  for (const [name, w] of Object.entries(taste.f)) if (Math.abs(w * k) >= 0.05) f[name] = w * k
  return { v: 1, at: now, f }
}

/** Adds one event to the profile. Pure; keeps the strongest MAX_FEATURES features. */
export function record(taste: Taste, app: Features, event: TasteEvent, now = Date.now()): Taste {
  const next = decay(taste, now)
  for (const [name, share] of featuresOf(app)) {
    const w = (next.f[name] ?? 0) + WEIGHT[event] * share
    // dislike is remembered a little (so an uninstall counts) but never piles up into a hard block
    next.f[name] = Math.max(-3, Math.min(40, w))
  }
  const entries = Object.entries(next.f)
  if (entries.length > MAX_FEATURES) next.f = Object.fromEntries(entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, MAX_FEATURES))
  return next
}

const isFacet = (k: string) => k.startsWith('g:') || k.startsWith('c:')

/** Interest in the strongest genre or category (what candidates are drawn from): below MIN_SIGNAL nothing to go on. */
export const strength = (taste: Taste) => Object.entries(taste.f).reduce((n, [k, w]) => (isFacet(k) ? Math.max(n, w) : n), 0)
export const hasTaste = (taste: Taste) => strength(taste) >= MIN_SIGNAL

/** The genres (or app categories) to fetch candidates from, strongest first: only ones the person leans towards. */
export function topFacets(taste: Taste, n = 3): { param: 'genre' | 'category'; id: string }[] {
  return Object.entries(taste.f)
    .filter(([k, w]) => isFacet(k) && w >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => ({ param: k.startsWith('g:') ? 'genre' : 'category', id: k.slice(2) }))
}

export interface ForYouPick {
  app: AppCard
  /** short, honest reason shown on the rail ("You like Puzzle", "More from Valve") */
  reason: string
}

/**
 * Ranks candidates for one person. Score = affinity (genre, developer, storefront) + a small popularity prior from
 * the candidate's position in its "most installed" list. Then a greedy pass keeps the row varied: each extra pick
 * from the same genre or developer is worth less. Pure, so it is unit-tested.
 */
export function recommend(taste: Taste, pools: AppCard[][], { exclude = new Set<string>(), limit = 12, categoryName = (id: string) => id }: { exclude?: Set<string>; limit?: number; categoryName?: (id: string) => string } = {}): ForYouPick[] {
  const w = (k: string) => taste.f[k] ?? 0
  const scored = new Map<string, { app: AppCard; score: number; reason: string }>()
  for (const pool of pools)
    pool.forEach((app, rank) => {
      if (exclude.has(app.id)) return
      // its strongest genre counts fully, the others a little (so a game in four genres does not win by number)
      const gs = (app.genres ?? []).map((g) => [w(`g:${g.id}`), `You like ${g.name}`] as [number, string]).sort((a, b) => b[0] - a[0])
      const parts: [number, string][] = [
        ...gs.map(([v, r], i) => [i === 0 ? v : v * 0.25, r] as [number, string]),
        [app.category ? w(`c:${app.category.id}`) * (gs.length ? 0.2 : 1) : 0, app.category ? `You like ${categoryName(app.category.id)}` : ''],
        [app.developer ? w(`d:${app.developer.trim().toLowerCase()}`) * 1.2 : 0, app.developer ? `More from ${app.developer}` : ''],
        [app.store ? w(`s:${app.store.id}`) * 0.5 : 0, app.store ? `From ${app.store.name}` : ''],
      ]
      const affinity = parts.reduce((n, [s]) => n + s, 0)
      if (affinity <= 0) return
      const prior = 1.5 * (1 - rank / Math.max(pool.length, 1))
      const best = parts.reduce((a, b) => (b[0] > a[0] ? b : a), [0, ''] as [number, string])
      const score = affinity + prior
      const had = scored.get(app.id)
      if (!had || had.score < score) scored.set(app.id, { app, score, reason: best[1] })
    })

  const left = [...scored.values()].sort((a, b) => b.score - a.score)
  const out: ForYouPick[] = []
  // variety by main genre (a game's category is just "Games")
  const kindOf = (a: AppCard) => a.genres?.[0]?.id ?? a.category?.id ?? ''
  const usedCat = new Map<string, number>()
  const usedDev = new Map<string, number>()
  while (out.length < limit && left.length) {
    let bi = 0
    let bs = -Infinity
    left.forEach((c, i) => {
      const s = c.score * Math.pow(0.85, usedCat.get(kindOf(c.app)) ?? 0) * Math.pow(0.6, usedDev.get(c.app.developer) ?? 0)
      if (s > bs) (bs = s), (bi = i)
    })
    const [c] = left.splice(bi, 1)
    out.push({ app: c.app, reason: c.reason })
    const cat = kindOf(c.app)
    usedCat.set(cat, (usedCat.get(cat) ?? 0) + 1)
    usedDev.set(c.app.developer, (usedDev.get(c.app.developer) ?? 0) + 1)
  }
  return out
}
