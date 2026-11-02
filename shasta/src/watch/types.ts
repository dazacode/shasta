// Shapes returned by the Watch API (server/src/routes/watch.ts), kept in one place so the two cannot drift silently.
export type Kind = 'anime' | 'movie' | 'tv' | 'manga' | 'comic' | 'book'
export type Scope = 'all' | Kind
/** the reading kinds (image or text), which render the Reader instead of the Player */
export const READ_KINDS: Kind[] = ['manga', 'comic', 'book']
export const isReadKind = (k: Kind) => READ_KINDS.includes(k)

export interface Card {
  kind: Kind
  id: string
  title: string
  year: number | null
  poster: string | null
  backdrop?: string | null
  overview?: string
  genres?: string[]
  badge?: string
  score: number
  subtitle?: string
}

export interface Episode {
  number: number
  title: string
  overview: string
  still: string | null
  airDate: string | null
  /** reading providers only: the provider's own chapter id */
  id?: string
}

export interface Season {
  number: number
  name: string
  episodes: number
  airDate: string | null
}

export interface Cast {
  name: string
  role: string
  image: string | null
}

export interface Title extends Card {
  overview: string
  genres: string[]
  runtime: number | null
  format: string | null
  totalEpisodes: number | null
  seasons?: Season[]
  episodes?: Episode[]
  cast?: Cast[]
  trailer?: { key: string; site: string } | null
  recommendations?: Card[]
  logo?: string | null
  external: { tmdb?: string; anilist?: string; imdb?: string; provider?: string; ref?: string }
  studio?: string
  status?: string
  rating: number | null
  /** when a split entry (e.g. an AniList "… 2") is really season N of a show, the season to open at */
  defaultSeason?: number
}

export interface Featured extends Card {
  overview: string
  genres: string[]
  backdrop: string
  rating: number | null
  logo: string | null
  reason: string
}

export interface Subtitle {
  url: string
  label: string
  lang: string
  kind?: string
}

export type CandidateKind = 'embed' | 'hls' | 'mp4' | 'dash'

export interface Candidate {
  id: string
  label: string
  kind: CandidateKind
  url: string
  referer?: string
  audio?: ('sub' | 'dub')[]
  subtitles?: Subtitle[]
  note?: string
  rank: number
  /** a scraped direct manifest whose title was checked against the title's metadata before it was offered */
  verified?: boolean
  /** always route through /api/watch/stream even in "direct" mode (the host sends no CORS headers) */
  forceProxy?: boolean
}

export interface Row {
  key: string
  title: string
  /** a holiday theme ("halloween", "harvest", "winter") drawn as one block; see lib/events.ts */
  section?: string
}
export interface RowData extends Row {
  items: Card[]
}

export interface Continue {
  kind: Kind
  id: string
  season: number
  episode: number
  title: string
  poster: string | null
  at: number
  /** seconds watched */
  position: number
  duration: number
  /** reading only: last chapter/page read */
  chapter?: number
  page?: number
}

/** A chapter's page images (manga/comic). */
export interface ReadPages {
  kind: Kind
  title: string
  chapter: number
  chapterTitle: string
  total: number | null
  pages: { url: string; referer?: string }[]
}

/** A chapter's clean text (book/novel). */
export interface ReadText {
  title: string
  chapter: number
  chapterTitle: string
  html: string
  total: number | null
  prev: number | null
  next: number | null
}
