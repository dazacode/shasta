// Profile export/import. The profile is the non-sensitive part of what Shasta keeps on this device: appearance and
// browsing preferences, new-tab shortcuts, bookmarks, and the Store library as a manifest of ids. It is built from an
// explicit allow-list, so cookies, site storage, tokens, passwords, history and app save data can never end up in it,
// and everything read back is validated rather than trusted.
import { defaultSettings, HEX_COLOR, NEW_TAB_CLOCKS, normalizeSectionOrder, type Settings } from '@/stores/settingsStore'
import type { BookmarkNode } from '@/stores/libraryStore'
import { fromManifest, toManifest, type LibraryManifest, type LocalLibrary } from '@/store/localLibrary'
import { isWallpaper } from './wallpaper'
import { SEARCH_ENGINES } from './url'

export const PROFILE_FORMAT = 'shasta-profile'
export const PROFILE_VERSION = 1
const MAX_PROFILE_BYTES = 5 * 1024 * 1024

/** Settings that travel with a profile. Device- and server-specific ones (Wisp URL, transport) deliberately do not. */
export const PORTABLE_SETTINGS = [
  'theme', 'accent', 'density', 'motion', 'showBookmarksBar', 'wallpaper', 'newTabBg', 'newTabBgColor', 'newTabBgDim', 'newTabBgBlur', 'newTabClock', 'newTabOrder', 'uiScale', 'highContrast',
  'searchEngine', 'homepage', 'newTabOpensHomepage', 'restoreSession', 'searchSuggestions',
  'newTabStyle', 'newTabLogo', 'newTabGreeting', 'newTabShortcuts', 'newTabGreetingText', 'newTabHeadlineText',
  'newTabRecent', 'newTabApps', 'newTabLive', 'newTabBookmarks', 'shortcuts', 'saveHistory', 'blockAds', 'blockPopups',
  'suspendTabs', 'suspendAfterMinutes', 'resourceGuard', 'autoCleanup',
] as const satisfies readonly (keyof Settings)[]
type Portable = (typeof PORTABLE_SETTINGS)[number]

export interface Profile {
  format: typeof PROFILE_FORMAT
  version: number
  exportedAt: string
  settings: Partial<Pick<Settings, Portable>>
  bookmarks: BookmarkNode[]
  library: LibraryManifest
}

export function buildProfile(settings: Settings, bookmarks: BookmarkNode[], local: LocalLibrary, now = new Date()): Profile {
  const picked: Record<string, unknown> = {}
  for (const k of PORTABLE_SETTINGS) picked[k] = settings[k]
  return { format: PROFILE_FORMAT, version: PROFILE_VERSION, exportedAt: now.toISOString(), settings: picked as Profile['settings'], bookmarks, library: toManifest(local) }
}

const ENUMS: Partial<Record<Portable, readonly string[]>> = {
  theme: ['system', 'light', 'dark'],
  accent: ['sky', 'violet', 'emerald', 'amber', 'rose', 'orange'],
  density: ['comfortable', 'compact'],
  motion: ['system', 'reduced', 'full'],
  uiScale: ['normal', 'large', 'larger'],
  searchEngine: Object.keys(SEARCH_ENGINES),
  newTabStyle: ['immersive', 'classic', 'minimal'],
}
const WEB_OR_SHASTA = /^(https?|shasta):\/\//i
const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)

/** Keeps only the settings that are known, of the right type and in range. */
export function sanitizeSettings(raw: unknown): Profile['settings'] {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const defaults = defaultSettings()
  const out: Record<string, unknown> = {}
  for (const k of PORTABLE_SETTINGS) {
    const v = src[k]
    if (v === undefined) continue
    const enums = ENUMS[k]
    if (k === 'wallpaper') {
      if (isWallpaper(v)) out[k] = v
    } else if (k === 'newTabBg') {
      // the picture stays on its device, so a profile can only carry "preset" or "color"
      if (v === 'preset' || v === 'color') out[k] = v
    } else if (k === 'newTabBgColor') {
      if (typeof v === 'string' && HEX_COLOR.test(v)) out[k] = v
    } else if (k === 'newTabBgDim') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(80, Math.max(0, Math.round(v)))
    } else if (k === 'newTabBgBlur') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(20, Math.max(0, Math.round(v)))
    } else if (k === 'newTabClock') {
      if (typeof v === 'string' && (NEW_TAB_CLOCKS as string[]).includes(v)) out[k] = v
    } else if (k === 'newTabOrder') {
      if (Array.isArray(v)) out[k] = normalizeSectionOrder(v)
    } else if (k === 'shortcuts') {
      if (Array.isArray(v))
        out[k] = v
          .slice(0, 12)
          .map((s) => ({ id: str(s?.id, 80), title: str(s?.title, 60), url: str(s?.url, 2000) }))
          .filter((s) => s.id && s.title !== null && s.url && /^https?:\/\//i.test(s.url))
    } else if (k === 'newTabGreetingText' || k === 'newTabHeadlineText') {
      const t = str(v, 60)
      if (t !== null) out[k] = t
    } else if (k === 'homepage') {
      const h = str(v, 2000)
      if (h !== null && (h === '' || /^https?:\/\//i.test(h))) out[k] = h
    } else if (enums) {
      if (typeof v === 'string' && enums.includes(v)) out[k] = v
    } else if (k === 'suspendAfterMinutes') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(240, Math.max(1, Math.round(v)))
    } else if (typeof v === typeof defaults[k]) out[k] = v
  }
  return out as Profile['settings']
}

function sanitizeBookmarks(raw: unknown): BookmarkNode[] {
  if (!Array.isArray(raw)) return []
  const nodes: BookmarkNode[] = []
  const ids = new Set<string>()
  for (const n of raw.slice(0, 5000)) {
    const id = str(n?.id, 80)
    const title = str(n?.title, 500)
    if (!id || title === null || ids.has(id)) continue
    ids.add(id)
    const parentId = str(n?.parentId, 80)
    const createdAt = typeof n?.createdAt === 'number' ? n.createdAt : Date.now()
    if (n?.type === 'folder') nodes.push({ id, type: 'folder', title, parentId, createdAt })
    else if (n?.type === 'bookmark') {
      const url = str(n?.url, 4000)
      if (url && WEB_OR_SHASTA.test(url)) nodes.push({ id, type: 'bookmark', title, url, parentId, createdAt })
    }
  }
  // a node whose folder did not survive goes to the top level
  const folders = new Set(nodes.filter((n) => n.type === 'folder').map((n) => n.id))
  return nodes.map((n) => (n.parentId && !folders.has(n.parentId) ? { ...n, parentId: null } : n))
}

export type ParseResult = { ok: true; profile: Profile } | { ok: false; error: string }

export function parseProfile(text: string): ParseResult {
  if (text.length > MAX_PROFILE_BYTES) return { ok: false, error: 'That file is too large to be a Shasta profile.' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not a Shasta profile (it is not valid JSON).' }
  }
  const p = raw as Partial<Profile> | null
  if (!p || p.format !== PROFILE_FORMAT) return { ok: false, error: 'That file is not a Shasta profile.' }
  if (typeof p.version !== 'number' || p.version > PROFILE_VERSION) return { ok: false, error: 'That profile was made by a newer version of Shasta. Update Shasta and try again.' }
  const lib = fromManifest(p.library)
  return {
    ok: true,
    profile: {
      format: PROFILE_FORMAT,
      version: PROFILE_VERSION,
      exportedAt: str(p.exportedAt, 40) ?? '',
      settings: sanitizeSettings(p.settings),
      bookmarks: sanitizeBookmarks(p.bookmarks),
      library: toManifest(lib),
    },
  }
}

export interface ProfileSummary {
  settings: number
  bookmarks: number
  apps: number
  favorites: number
  following: number
}
export const summarize = (p: Profile): ProfileSummary => ({
  settings: Object.keys(p.settings).length,
  bookmarks: p.bookmarks.filter((b) => b.type === 'bookmark').length,
  apps: p.library.apps.length,
  favorites: p.library.favorites.length,
  following: p.library.following.length,
})

export const profileFilename = (now = new Date()) => `shasta-profile-${now.toISOString().slice(0, 10)}.json`

/** Saves a profile file through the browser's download (Settings -> Profile & data, and the app setup guide). */
export function downloadProfile(settings: Settings, bookmarks: BookmarkNode[], local: LocalLibrary) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(buildProfile(settings, bookmarks, local), null, 2)], { type: 'application/json' }))
  a.download = profileFilename()
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
