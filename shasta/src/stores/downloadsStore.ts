import { create } from 'zustand'
import * as db from '@/lib/db'
import type { DownloadEvent } from '@/proxy/scramjetAdapter'
import { useTabs } from './tabsStore'

export type DownloadState = 'downloading' | 'complete' | 'interrupted'

export interface DownloadItem {
  id: string
  url: string
  filename: string
  mime: string
  total: number
  received: number
  state: DownloadState
  startedAt: number
  endedAt?: number
  error?: string
}

interface DownloadsState {
  items: DownloadItem[]
  load: () => Promise<void>
  apply: (e: DownloadEvent) => void
  remove: (id: string) => void
  clearFinished: () => void
  clearAll: () => Promise<void>
  /** keeps the newest `max` finished entries and drops finished ones older than `maxAgeMs` */
  prune: (max: number, maxAgeMs: number) => number
}

const save = (item: DownloadItem) => db.put('downloads', item).catch(() => undefined)

export const useDownloads = create<DownloadsState>()((set, get) => ({
  items: [],

  load: async () => {
    try {
      const stored = await db.getAll<DownloadItem>('downloads')
      // a transfer that was running when the page closed can't have finished
      const items = stored
        .map((d) => (d.state === 'downloading' ? { ...d, state: 'interrupted' as const, endedAt: d.endedAt ?? Date.now() } : d))
        .sort((a, b) => b.startedAt - a.startedAt)
      set({ items })
      void db.putMany('downloads', items.filter((d, i) => d !== stored[i]))
    } catch {
      /* storage unavailable: downloads are session-only */
    }
  },

  apply: (e) => {
    const existing = get().items.find((d) => d.id === e.id)
    const state: DownloadState = e.phase === 'complete' ? 'complete' : e.phase === 'error' ? 'interrupted' : 'downloading'
    const item: DownloadItem = {
      id: e.id,
      url: e.url,
      filename: e.filename,
      mime: e.mime,
      total: e.total,
      received: e.received,
      state,
      startedAt: existing?.startedAt ?? Date.now(),
      endedAt: state === 'downloading' ? undefined : Date.now(),
      error: e.error,
    }
    set((s) => ({ items: existing ? s.items.map((d) => (d.id === e.id ? item : d)) : [item, ...s.items] }))
    // persist only the transitions that matter, not every progress tick
    // a download that starts while a private tab is in front leaves no record on disk
    if (e.phase !== 'progress' && !useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)?.private) void save(item)
  },

  remove: (id) => {
    set((s) => ({ items: s.items.filter((d) => d.id !== id) }))
    void db.remove('downloads', id).catch(() => undefined)
  },

  clearFinished: () => {
    const doomed = get().items.filter((d) => d.state !== 'downloading')
    set((s) => ({ items: s.items.filter((d) => d.state === 'downloading') }))
    void db.remove('downloads', ...doomed.map((d) => d.id)).catch(() => undefined)
  },

  prune: (max, maxAgeMs) => {
    const cutoff = Date.now() - maxAgeMs
    const finished = get().items.filter((d) => d.state !== 'downloading')
    const doomed = finished.filter((d, i) => i >= max || (d.endedAt ?? d.startedAt) < cutoff)
    if (!doomed.length) return 0
    const gone = new Set(doomed.map((d) => d.id))
    set((s) => ({ items: s.items.filter((d) => !gone.has(d.id)) }))
    void db.remove('downloads', ...gone).catch(() => undefined)
    return gone.size
  },

  clearAll: async () => {
    set({ items: [] })
    await db.clear('downloads').catch(() => undefined)
  },
}))

export const activeDownloads = (items: DownloadItem[]) => items.filter((d) => d.state === 'downloading')

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}
