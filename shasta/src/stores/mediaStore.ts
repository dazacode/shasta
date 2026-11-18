// What is playing, per tab, for the media hub (components/browser/MediaHub.tsx) and the tab strip's speaker icon.
// Filled by proxy/mediaWatch.ts; memory only, never persisted, never sent anywhere.
import { create } from 'zustand'
import { positionAt, type MediaInfo } from '@/lib/media'

interface MediaState {
  /** tabId -> its media sessions (only the ones worth showing, lib/media.ts isWorthShowing) */
  byTab: Record<string, MediaInfo[]>
  setTab: (tabId: string, list: MediaInfo[]) => void
  /** tabId -> true while a page in it has a running WebAudio context (games, emulators: sound that is not an <audio>/<video>) */
  audioTabs: Record<string, boolean>
  setAudioTabs: (tabs: Record<string, boolean>) => void
}

const EMPTY: MediaInfo[] = []

/** Nothing changed except a playhead that moved exactly as the clock predicts (the hub moves it by itself). */
function sameAsShown(prev: MediaInfo[] | undefined, next: MediaInfo[]): boolean {
  if (!prev || prev.length !== next.length) return false
  return next.every((n, i) => {
    const p = prev[i]
    for (const k of ['key', 'kind', 'title', 'artist', 'album', 'artwork', 'playing', 'duration', 'rate', 'muted', 'volume', 'lastPlayed'] as const) if (p[k] !== n[k]) return false
    if (JSON.stringify(p.actions) !== JSON.stringify(n.actions)) return false
    return Math.abs(positionAt(p, n.at) - n.position) < 0.75
  })
}

export const useMedia = create<MediaState>((set) => ({
  byTab: {},
  audioTabs: {},
  setAudioTabs: (audioTabs) =>
    set((s) => {
      const a = Object.keys(audioTabs)
      const b = Object.keys(s.audioTabs)
      return a.length === b.length && a.every((k) => s.audioTabs[k]) ? s : { audioTabs }
    }),
  setTab: (tabId, list) =>
    set((s) => {
      if (!list.length && !s.byTab[tabId]) return s
      if (sameAsShown(s.byTab[tabId], list)) return s
      const byTab = { ...s.byTab }
      if (list.length) byTab[tabId] = list
      else delete byTab[tabId]
      return { byTab }
    }),
}))

/** A tab's sessions (stable empty array, safe as a selector result). */
export const useTabMedia = (tabId: string) => useMedia((s) => s.byTab[tabId] ?? EMPTY)

/**
 * Tabs that must not be unloaded to save memory: one that is playing something, or running game sound, is doing its job in
 * the background (the mixer, the now-playing island and the tab strip's speaker all rely on it staying alive).
 */
export function audibleTabIds(): Set<string> {
  const { byTab, audioTabs } = useMedia.getState()
  const ids = new Set<string>()
  for (const [id, list] of Object.entries(byTab)) if (list.some((m) => m.playing)) ids.add(id)
  for (const id of Object.keys(audioTabs)) if (audioTabs[id]) ids.add(id)
  return ids
}
