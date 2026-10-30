// Shapes returned by the Watch API (server/src/routes/watch.ts), kept in one place so the two cannot drift silently.
export type Kind = 'anime' | 'movie' | 'tv'
export type Scope = 'all' | Kind

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
  external: { tmdb?: string; anilist?: string; imdb?: string }
  studio?: string
  status?: string
  rating: number | null
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
}

export interface Row {
  key: string
  title: string
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
}
