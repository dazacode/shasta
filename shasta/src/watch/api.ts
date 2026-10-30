// Tiny client for the Watch API. Same-origin in a normal tab; in the installed app /api is another origin
// (lib/appApi.ts) and the app's global fetch sends it there, so relative URLs are correct everywhere.
import { APP_API_ORIGIN } from '@/lib/appApi'
import type { Candidate, Card, Featured, Kind, Row, RowData, Scope, Title } from './types'

export class WatchError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { headers: { accept: 'application/json' }, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new WatchError(0, "Can't reach the Shasta server.")
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new WatchError(res.status, body?.error?.message ?? `The server answered ${res.status}.`)
  }
  return (await res.json()) as T
}

/** Wrap an upstream stream URL through the Shasta proxy (referer + Range + CORS + filter-evasion live server-side). */
export const streamUrl = (url: string, referer?: string) =>
  `/api/watch/stream?url=${encodeURIComponent(url)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}`

/**
 * Absolute URL for the backend when the page is on a different origin (the installed app). hls.js, dash.js, <video>
 * and <track> do not go through the patched window.fetch, so a relative /api URL would hit the bundle and 404.
 */
export function apiUrl(path: string): string {
  return APP_API_ORIGIN && path.startsWith('/api/') ? APP_API_ORIGIN + path : path
}

export const watchApi = {
  check: () => get<{ enabled: boolean; tmdb: boolean; kuhi: boolean }>('/api/watch/check'),
  home: (scope: Scope) => get<{ enabled: boolean; tmdb: boolean; rows: Row[] }>(`/api/watch/home?kind=${scope}`),
  row: (key: string, signal?: AbortSignal) => get<RowData>(`/api/watch/row/${encodeURIComponent(key)}`, signal),
  featured: (signal?: AbortSignal) => get<{ items: Featured[] }>('/api/watch/featured', signal),
  search: (q: string, type?: Kind, signal?: AbortSignal) =>
    get<{ results: Card[] }>(`/api/watch/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`, signal),
  title: (kind: Kind, id: string, season?: number) => get<Title>(`/api/watch/title/${kind}/${encodeURIComponent(id)}${season ? `?season=${season}` : ''}`),
  sources: (kind: Kind, id: string, opts: { season?: number; episode?: number } = {}) =>
    get<{ sources: Candidate[] }>(`/api/watch/sources/${kind}/${encodeURIComponent(id)}?season=${opts.season ?? 1}&episode=${opts.episode ?? 1}`),
}
