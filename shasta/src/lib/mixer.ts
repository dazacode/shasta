// The sound mixer's model, pure (tests/mixer.test.ts): what a "source" is, how loud each one ends up, and which sources the
// mixer lists. A source is one thing the person hears: a site (YouTube, Spotify...) or an installed game, however many tabs
// or <audio>/<video> elements or WebAudio contexts it has. Levels are remembered per source, so YouTube is as loud next
// time as the person left it. The mixer scales what the page plays; it never changes what the page believes its own volume is.
import type { MediaInfo } from '@/lib/media'

export const clampLevel = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1)

/** What a page's own volume becomes: the master level times the source's level (0 when it is muted in the mixer). */
export function effectiveGain(master: number, levels: Record<string, number>, muted: Record<string, boolean>, key: string): number {
  if (muted[key]) return 0
  return clampLevel(master) * clampLevel(levels[key] ?? 1)
}

/** One step of a slider (arrow key or D-pad): 5 %, snapping to whole percents. */
export function stepLevel(value: number, dir: 1 | -1, step = 0.05): number {
  return clampLevel(Math.round((clampLevel(value) + dir * step) * 100) / 100)
}

export const percent = (n: number) => `${Math.round(clampLevel(n) * 100)}%`

export interface SavedMixer {
  master: number
  levels: Record<string, number>
}

/** Saved mixer state is checked field by field; anything odd is dropped (and the table cannot grow without bound). */
export function sanitizeMixer(raw: unknown): SavedMixer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { master?: unknown; levels?: unknown }
  const levels: Record<string, number> = {}
  if (r.levels && typeof r.levels === 'object') {
    for (const [k, v] of Object.entries(r.levels as Record<string, unknown>).slice(0, 200)) {
      if (typeof v === 'number' && Number.isFinite(v) && k.length <= 120 && /^(app|site|tab):/.test(k) && v < 0.999) levels[k] = clampLevel(v)
    }
  }
  return { master: typeof r.master === 'number' ? clampLevel(r.master) : 1, levels }
}

/** Just what the mixer needs to know about a tab. */
export interface SourceTab {
  id: string
  appId: string | null
  appName: string | null
  iconUrl: string | null
  /** the page's address (any form: only the host is used) */
  url: string
  title: string
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The identity a level is remembered under: the installed app, else the site, else (a page with no address) the tab. */
export function sourceKey(t: Pick<SourceTab, 'id' | 'appId' | 'url'>): string {
  if (t.appId) return `app:${t.appId}`
  const host = hostOf(t.url)
  return host ? `site:${host}` : `tab:${t.id}`
}

export interface Source {
  key: string
  name: string
  iconUrl: string | null
  tabIds: string[]
  /** the session in front (playing first, then the newest), when the source has a media element */
  session: MediaInfo | null
  /** something is playing right now (a media element, or a WebAudio context that is running) */
  playing: boolean
  webAudio: boolean
  kind: 'music' | 'video' | 'game' | 'sound'
}

/**
 * The mixer's rows: every source that has a media session or a running WebAudio context, one row per source, the ones playing
 * first (newest play first). A game has its own name and icon; a site is named after its page.
 */
export function buildSources(tabs: readonly SourceTab[], byTab: Record<string, MediaInfo[]>, audioTabs: Record<string, boolean>): Source[] {
  const rows = new Map<string, Source & { last: number }>()
  for (const t of tabs) {
    const sessions = byTab[t.id] ?? []
    const webAudio = !!audioTabs[t.id]
    if (!sessions.length && !webAudio) continue
    const key = sourceKey(t)
    const front = [...sessions].sort((a, b) => Number(b.playing) - Number(a.playing) || b.lastPlayed - a.lastPlayed)[0] ?? null
    const row = rows.get(key) ?? { key, name: '', iconUrl: t.iconUrl, tabIds: [], session: null, playing: false, webAudio: false, kind: 'sound' as const, last: 0 }
    row.tabIds.push(t.id)
    row.webAudio ||= webAudio
    if (front && (!row.session || Number(front.playing) - Number(row.session.playing) > 0 || (front.playing === row.session.playing && front.lastPlayed > row.session.lastPlayed))) row.session = front
    row.playing ||= sessions.some((s) => s.playing) || webAudio
    row.last = Math.max(row.last, front?.lastPlayed ?? 0)
    row.iconUrl ??= t.iconUrl
    // a site is named after the page that is making the sound (its tab), a game after the game
    if (!row.name || front) row.name = t.appName ?? (t.title || hostOf(t.url) || 'This tab')
    rows.set(key, row)
  }
  return [...rows.values()]
    .sort((a, b) => Number(b.playing) - Number(a.playing) || b.last - a.last)
    .map((row) => {
      const r: Source & { last?: number } = { ...row }
      delete r.last
      return { ...r, kind: kindOf(r, r.key.startsWith('app:')) }
    })
}

function kindOf(r: { session: MediaInfo | null; webAudio: boolean }, isApp: boolean): Source['kind'] {
  if (isApp && !r.session) return 'game'
  if (r.session) return r.session.kind === 'video' ? 'video' : 'music'
  return r.webAudio ? 'game' : 'sound'
}
