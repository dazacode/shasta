// The new tab "Quote" widget's library. The lines themselves are NOT written here: scripts/build-quotes.ts pulls them
// from open-licensed GitHub datasets (pinned commits, sha256-checked, filtered for school) into quotes.data.json,
// which is loaded only when a Quote widget is on the page. Credits: QUOTE_SOURCES, the widget's options, NOTICE.md.

export type QuoteKind = 'screen' | 'anime' | 'people' | 'philosophy' | 'motivation' | 'joke'

export const QUOTE_KINDS: { id: QuoteKind; label: string }[] = [
  { id: 'screen', label: 'Movies and TV' },
  { id: 'anime', label: 'Anime' },
  { id: 'people', label: 'Famous people' },
  { id: 'philosophy', label: 'Philosophy' },
  { id: 'motivation', label: 'Motivation' },
  { id: 'joke', label: 'Joke of the day' },
]

/** Where the lines come from (also listed in the generated file and NOTICE.md). */
export const QUOTE_SOURCES = [
  { name: 'popular-movie-quotes', url: 'https://github.com/NikhilNamal17/popular-movie-quotes', what: 'movies and TV' },
  { name: 'AniQuotesAPI', url: 'https://github.com/Shineii86/AniQuotesAPI', what: 'anime', by: 'Shinei Nouze' },
  { name: 'inspirational-quotes', url: 'https://github.com/vinitshahdeo/inspirational-quotes', what: 'motivation' },
  { name: 'Inspirational-Quotes', url: 'https://github.com/akhiltak/inspirational-quotes', what: 'famous people, philosophy, motivation' },
  { name: 'Official Joke API', url: 'https://github.com/15Dkatz/official_joke_api', what: 'jokes' },
]

export interface Quote {
  kind: QuoteKind
  /** the quote, or a joke's setup */
  text: string
  /** who said it, or "Character, Show" (empty for jokes) */
  by: string
  /** a joke's punchline, shown on a click */
  answer?: string
}

type Row = [QuoteKind, string, string, string?]

let all: Promise<Quote[]> | null = null

/** The whole library, loaded once (a separate chunk, so pages without a Quote widget never download it). */
export function loadQuotes(): Promise<Quote[]> {
  all ??= import('./quotes.data.json').then((m) => fromRows((m.default as unknown as { quotes: Row[] }).quotes))
  return all
}

export const fromRows = (rows: Row[]): Quote[] => rows.map(([kind, text, by, answer]) => (answer ? { kind, text, by, answer } : { kind, text, by }))

/** Every quote of the chosen kinds (all of them when none is chosen). */
export function quotesOf(quotes: readonly Quote[], kinds: readonly QuoteKind[]): Quote[] {
  const on = kinds.length ? new Set(kinds) : null
  return on ? quotes.filter((x) => on.has(x.kind)) : [...quotes]
}

const DAY = 86_400_000

/** Today's pick (the same all day), or one at random. `skip` moves along the list ("Another"). */
export function pickQuote(pool: readonly Quote[], mode: 'tab' | 'day', seed: number, skip = 0, now: Date = new Date()): Quote | null {
  if (!pool.length) return null
  const base = mode === 'day' ? Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / DAY) * 7919 : Math.floor(seed * pool.length)
  return pool[(((base + skip) % pool.length) + pool.length) % pool.length]
}
