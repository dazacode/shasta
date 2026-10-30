import { create } from 'zustand'
import * as proxy from '@/proxy/scramjetAdapter'
import type { FrameEvents } from '@/proxy/scramjetAdapter'
import { NEW_TAB_URL, appAddress, internalPage, internalUrl, isInternalUrl, resolveInput, titleFor, type InternalPage } from '@/lib/url'
import {
  applyFrameUrl,
  canGoBack,
  canGoForward,
  inheritsPrivate,
  makeTab,
  normalizeOrder,
  persistableTabs,
  pickNeighbour,
  pushEntry,
  setEntryTitle,
  shouldRecordVisit,
  tabTitle,
  tabUrl,
  uid,
  type ClosedTab,
  type TabApp,
  inAppScope,
  type Tab,
  type TabGroup,
} from '@/lib/tabModel'
import { ACCENTS, getSettings, type AccentName } from './settingsStore'
import { useLibrary } from './libraryStore'
import { useUi } from './uiStore'
import { trackEvent, trackSite } from '@/lib/usage'
import { trackPage } from '@/lib/stats'

const CLOSED_LIMIT = 25
const SESSION_KEY = 'shasta-session'
const SESSION_VERSION = 1

interface TabsState {
  tabs: Tab[]
  activeId: string
  groups: TabGroup[]
  closed: ClosedTab[]

  // tabs
  newTab: (input?: string, opts?: { background?: boolean; afterId?: string; atEnd?: boolean; private?: boolean }) => string
  /** a Private tab: no history, session, favicon or bookmark is saved for it (site cookies are still shared) */
  newPrivateTab: (input?: string) => string
  openInternal: (page: InternalPage, section?: string) => void
  /** opens (or focuses) the tab that runs an installed Store app; web apps load `url` through the proxy */
  openApp: (app: TabApp, url?: string) => string
  /** marks a tab as belonging to an installed app (used when an app:// tab is restored or opened by address) */
  setTabApp: (id: string, app: TabApp | null) => void
  /** names a Shasta page's tab after what it shows (an app, a store listing) */
  setInternalTitle: (id: string, title: string) => void
  closeTab: (id: string) => void
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  reopenClosed: () => void
  duplicateTab: (id: string) => void
  selectTab: (id: string) => void
  cycleTab: (dir: 1 | -1) => void
  selectIndex: (n: number) => void
  moveTab: (id: string, toIndex: number) => void
  pinTab: (id: string, pinned: boolean) => void
  resetFrame: (id: string) => void
  suspendIdle: () => void
  /** release background pages, least recently used first, until at most `keepLive` pages remain loaded */
  suspendBackground: (keepLive: number) => number

  // groups
  groupTabs: (ids: string[], title?: string) => string | null
  addToGroup: (id: string, groupId: string) => void
  ungroupTab: (id: string) => void
  updateGroup: (groupId: string, patch: Partial<Omit<TabGroup, 'id'>>) => void
  toggleGroup: (groupId: string) => void
  closeGroup: (groupId: string) => void

  // navigation
  submit: (id: string, input: string) => boolean
  navigateTo: (id: string, url: string) => void
  back: (id?: string) => void
  forward: (id?: string) => void
  reload: (id?: string) => void
  stop: (id?: string) => void
  home: (id?: string) => void

  // reports from the real frame
  frameEvents: (id: string) => Omit<FrameEvents, 'key' | 'contextMenu'>
}

const GROUP_COLORS = Object.keys(ACCENTS) as AccentName[]

/** Opens an installed app by address (app://name, game://name). Registered by the Store, which knows what is installed. */
let appLauncher: ((addr: { slug: string; path: string }) => void) | null = null
export const registerAppLauncher = (fn: typeof appLauncher) => (appLauncher = fn)

function startTabs(): { tabs: Tab[]; activeId: string; groups: TabGroup[]; closed: ClosedTab[] } {
  const fresh = () => {
    const tab = makeTab(startUrl())
    return { tabs: [tab], activeId: tab.id, groups: [], closed: [] }
  }
  const saved = readSession()
  if (!saved) return fresh()
  if (!getSettings().restoreSession) return { ...fresh(), closed: saved.closed }
  const tabs = saved.tabs.map((t) =>
    makeTab(t.url, {
      id: t.id,
      app: t.app ?? null,
      entries: [{ url: t.url, title: t.title }],
      pinned: t.pinned,
      groupId: saved.groups.some((g) => g.id === t.groupId) ? t.groupId : null,
      // only the visible tab loads at startup; the rest wake when selected
      frame: false,
      suspended: !isInternalUrl(t.url) && t.id !== saved.activeId,
    }),
  )
  const active = tabs.find((t) => t.id === saved.activeId) ?? tabs[0]
  if (!isInternalUrl(tabUrl(active))) {
    active.frame = true
    active.loading = true
    active.pendingCommit = true
    active.expectReplace = true
  }
  return { tabs: normalizeOrder(tabs), activeId: active.id, groups: saved.groups, closed: saved.closed }
}

function startUrl(): string {
  const { homepage, newTabOpensHomepage } = getSettings()
  return newTabOpensHomepage && homepage ? homepage : NEW_TAB_URL
}

// ---- session persistence ---------------------------------------------------------------

interface SessionTab {
  id: string
  url: string
  title: string
  pinned: boolean
  groupId: string | null
  app?: TabApp | null
}
interface Session {
  version: number
  tabs: SessionTab[]
  activeId: string
  groups: TabGroup[]
  closed: ClosedTab[]
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    if (s.version !== SESSION_VERSION || !Array.isArray(s.tabs) || !s.tabs.length) return null
    const tabs = s.tabs.filter((t) => t && typeof t.id === 'string' && typeof t.url === 'string')
    if (!tabs.length) return null
    return {
      version: SESSION_VERSION,
      tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: String(t.title ?? ''), pinned: !!t.pinned, groupId: t.groupId ?? null, app: t.app ?? null })),
      activeId: s.activeId,
      groups: Array.isArray(s.groups) ? s.groups : [],
      closed: Array.isArray(s.closed) ? s.closed.slice(0, CLOSED_LIMIT) : [],
    }
  } catch {
    return null
  }
}

function writeSession(state: TabsState) {
  try {
    const session: Session = {
      version: SESSION_VERSION,
      tabs: persistableTabs(state.tabs).map((t) => ({ id: t.id, url: tabUrl(t), title: tabTitle(t), pinned: t.pinned, groupId: t.groupId, app: t.app })),
      activeId: state.activeId,
      groups: state.groups,
      closed: state.closed,
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* storage full or blocked: the session just won't survive a refresh */
  }
}

// ---- store -----------------------------------------------------------------------------

const initial = startTabs()

export const useTabs = create<TabsState>()((set, get) => {
  const update = (id: string, fn: (t: Tab) => Tab) =>
    set((s) => {
      let changed = false
      const tabs = s.tabs.map((t) => {
        if (t.id !== id) return t
        const next = fn(t)
        if (next !== t) changed = true
        return next
      })
      return changed ? { tabs } : s
    })

  const find = (id?: string) => {
    const s = get()
    return s.tabs.find((t) => t.id === (id ?? s.activeId))
  }

  /** A tab whose content must come from the proxy gets a frame; the TabFrame component attaches it. */
  const wake = (t: Tab): Tab => (t.frame && !t.suspended ? t : { ...t, frame: true, suspended: false, frameKey: t.frameKey + 1 })
  /** Marks a tab as the one being looked at; a suspended tab reloads its page. */
  const activate = (t: Tab): Tab =>
    t.suspended ? { ...wake(t), loading: true, pendingCommit: true, expectReplace: true, lastActiveAt: Date.now() } : { ...t, lastActiveAt: Date.now() }

  return {
    ...initial,

    newTab: (input, { background = false, afterId, atEnd = false, private: priv } = {}) => {
      const settings = getSettings()
      let url = startUrl()
      if (input) {
        const r = resolveInput(input, settings.searchEngine)
        if (r.kind === 'url' || r.kind === 'internal' || r.kind === 'search' || r.kind === 'app') url = r.url
      }
      const external = !isInternalUrl(url)
      const opener = afterId ? get().tabs.find((t) => t.id === afterId) : undefined
      const tab = makeTab(url, { private: inheritsPrivate(opener, priv), ...(external ? { frame: true, loading: true, pendingCommit: true, expectReplace: true } : {}) })
      set((s) => {
        const anchor = afterId ? s.tabs.findIndex((t) => t.id === afterId) : atEnd ? -1 : s.tabs.findIndex((t) => t.id === s.activeId)
        const after = anchor >= 0 ? s.tabs[anchor] : null
        if (after?.groupId) tab.groupId = after.groupId
        const at = anchor >= 0 ? anchor + 1 : s.tabs.length
        const tabs = normalizeOrder([...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)])
        return { tabs, activeId: background ? s.activeId : tab.id }
      })
      return tab.id
    },

    newPrivateTab: (input) => get().newTab(input, { atEnd: true, private: true }),

    openInternal: (page, section) => {
      const url = internalUrl(page, section)
      const existing = get().tabs.find((t) => internalPage(tabUrl(t)) === page)
      if (existing) {
        get().selectTab(existing.id)
        if (section && tabUrl(existing) !== url) get().navigateTo(existing.id, url)
        return
      }
      // reuse the active tab when it is an empty new tab, like browsers do for chrome:// pages
      const active = find()
      if (active && tabUrl(active) === NEW_TAB_URL && active.entries.length === 1) return get().navigateTo(active.id, url)
      get().newTab(url)
    },

    openApp: (app, url) => {
      // only a tab that really belongs to this app counts (a plain tab has no app, which must never match)
      const existing = app.id ? get().tabs.find((t) => t.app !== null && t.app.id === app.id) : undefined
      if (existing) {
        get().selectTab(existing.id)
        return existing.id
      }
      trackEvent(app.kind === 'package' ? 'app.launch' : 'app.launch.web')
      const target = app.kind === 'package' ? appAddress(app.scheme, app.slug) : (url ?? app.home)
      // like a browser opening a link in an empty new tab: reuse it instead of leaving a blank one behind
      const active = find()
      let id: string
      if (active && tabUrl(active) === NEW_TAB_URL && active.entries.length === 1) {
        get().navigateTo(active.id, target)
        id = active.id
      } else id = get().newTab(target)
      get().setTabApp(id, app)
      return id
    },

    setTabApp: (id, app) => update(id, (t) => (t.app === app ? t : { ...t, app })),

    setInternalTitle: (id, title) => update(id, (t) => setEntryTitle(t, title)),

    closeTab: (id) => {
      const s = get()
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return
      const url = tabUrl(tab)
      const closed: ClosedTab[] =
        url === NEW_TAB_URL || tab.private
          ? s.closed
          : [{ id: uid(), url, title: tabTitle(tab), pinned: tab.pinned, groupId: tab.groupId, index: s.tabs.indexOf(tab), closedAt: Date.now() }, ...s.closed].slice(0, CLOSED_LIMIT)
      const nextActive = s.activeId === id ? pickNeighbour(s.tabs, id) : s.activeId
      const remaining = s.tabs.filter((t) => t.id !== id)
      const groups = s.groups.filter((g) => remaining.some((t) => t.groupId === g.id))
      if (!remaining.length) {
        const blank = makeTab(startUrl())
        return set({ tabs: [blank], activeId: blank.id, groups: [], closed })
      }
      set({ tabs: remaining, activeId: nextActive ?? remaining[0].id, groups, closed })
      update(nextActive ?? remaining[0].id, activate)
    },

    closeOthers: (id) => {
      const keep = get().tabs.find((t) => t.id === id)
      if (!keep) return
      get()
        .tabs.filter((t) => t.id !== id && !t.pinned)
        .forEach((t) => get().closeTab(t.id))
      get().selectTab(id)
    },

    closeToRight: (id) => {
      const tabs = get().tabs
      const i = tabs.findIndex((t) => t.id === id)
      tabs.slice(i + 1).filter((t) => !t.pinned).forEach((t) => get().closeTab(t.id))
    },

    reopenClosed: () => {
      const [last, ...rest] = get().closed
      if (!last) return useUi.getState().toast('No recently closed tabs')
      const tab = makeTab(last.url, { pinned: last.pinned, ...(isInternalUrl(last.url) ? {} : { frame: true, loading: true, pendingCommit: true, expectReplace: true }) })
      tab.entries = [{ url: last.url, title: last.title || titleFor(last.url) }]
      set((s) => {
        const groupId = last.groupId && s.groups.some((g) => g.id === last.groupId) ? last.groupId : null
        const tabs = [...s.tabs]
        tabs.splice(Math.min(last.index, tabs.length), 0, { ...tab, groupId: tab.pinned ? null : groupId })
        return { tabs: normalizeOrder(tabs), activeId: tab.id, closed: rest }
      })
    },

    duplicateTab: (id) => {
      const tab = find(id)
      if (!tab) return
      get().newTab(tabUrl(tab), { afterId: id })
    },

    selectTab: (id) => {
      const tab = find(id)
      if (!tab) return
      // selecting a tab inside a collapsed group opens the group
      set((s) => ({ activeId: id, groups: s.groups.map((g) => (g.id === tab.groupId && g.collapsed ? { ...g, collapsed: false } : g)) }))
      update(id, activate)
    },

    cycleTab: (dir) => {
      const { tabs, activeId } = get()
      const i = tabs.findIndex((t) => t.id === activeId)
      get().selectTab(tabs[(i + dir + tabs.length) % tabs.length].id)
    },

    selectIndex: (n) => {
      const { tabs } = get()
      get().selectTab(n >= 9 ? tabs[tabs.length - 1].id : (tabs[n - 1] ?? tabs[tabs.length - 1]).id)
    },

    moveTab: (id, toIndex) =>
      set((s) => {
        const from = s.tabs.findIndex((t) => t.id === id)
        if (from < 0) return s
        const tab = s.tabs[from]
        const pinnedCount = s.tabs.filter((t) => t.pinned).length
        const rest = s.tabs.filter((t) => t.id !== id)
        const lo = tab.pinned ? 0 : pinnedCount
        const hi = tab.pinned ? pinnedCount - 1 : rest.length
        const at = Math.max(lo, Math.min(toIndex, hi))
        rest.splice(at, 0, tab)
        const left = rest[at - 1]
        const right = rest[at + 1]
        let groupId = tab.groupId
        if (!tab.pinned) {
          if (left?.groupId && left.groupId === right?.groupId) groupId = left.groupId
          else if (groupId && left?.groupId !== groupId && right?.groupId !== groupId) groupId = null
        }
        rest[at] = { ...tab, groupId }
        const groups = s.groups.filter((g) => rest.some((t) => t.groupId === g.id))
        return { tabs: normalizeOrder(rest), groups }
      }),

    pinTab: (id, pinned) =>
      set((s) => {
        const tabs = s.tabs.map((t) => (t.id === id ? { ...t, pinned, groupId: pinned ? null : t.groupId } : t))
        const groups = s.groups.filter((g) => tabs.some((t) => t.groupId === g.id))
        return { tabs: normalizeOrder(tabs), groups }
      }),

    resetFrame: (id) => {
      const tab = find(id)
      if (!tab || isInternalUrl(tabUrl(tab))) return
      update(id, (t) => ({ ...t, frame: true, frameKey: t.frameKey + 1, loading: true, pendingCommit: true, error: null, expectReplace: false, frameUrl: '' }))
    },

    suspendIdle: () => {
      const { suspendTabs, suspendAfterMinutes } = getSettings()
      if (!suspendTabs) return
      const cutoff = Date.now() - suspendAfterMinutes * 60_000
      set((s) => {
        let changed = false
        const tabs = s.tabs.map((t) => {
          if (t.id === s.activeId || !t.frame || t.suspended || t.loading || t.lastActiveAt > cutoff) return t
          changed = true
          return { ...t, frame: false, suspended: true, frameUrl: '' }
        })
        return changed ? { tabs } : s
      })
    },

    suspendBackground: (keepLive) => {
      let released = 0
      set((s) => {
        const live = s.tabs.filter((t) => t.frame && !t.suspended)
        const excess = live.length - Math.max(1, keepLive)
        if (excess <= 0) return s
        const victims = new Set(
          live
            .filter((t) => t.id !== s.activeId && !t.loading)
            .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
            .slice(0, excess)
            .map((t) => t.id),
        )
        released = victims.size
        return { tabs: s.tabs.map((t) => (victims.has(t.id) ? { ...t, frame: false, suspended: true, frameUrl: '' } : t)) }
      })
      return released
    },

    // ---- groups
    groupTabs: (ids, title = '') => {
      const members = get().tabs.filter((t) => ids.includes(t.id) && !t.pinned)
      if (!members.length) return null
      const id = uid()
      set((s) => {
        const color = GROUP_COLORS[s.groups.length % GROUP_COLORS.length]
        const tabs = s.tabs.map((t) => (ids.includes(t.id) && !t.pinned ? { ...t, groupId: id } : t))
        const groups = [...s.groups.filter((g) => tabs.some((t) => t.groupId === g.id)), { id, title, color, collapsed: false }]
        return { tabs: normalizeOrder(tabs), groups }
      })
      return id
    },

    addToGroup: (id, groupId) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id)
        if (!tab || tab.pinned || !s.groups.some((g) => g.id === groupId)) return s
        const tabs = s.tabs.map((t) => (t.id === id ? { ...t, groupId } : t))
        const groups = s.groups.filter((g) => tabs.some((t) => t.groupId === g.id))
        return { tabs: normalizeOrder(tabs), groups }
      }),

    ungroupTab: (id) =>
      set((s) => {
        const tabs = s.tabs.map((t) => (t.id === id ? { ...t, groupId: null } : t))
        return { tabs: normalizeOrder(tabs), groups: s.groups.filter((g) => tabs.some((t) => t.groupId === g.id)) }
      }),

    updateGroup: (groupId, patch) => set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) })),

    toggleGroup: (groupId) =>
      set((s) => {
        const group = s.groups.find((g) => g.id === groupId)
        if (!group) return s
        const collapsed = !group.collapsed
        // never leave the active tab hidden inside a collapsed group
        const active = s.tabs.find((t) => t.id === s.activeId)
        let activeId = s.activeId
        if (collapsed && active?.groupId === groupId) {
          const other = s.tabs.find((t) => t.groupId !== groupId)
          if (other) activeId = other.id
          else return s
        }
        return { groups: s.groups.map((g) => (g.id === groupId ? { ...g, collapsed } : g)), activeId }
      }),

    closeGroup: (groupId) => {
      get().tabs.filter((t) => t.groupId === groupId).forEach((t) => get().closeTab(t.id))
    },

    // ---- navigation
    submit: (id, input) => {
      const r = resolveInput(input, getSettings().searchEngine)
      if (r.kind === 'empty') return false
      if (r.kind === 'invalid') {
        useUi.getState().toast(r.reason, { tone: 'error' })
        return false
      }
      if (r.kind === 'app') {
        appLauncher?.({ slug: r.slug, path: r.path })
        return true
      }
      get().navigateTo(id, r.url)
      return true
    },

    navigateTo: (id, url) => {
      const tab = find(id)
      if (!tab) return
      if (tabUrl(tab) === url && !isInternalUrl(url)) return get().reload(id)
      const external = !isInternalUrl(url)
      if (!tab.private) {
        if (external) trackSite(url)
        else {
          const page = internalPage(url)
          if (page && page !== 'newtab') trackEvent(`page.${page}`)
          if (page) trackPage(`/${page}`)
        }
      }
      const next = pushEntry(tab, url, titleFor(url))
      update(id, () => ({
        ...next,
        app: tab.app && inAppScope(tab.app, url) ? tab.app : null,
        loading: external,
        pendingCommit: external,
        frame: tab.frame || external,
        suspended: false,
        lastActiveAt: Date.now(),
      }))
      if (external) {
        if (proxy.hasFrame(id) && !tab.suspended) proxy.go(id, url)
      } else {
        proxy.stop(id)
      }
    },

    back: (id) => {
      const tab = find(id)
      if (!tab || !canGoBack(tab)) return
      moveInHistory(tab, -1)
    },

    forward: (id) => {
      const tab = find(id)
      if (!tab || !canGoForward(tab)) return
      moveInHistory(tab, 1)
    },

    reload: (id) => {
      const tab = find(id)
      if (!tab) return
      const url = tabUrl(tab)
      if (isInternalUrl(url)) return
      if (tab.error || !proxy.hasFrame(tab.id) || tab.suspended) {
        update(tab.id, (t) => ({ ...t, ...(t.frame && !t.suspended ? {} : wake(t)), error: null, loading: true, pendingCommit: true, expectReplace: true }))
        if (proxy.hasFrame(tab.id)) proxy.go(tab.id, url)
        return
      }
      update(tab.id, (t) => ({ ...t, loading: true, pendingCommit: true, error: null }))
      if (!proxy.reload(tab.id)) proxy.go(tab.id, url)
    },

    stop: (id) => {
      const tab = find(id)
      if (!tab?.loading) return
      proxy.stop(tab.id)
      update(tab.id, (t) => ({ ...t, loading: false, pendingCommit: false, expectReplace: false }))
    },

    home: (id) => {
      const target = find(id)
      if (!target) return
      get().navigateTo(target.id, getSettings().homepage || NEW_TAB_URL)
    },

    frameEvents: (id) => ({
      navStart: ({ committed }) => update(id, (t) => (t.loading && t.pendingCommit === !committed ? t : { ...t, loading: true, pendingCommit: !committed, error: null })),

      url: (url) => {
        const tab = find(id)
        if (!tab) return
        update(id, (t) => ({ ...applyFrameUrl(t, url, titleFor(url)), error: null }))
        // keep the address bar title sensible until the page supplies one
        const known = useLibrary.getState().history.find((h) => h.url === url)?.title
        if (known) update(id, (t) => setEntryTitle(t, known))
      },

      title: (title) => {
        const tab = find(id)
        if (!tab) return
        update(id, (t) => setEntryTitle(t, title))
        if (!tab.private) useLibrary.getState().updateVisitTitle(tabUrl(tab), title)
      },

      favicon: (origin, dataUrl) => useLibrary.getState().setFavicon(origin, dataUrl, { persist: !find(id)?.private }),

      loaded: () => {
        update(id, (t) => (t.loading || t.pendingCommit || t.expectReplace ? { ...t, loading: false, pendingCommit: false, expectReplace: false } : t))
        const tab = find(id)
        if (tab && shouldRecordVisit(tab, getSettings().saveHistory) && !isInternalUrl(tabUrl(tab))) useLibrary.getState().recordVisit(tabUrl(tab), tabTitle(tab))
      },

      failed: ({ message, url }) =>
        update(id, (t) => ({ ...t, loading: false, pendingCommit: false, expectReplace: false, error: { message, url: url || tabUrl(t) } })),
    }),
  }

  function moveInHistory(tab: Tab, delta: -1 | 1) {
    const from = tabUrl(tab)
    const to = tab.entries[tab.index + delta].url
    const toExternal = !isInternalUrl(to)
    const nativeStep = toExternal && !isInternalUrl(from) && tab.frameUrl === from && !tab.error && proxy.hasFrame(tab.id)
    const alreadyShown = toExternal && tab.frameUrl === to && !tab.error && proxy.hasFrame(tab.id)
    update(tab.id, (t) => ({
      ...t,
      index: t.index + delta,
      error: null,
      expectReplace: false,
      loading: toExternal && !alreadyShown,
      pendingCommit: toExternal && !alreadyShown,
      ...(toExternal ? { frame: true, suspended: false } : {}),
    }))
    if (!toExternal) return proxy.stop(tab.id)
    if (alreadyShown) return
    if (nativeStep) return delta < 0 ? proxy.back(tab.id) : proxy.forward(tab.id)
    if (proxy.hasFrame(tab.id)) proxy.go(tab.id, to)
  }
})

// ---- wiring ----------------------------------------------------------------------------

let saveTimer: number | null = null
useTabs.subscribe((state) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => writeSession(state), 400)
})
window.addEventListener('pagehide', () => writeSession(useTabs.getState()))

export const useActiveTab = () => useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0])
