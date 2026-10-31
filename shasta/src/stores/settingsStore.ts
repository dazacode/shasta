import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SearchEngine } from '@/lib/url'
import { canRunLocalRelay, defaultWispUrl, defaultWispUrls, type TransportName } from '@/proxy/scramjetAdapter'
import { available as directAvailable } from '@/proxy/directFrame'
import { isWallpaper, type WallpaperName } from '@/lib/wallpaper'
import type { Tier } from '@/ai/catalog'
import { sanitizeRecord, type SupporterRecord } from '@/lib/supporter'
import { LITE } from '@/lib/edition'

export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentName = 'sky' | 'violet' | 'emerald' | 'amber' | 'rose' | 'orange'
export type Density = 'comfortable' | 'compact'
export type MotionPref = 'system' | 'reduced' | 'full'
export type UiScale = 'normal' | 'large' | 'larger'

export interface Shortcut {
  id: string
  title: string
  url: string
}

export interface PageAccess {
  camera: boolean
  microphone: boolean
  location: boolean
  clipboard: boolean
  /** WebUSB, WebSerial, WebHID, Web Bluetooth, MIDI */
  devices: boolean
}

/** On-device AI. Nothing is downloaded until the person asks for it. */
export interface AiSettings {
  /** the AI features appear in the browser (toolbar button, right-click entries) */
  enabled: boolean
  /** which chat model; 'auto' picks the one that suits this device */
  chatModel: 'auto' | Tier
  /** free the models' memory after this many idle minutes (0 = keep them loaded) */
  idleUnloadMinutes: number
  /** "Ask Shasta AI" entries in the right-click menu */
  contextMenu: boolean
  /** answers as cards, tables, steps and quizzes (generative UI): when the question suits it, never, or always */
  visual: 'auto' | 'off' | 'always'
  /** look up the topic of a factual question on Wikipedia (through Shasta's server) so the answer is not from memory alone */
  lookup: boolean
}

export type NewTabStyle = 'immersive' | 'classic' | 'minimal'
export const NEW_TAB_STYLES: NewTabStyle[] = ['immersive', 'classic', 'minimal']

export type NewTabBackground = 'preset' | 'color' | 'image'
export const NEW_TAB_BACKGROUNDS: NewTabBackground[] = ['preset', 'color', 'image']
export type NewTabClock = 'off' | '12' | '24'
export const NEW_TAB_CLOCKS: NewTabClock[] = ['off', '12', '24']
/** the blocks under the search bar, in the order the person chose */
export type NewTabSection = 'shortcuts' | 'apps' | 'live' | 'bookmarks' | 'recent'
export const NEW_TAB_SECTIONS: NewTabSection[] = ['shortcuts', 'apps', 'live', 'bookmarks', 'recent']

/** Known sections only, once each, in the given order; any missing one is appended. */
export function normalizeSectionOrder(v: unknown): NewTabSection[] {
  const seen = new Set<NewTabSection>()
  for (const x of Array.isArray(v) ? v : []) if (NEW_TAB_SECTIONS.includes(x) && !seen.has(x)) seen.add(x)
  for (const s of NEW_TAB_SECTIONS) seen.add(s)
  return [...seen]
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i

export interface Settings {
  // appearance
  theme: ThemeMode
  accent: AccentName
  density: Density
  motion: MotionPref
  showBookmarksBar: boolean
  /** new tab page background (a built-in preset, nothing is uploaded) */
  wallpaper: WallpaperName
  /** what the new tab page draws: a built-in preset, one flat colour, or the person's own picture */
  newTabBg: NewTabBackground
  /** #rrggbb for `newTabBg: 'color'` */
  newTabBgColor: string
  /** stamp of the picture kept on this device (lib/newTabBackground.ts), or null; the picture itself is never in settings */
  newTabBgImage: string | null
  /** 0-80: darken the picture or colour so text stays readable */
  newTabBgDim: number
  /** 0-20 px: soften the picture */
  newTabBgBlur: number
  newTabClock: NewTabClock
  newTabOrder: NewTabSection[]
  // accessibility
  uiScale: UiScale
  highContrast: boolean
  // browsing
  searchEngine: SearchEngine
  homepage: string
  newTabOpensHomepage: boolean
  restoreSession: boolean
  searchSuggestions: boolean
  // new tab page
  /** immersive = the atmospheric page, classic = a plain logo and search, minimal = the search bar alone */
  newTabStyle: NewTabStyle
  newTabLogo: boolean
  newTabGreeting: boolean
  newTabShortcuts: boolean
  /** custom wording for the immersive page; empty = the default */
  newTabGreetingText: string
  newTabHeadlineText: string
  newTabRecent: boolean
  newTabApps: boolean
  /** online count and trending sites/apps on the new tab page */
  newTabLive: boolean
  newTabBookmarks: boolean
  shortcuts: Shortcut[]
  // privacy
  saveHistory: boolean
  /** answer requests to known ad and tracker hosts with nothing (lib/adBlock.ts) */
  blockAds: boolean
  /** adverts on Shasta's own pages (lib/ads.ts): new tab, Store, Watch. Never inside the sites you open. */
  ads: boolean
  /** the thin advert strip along the bottom edge of the window (components/ads/AdBar.tsx) */
  adsBar: boolean
  /** refuse new tabs a page opens without a click or key press */
  blockPopups: boolean
  /** anonymous counts of features used and site hostnames opened (lib/usage.ts) */
  usageStats: boolean
  /** "Picked for you" in the Store, from a taste profile kept only in this browser (store/taste.ts) */
  storeForYou: boolean
  /** Watch: route video through Shasta's server (unblocked + ad-free embeds) instead of fetching it directly */
  watchProxy: boolean
  // performance
  suspendTabs: boolean
  suspendAfterMinutes: number
  /** watch memory and frame rate; warn and suspend background tabs before the device struggles */
  resourceGuard: boolean
  /** tidy caches and old records in the background while the browser is idle */
  autoCleanup: boolean
  // privacy: which powerful APIs pages may even ask for (the browser still prompts; off = blocked outright)
  pageAccess: PageAccess
  // on-device AI
  ai: AiSettings
  // offline application shell (lib/offline.ts). Device-specific, not part of a profile export.
  /** keep Shasta's own files on this device so it starts with no network (about 8 MB) */
  offlineShell: boolean
  /** also keep the AI runtime (27 MB) so AI models already downloaded work offline; models are never fetched for this */
  offlineAiRuntime: boolean
  // supporter (cosmetic perks only; see lib/supporter.ts). Credential-like: never part of a profile export.
  /** the redeemed code and its signed pass, or null */
  supporter: SupporterRecord | null
  /** a supporter perk: try new features before everyone else (only a flag for now) */
  earlyPreviews: boolean
  /** holiday looks (Halloween: new tab night, Store colours, Watch section); off = everything stays normal */
  seasonalLooks: boolean
  /** seasonal wallpapers this person claimed during their season, kept for good (lib/wallpaper.ts `claim`) */
  claimedWallpapers: WallpaperName[]
  // advanced
  /**
   * How tabs load websites in the installed app: `direct` (a <controlledframe>: the real site, any site works)
   * or `proxy` (Scramjet through the on-device relay). Normal tabs in a browser always use the proxy.
   */
  pageEngine: 'direct' | 'proxy'
  transport: TransportName
  /** the preferred Wisp endpoint */
  wispUrl: string
  /** extra endpoints tried in order when the preferred one is unreachable; the build's own (VITE_WISP_URLS, this host) follow them */
  wispUrls: string[]
}

export const ACCENTS: Record<AccentName, { label: string; swatch: string }> = {
  sky: { label: 'Sky', swatch: '#38bdf8' },
  violet: { label: 'Violet', swatch: '#a78bfa' },
  emerald: { label: 'Emerald', swatch: '#34d399' },
  amber: { label: 'Amber', swatch: '#fbbf24' },
  rose: { label: 'Rose', swatch: '#fb7185' },
  orange: { label: 'Orange', swatch: '#fb923c' },
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: 'yt', title: 'YouTube', url: 'https://www.youtube.com/' },
  { id: 'wiki', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
  { id: 'ddg', title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
]

export const defaultSettings = (): Settings => liteSettings({
  theme: 'system',
  accent: 'sky',
  density: 'comfortable',
  motion: 'system',
  showBookmarksBar: true,
  wallpaper: 'none',
  newTabBg: 'preset',
  newTabBgColor: '#1e293b',
  newTabBgImage: null,
  newTabBgDim: 0,
  newTabBgBlur: 0,
  newTabClock: 'off',
  newTabOrder: [...NEW_TAB_SECTIONS],
  uiScale: 'normal',
  highContrast: false,
  searchEngine: 'google',
  homepage: '',
  newTabOpensHomepage: false,
  restoreSession: true,
  searchSuggestions: true,
  newTabStyle: 'immersive',
  newTabLogo: true,
  newTabGreeting: true,
  newTabShortcuts: true,
  newTabGreetingText: '',
  newTabHeadlineText: '',
  newTabRecent: true,
  newTabApps: true,
  newTabLive: true,
  newTabBookmarks: true,
  shortcuts: DEFAULT_SHORTCUTS,
  saveHistory: true,
  blockAds: true,
  ads: true,
  adsBar: true,
  blockPopups: true,
  usageStats: true,
  storeForYou: true,
  watchProxy: true,
  pageAccess: { camera: false, microphone: false, location: false, clipboard: false, devices: false },
  suspendTabs: true,
  suspendAfterMinutes: 15,
  resourceGuard: true,
  autoCleanup: true,
  ai: { enabled: true, chatModel: 'auto', idleUnloadMinutes: 5, contextMenu: true, visual: 'auto', lookup: true },
  offlineShell: true,
  offlineAiRuntime: false,
  supporter: null,
  earlyPreviews: false,
  seasonalLooks: true,
  claimedWallpapers: [],
  // the installed app (an Isolated Web App) has sockets: browse with no relay server at all
  pageEngine: directAvailable() ? 'direct' : 'proxy',
  transport: canRunLocalRelay() ? 'local' : 'libcurl',
  wispUrl: defaultWispUrl(),
  wispUrls: [],
})

/**
 * Shasta Lite (lib/edition.ts): on-device AI (its runtime is not shipped there) and the offline shell (the host rewrites
 * index.html, so its checksums never match) are off and stay off. A normal build returns the settings unchanged.
 */
function liteSettings(s: Settings): Settings {
  if (!LITE) return s
  return { ...s, ai: { ...s.ai, enabled: false }, offlineShell: false, offlineAiRuntime: false }
}

interface SettingsState {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reset: () => void
}

const KEY = 'shasta-settings'
export const SETTINGS_VERSION = 6

/** Upgrades persisted settings from older shapes. Exported for tests. */
export function migrateSettings(persisted: unknown, version: number): Partial<SettingsState> {
  const old = (persisted ?? {}) as { settings?: Partial<Settings> }
  const settings = { ...defaultSettings(), ...(old.settings ?? {}) }
  // v1 -> v2: the Wisp URL field used to default to a ws:// URL on the page host; keep user overrides only
  if (version < 2 && !old.settings?.wispUrl) settings.wispUrl = defaultWispUrl()
  // v4 -> v5: supporter pass and early previews (absent before; whatever is there is validated, never trusted)
  settings.supporter = sanitizeRecord(settings.supporter)
  if (typeof settings.earlyPreviews !== 'boolean') settings.earlyPreviews = false
  // v5 -> v6: fallback Wisp endpoints (wispUrl stays the preferred one)
  settings.wispUrls = sanitizeUrls(settings.wispUrls)
  return { settings }
}

/** Saved settings win, but any field they lack (added in a newer version) falls back to its default. Exported for tests. */
export function mergeSettings(persisted: unknown, current: SettingsState): SettingsState {
  const saved = ((persisted as { settings?: Partial<Settings> } | null)?.settings ?? {}) as Partial<Settings>
  const settings: Settings = { ...current.settings, ...saved, pageAccess: { ...defaultSettings().pageAccess, ...(saved.pageAccess ?? {}) }, ai: { ...defaultSettings().ai, ...(saved.ai ?? {}) } }
  // a model tier that no longer exists (an older build offered 'plus') falls back to automatic
  if (!['auto', 'light', 'standard'].includes(settings.ai.chatModel)) settings.ai = { ...settings.ai, chatModel: 'auto' }
  if (!NEW_TAB_STYLES.includes(settings.newTabStyle)) settings.newTabStyle = 'immersive'
  if (settings.pageEngine !== 'direct' && settings.pageEngine !== 'proxy') settings.pageEngine = defaultSettings().pageEngine
  if (!Array.isArray(settings.shortcuts)) settings.shortcuts = DEFAULT_SHORTCUTS
  const d = defaultSettings()
  if (!NEW_TAB_BACKGROUNDS.includes(settings.newTabBg)) settings.newTabBg = d.newTabBg
  if (!NEW_TAB_CLOCKS.includes(settings.newTabClock)) settings.newTabClock = d.newTabClock
  if (typeof settings.newTabBgColor !== 'string' || !HEX_COLOR.test(settings.newTabBgColor)) settings.newTabBgColor = d.newTabBgColor
  if (typeof settings.newTabBgImage !== 'string') settings.newTabBgImage = null
  settings.newTabBgDim = clampNum(settings.newTabBgDim, 0, 80)
  settings.newTabBgBlur = clampNum(settings.newTabBgBlur, 0, 20)
  settings.newTabOrder = normalizeSectionOrder(settings.newTabOrder)
  settings.supporter = sanitizeRecord(settings.supporter)
  if (typeof settings.earlyPreviews !== 'boolean') settings.earlyPreviews = false
  settings.wispUrls = sanitizeUrls(settings.wispUrls)
  if (typeof settings.seasonalLooks !== 'boolean') settings.seasonalLooks = true
  settings.claimedWallpapers = Array.isArray(settings.claimedWallpapers) ? settings.claimedWallpapers.filter(isWallpaper) : []
  return { ...current, settings: liteSettings(settings) }
}

const clampNum = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo)

const sanitizeUrls = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.trim() !== '') : [])

/** Every Wisp endpoint to try, in order: the preferred one, the person's fallbacks, then the build's defaults. */
export function wispOptions(s: Settings = getSettings()) {
  return { transport: s.transport, wispUrl: s.wispUrl, wispUrls: [...s.wispUrls, ...defaultWispUrls()] }
}

function importLegacy(): Partial<Settings> | null {
  // the first prototype stored everything in 'shasta-state'
  try {
    const raw = localStorage.getItem('shasta-state')
    if (!raw) return null
    const legacy = JSON.parse(raw)?.state?.settings as Partial<Settings> | undefined
    return legacy ?? null
  } catch {
    return null
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: { ...defaultSettings(), ...(importLegacy() ?? {}) },
      update: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      reset: () => set({ settings: defaultSettings() }),
    }),
    {
      name: KEY,
      version: SETTINGS_VERSION,
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
      merge: (persisted, current) => mergeSettings(persisted, current),
      partialize: (s) => ({ settings: s.settings }),
    },
  ),
)

export const getSettings = () => useSettings.getState().settings
