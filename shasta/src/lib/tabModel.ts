// Pure tab data model and the rules that keep it consistent. No side effects, so it is unit-testable.
import { NEW_TAB_URL, isInternalUrl, originOf, parseAppAddress, titleFor, type AppScheme } from './url'
import type { AccentName } from '@/stores/settingsStore'

export interface NavEntry {
  url: string
  title: string
}

export interface TabError {
  message: string
  url: string
}

/** The installed Store app a tab belongs to: it is shown as app://name or game://name and titled with the app's name. */
export interface TabApp {
  id: string
  slug: string
  scheme: AppScheme
  name: string
  iconUrl: string | null
  kind: 'package' | 'linked'
  /** where a web app starts (its real address); empty for uploaded packages */
  home: string
}

export interface Tab {
  id: string
  /** set while the tab is inside an installed app's scope */
  app: TabApp | null
  /** the browsing history of this tab; `entries[index]` is the page being shown */
  entries: NavEntry[]
  index: number
  pinned: boolean
  groupId: string | null
  loading: boolean
  /** true while we're waiting for the network (nothing committed yet) */
  pendingCommit: boolean
  error: TabError | null
  /** the first URL the frame reports after a user navigation replaces the entry (redirects) */
  expectReplace: boolean
  /** URL of the document currently inside the iframe, as reported by the frame */
  frameUrl: string
  /** an iframe exists for this tab (false until the first proxied page, and while suspended) */
  frame: boolean
  suspended: boolean
  /** bumped to remount the iframe from scratch */
  frameKey: number
  lastActiveAt: number
  /**
   * A private tab: Shasta keeps no history, session, favicon or bookmark for it. It does NOT isolate the websites'
   * cookies or storage (shared with normal tabs) and hides nothing from the network or the proxy operator.
   */
  private: boolean
}

export interface TabGroup {
  id: string
  title: string
  color: AccentName
  collapsed: boolean
}

export interface ClosedTab {
  id: string
  url: string
  title: string
  pinned: boolean
  groupId: string | null
  index: number
  closedAt: number
}

export const uid = () => crypto.randomUUID()

export function makeTab(url: string = NEW_TAB_URL, extra: Partial<Tab> = {}): Tab {
  return {
    id: uid(),
    app: null,
    entries: [{ url, title: titleFor(url) }],
    index: 0,
    pinned: false,
    groupId: null,
    loading: false,
    pendingCommit: false,
    error: null,
    expectReplace: false,
    frameUrl: '',
    frame: false,
    suspended: false,
    frameKey: 0,
    lastActiveAt: Date.now(),
    private: false,
    ...extra,
  }
}

/** The tabs that may be written to the saved session: private tabs never are. */
export const persistableTabs = <T extends { private?: boolean }>(tabs: T[]): T[] => tabs.filter((t) => !t.private)

/** A tab opened from a private tab (link, popup, duplicate) stays private; an explicit choice wins. */
export const inheritsPrivate = (opener: { private?: boolean } | undefined | null, explicit?: boolean): boolean => explicit ?? !!opener?.private

/** Whether a page visit should be written to history. */
export const shouldRecordVisit = (tab: { private?: boolean }, saveHistory: boolean): boolean => saveHistory && !tab.private

export const tabUrl = (t: Tab) => t.entries[t.index].url
export const tabTitle = (t: Tab) => t.app?.name ?? t.entries[t.index].title

/** Whether `url` still belongs to the installed app: its own address, or (web apps) the same site. */
export function inAppScope(app: TabApp, url: string): boolean {
  if (app.kind === 'package') return parseAppAddress(url)?.slug === app.slug
  return !!app.home && originOf(url) === originOf(app.home)
}

/** What the address bar shows: app://name for installed apps (plus the path inside a web app), the real address otherwise. */
export function shownAddress(t: Tab, fallback: (url: string) => string): string {
  const url = tabUrl(t)
  if (!t.app || !inAppScope(t.app, url)) return fallback(url)
  if (t.app.kind === 'package') return url
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return `${t.app.scheme}://${t.app.slug}${path}${u.search}${u.hash}`
  } catch {
    return `${t.app.scheme}://${t.app.slug}`
  }
}
export const isExternal = (url: string) => !isInternalUrl(url)

/** Pinned tabs first; the members of a group sit together at the position of the group's first tab. */
export function normalizeOrder(tabs: Tab[]): Tab[] {
  const pinned = tabs.filter((t) => t.pinned)
  const rest = tabs.filter((t) => !t.pinned)
  const out: Tab[] = []
  const placed = new Set<string>()
  for (const t of rest) {
    if (placed.has(t.id)) continue
    if (t.groupId) {
      for (const m of rest) {
        if (m.groupId === t.groupId) {
          out.push(m)
          placed.add(m.id)
        }
      }
    } else {
      out.push(t)
      placed.add(t.id)
    }
  }
  return [...pinned, ...out]
}

/**
 * Applies a URL reported by the real frame to the tab's history.
 *  - same as the current entry: nothing changed (duplicate event)
 *  - first report after a user navigation: the server redirected, replace the entry
 *  - matches the neighbouring entry: the page moved back/forward natively
 *  - otherwise: a new navigation, drop the forward entries and append
 */
export function applyFrameUrl(tab: Tab, url: string, title: string): Tab {
  const current = tab.entries[tab.index]
  const frameUrl = url
  if (current.url === url) return tab.frameUrl === frameUrl ? tab : { ...tab, frameUrl, expectReplace: false }
  if (tab.expectReplace) {
    const entries = tab.entries.slice()
    entries[tab.index] = { url, title }
    return { ...tab, entries, frameUrl, expectReplace: false }
  }
  if (tab.index > 0 && tab.entries[tab.index - 1].url === url) return { ...tab, index: tab.index - 1, frameUrl }
  if (tab.entries[tab.index + 1]?.url === url) return { ...tab, index: tab.index + 1, frameUrl }
  const entries = [...tab.entries.slice(0, tab.index + 1), { url, title }]
  return { ...tab, entries, index: entries.length - 1, frameUrl }
}

/** Adds a user-initiated navigation to the tab's history. */
export function pushEntry(tab: Tab, url: string, title: string): Tab {
  const entries = [...tab.entries.slice(0, tab.index + 1), { url, title }]
  return { ...tab, entries, index: entries.length - 1, expectReplace: isExternal(url), error: null }
}

export function setEntryTitle(tab: Tab, title: string, url?: string): Tab {
  const i = url ? tab.entries.findLastIndex((e) => e.url === url) : tab.index
  if (i < 0 || tab.entries[i].title === title) return tab
  const entries = tab.entries.slice()
  entries[i] = { ...entries[i], title }
  return { ...tab, entries }
}

export const canGoBack = (t: Tab) => t.index > 0
export const canGoForward = (t: Tab) => t.index < t.entries.length - 1

/** Chooses the tab to activate after `closedId` is removed from `tabs` (right neighbour, then left). */
export function pickNeighbour(tabs: Tab[], closedId: string): string | null {
  const i = tabs.findIndex((t) => t.id === closedId)
  const rest = tabs.filter((t) => t.id !== closedId)
  if (!rest.length) return null
  const closed = tabs[i]
  // prefer staying inside the same group, then the right neighbour
  const sameGroup = closed.groupId ? rest.filter((t) => t.groupId === closed.groupId) : []
  const pool = sameGroup.length ? sameGroup : rest
  const after = pool.find((t) => tabs.indexOf(t) > i)
  return (after ?? pool[pool.length - 1]).id
}
