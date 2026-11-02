import { create } from 'zustand'
import { openLiveSocket, type LiveSocket } from '@/lib/liveSocket'
import { api, ApiError, errorMessage } from './api'
import type { AppCard, CatalogEvent, Library, StoreUser, RuntimeTarget } from './types'
import {
  composeLibrary,
  deleteFolderRow,
  deleteInstall,
  emptyLocal,
  loadLocal,
  mergeLocal,
  replaceLocal,
  saveFavorite,
  saveFolder,
  saveFollow,
  saveInstall,
  type LocalInstall,
  type LocalLibrary,
  type Resolved,
} from './localLibrary'
import { registerAppLauncher, useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { useGameControls } from '@/stores/gameControlsStore'
import { noteTaste } from './tasteStore'
import type { TabApp } from '@/lib/tabModel'

interface StoreState {
  booted: boolean
  /**
   * Store STAFF only (owner, approved contributors, or someone holding an Account ID). Ordinary visitors never have one:
   * their library is `local`, on this device.
   */
  user: StoreUser | null
  /** what this device holds; null until IndexedDB has been read */
  local: LocalLibrary | null
  /** the server could not be reached at all (no Store backend, or offline) */
  offline: boolean
  /** this deployment has no Store server at all yet (a frontend-only development deployment) */
  noBackend: boolean
  library: Library | null
  libraryError: string | null
  /** bumped whenever the catalog changes on the server; lists refetch when it moves */
  catalogVersion: number
  /** the "Top 10 right now" ranking pushed by the server since /home was fetched (null = use /home's) */
  liveTrending: AppCard[] | null
  /** a staff account's recovery key, shown once */
  pendingRecoveryKey: string | null
  busy: Record<string, boolean>

  boot: () => Promise<void>
  /** staff sign-in only: a visitor never needs this to browse, install, favorite or follow */
  setUser: (u: StoreUser | null) => void
  /** rewrites the whole on-device library (profile import, reset) */
  replaceLibrary: (data: LocalLibrary) => Promise<void>
  /** copies what a signed-in older account held onto this device, once */
  importLegacy: () => Promise<void>
  setPinned: (appId: string, pinned: boolean) => Promise<void>
  moveToFolder: (appId: string, folderId: string | null) => Promise<void>
  createFolder: (name: string) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  dismissRecoveryKey: () => void
  refreshLibrary: () => Promise<void>

  install: (app: AppCard) => Promise<boolean>
  uninstall: (appId: string, opts?: { clearData?: boolean }) => Promise<void>
  update: (appId: string) => Promise<void>
  /**
   * Asks how to run an installed app, for the version this device is on. If that version was retired the Store hands
   * back the latest and this records the move (and says so), so the install always matches what actually runs.
   */
  fetchLaunch: (appKey: string) => Promise<RuntimeTarget>
  launch: (appId: string, path?: string) => Promise<void>
  /** app://name or game://name typed in the address bar */
  launchAddress: (addr: { slug: string; path: string }) => Promise<void>
  setFavorite: (appId: string, on: boolean) => Promise<void>
  follow: (store: { id: string; name: string }, on: boolean) => Promise<void>
  signOut: () => Promise<void>
}

let events: LiveSocket | null = null
let refreshTimer: ReturnType<typeof setTimeout> | undefined

const toast = (message: string, opts?: Parameters<ReturnType<typeof useUi.getState>['toast']>[1]) => useUi.getState().toast(message, opts)

// many events can arrive together (an approval touches several lists): refetch once
function refetchSoon() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    useStore.setState((s) => ({ catalogVersion: s.catalogVersion + 1, liveTrending: null }))
    void useStore.getState().refreshLibrary()
  }, 250)
}

function startEvents() {
  if (events) return
  let opened = false
  events = openLiveSocket(
    '/api/events/ws',
    (data) => {
      let ev: CatalogEvent
      try {
        ev = JSON.parse(data)
      } catch {
        return
      }
      const st = useStore.getState()
      // the live ranking moves on every install/launch: swap it in, never refetch the whole Store for it
      if (ev.type === 'trending') {
        if (Array.isArray(ev.apps)) useStore.setState({ liveTrending: ev.apps })
        return
      }
      refetchSoon()
      if (ev.type === 'app-published' && ev.name && ev.storeId && st.library?.following.some((f) => f.id === ev.storeId)) {
        const from = st.library.following.find((f) => f.id === ev.storeId)!.name
        toast(`New from ${from}: ${ev.name}.`, { action: { label: 'View', run: () => useTabs.getState().openInternal('store', `/app/${encodeURIComponent(ev.slug ?? '')}`) } })
      }
      const mine = st.library?.installed.find((i) => i.app.id === ev.appId)
      if (!mine || !ev.name) return
      if (ev.type === 'app-updated') toast(`${ev.name} has a new version${ev.version ? ` (${ev.version})` : ''}.`, { action: { label: 'See what’s new', run: () => useTabs.getState().openInternal('store', `/app/${encodeURIComponent(mine.app.slug)}`) } })
      else if (ev.type === 'app-unpublished' || ev.type === 'app-removed') toast(`${ev.name} is no longer available in the Store.`, { tone: 'error' })
    },
    (up) => {
      // back after a drop: whatever changed meanwhile was missed, so refetch
      if (up && opened) refetchSoon()
      if (up) opened = true
    },
  )
}

export const useStore = create<StoreState>()((set, get) => ({
  booted: false,
  user: null,
  local: null,
  offline: false,
  noBackend: false,
  library: null,
  libraryError: null,
  catalogVersion: 0,
  liveTrending: null,
  pendingRecoveryKey: null,
  busy: {},

  boot: async () => {
    if (get().booted) return
    set({ booted: true })
    // the library is on this device: it loads even when the Store server is unreachable
    const local = await loadLocal()
    set({ local })
    try {
      const { user } = await api.get<{ user: StoreUser | null }>('/api/auth/me')
      set({ user, offline: false })
      startEvents()
      if (user) await get().importLegacy()
    } catch (e) {
      // no backend (static hosting) or offline: the Store pages show their own message; the browser keeps working
      set({ offline: e instanceof ApiError && e.offline ? true : get().offline, noBackend: e instanceof ApiError && e.noBackend, booted: false })
      return
    }
    await get().refreshLibrary()
  },

  setUser: (user) => set({ user }),

  dismissRecoveryKey: () => set({ pendingRecoveryKey: null }),

  replaceLibrary: async (data) => {
    await replaceLocal(data)
    set({ local: data })
    await get().refreshLibrary()
  },

  importLegacy: async () => {
    // earlier builds kept the library in a server-side anonymous account; copy it onto the device once, then leave it
    if (readFlag(LEGACY_FLAG)) return
    try {
      const old = await api.get<{ installs: (Omit<LocalInstall, 'pinned'> & { pinned: number })[]; favorites: string[]; folders: { id: string; name: string }[]; following: string[] }>('/api/auth/legacy-library')
      const incoming: LocalLibrary = {
        installs: old.installs.map((i) => ({ ...i, pinned: !!i.pinned })),
        favorites: old.favorites,
        folders: old.folders.map((f) => ({ ...f, createdAt: Date.now() })),
        following: old.following,
      }
      const merged = mergeLocal(get().local ?? emptyLocal(), incoming)
      await replaceLocal(merged)
      set({ local: merged })
      setFlag(LEGACY_FLAG)
    } catch {
      /* not signed in, offline, or an older server: try again next visit */
    }
  },

  /** Rebuilds the on-screen library from the device's list plus what the server says about those ids. */
  refreshLibrary: async () => {
    const local = get().local ?? (await loadLocal())
    if (!get().local) set({ local })
    if (!local.installs.length && !local.favorites.length && !local.following.length) {
      set({ library: composeLibrary(local, { installed: [], favorites: [], following: [] }), libraryError: null })
      return
    }
    try {
      const resolved = await api.post<Resolved>('/api/library/resolve', {
        installs: local.installs.map((i) => ({ appId: i.appId, version: i.installedVersion })),
        favorites: local.favorites,
        following: local.following,
      })
      // the device may have changed while we waited
      set({ library: composeLibrary(get().local ?? local, resolved), libraryError: null, offline: false })
    } catch (e) {
      set({ libraryError: errorMessage(e) })
    }
  },

  install: async (app) => {
    if (get().busy[app.id]) return false
    set((s) => ({ busy: { ...s.busy, [app.id]: true } }))
    try {
      const local = get().local ?? (await loadLocal())
      if (local.installs.some((i) => i.appId === app.id)) return true
      // also proves the app can be installed right now (a taken-down app answers 404/409)
      const info = await api.get<RuntimeTarget>(`/api/apps/${encodeURIComponent(app.id)}/launch`)
      const entry: LocalInstall = { appId: app.id, installedVersion: info.version, installedAt: Date.now(), lastLaunchedAt: null, launchCount: 0, pinned: false, folderId: null }
      await saveInstall(entry)
      set({ local: { ...local, installs: [...local.installs, entry] } })
      signal('install', app.id)
      noteTaste(app, 'install')
      await get().refreshLibrary()
      toast(`${app.name} is installed on this device. Find it in your Library.`, { tone: 'success', action: { label: 'Open', run: () => void get().launch(app.id) } })
      return true
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' })
      return false
    } finally {
      set((s) => ({ busy: { ...s.busy, [app.id]: false } }))
    }
  },

  uninstall: async (appId, { clearData = false } = {}) => {
    const item = get().library?.installed.find((i) => i.app.id === appId)
    try {
      await deleteInstall(appId)
      patchLocal(set, get, (l) => ({ ...l, installs: l.installs.filter((i) => i.appId !== appId) }))
      signal('uninstall', appId)
      if (item) noteTaste(item.app, 'uninstall')
      // close the app's tab, then (optionally) wipe what it saved on its own origin
      const tabs = useTabs.getState()
      for (const t of tabs.tabs) if (t.app?.id === appId) tabs.closeTab(t.id)
      let cleared: boolean | null = null
      if (clearData && item) {
        cleared = await clearAppData(item.clearDataUrl)
        // a kept older version keeps its saves on an origin of its own
        if (item.stayClearDataUrl && !(await clearAppData(item.stayClearDataUrl))) cleared = false
      }
      await get().refreshLibrary()
      toast(`${item?.app.name ?? 'The app'} was removed from your library${cleared === true ? ' and its saved data was cleared' : cleared === false ? '. Its saved data could not be cleared automatically' : ''}.`)
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' })
    }
  },

  update: async (appId) => {
    try {
      const info = await api.get<RuntimeTarget>(`/api/apps/${encodeURIComponent(appId)}/launch`)
      await changeInstall(set, get, appId, (i) => ({ ...i, installedVersion: info.version }))
      signal('update', appId)
      await get().refreshLibrary()
      toast(`Updated to version ${info.version}.`, { tone: 'success' })
      // an app that is already open picks the new files up on reload
      useUi.getState().bumpAppReload(appId)
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' })
    }
  },

  fetchLaunch: async (appKey) => {
    const local = get().local ?? (await loadLocal())
    const known = get().library?.installed.find((i) => i.app.id === appKey || i.app.slug === appKey)
    const have = local.installs.find((i) => i.appId === (known?.app.id ?? appKey))?.installedVersion
    const r = await api.get<RuntimeTarget>(`/api/apps/${encodeURIComponent(appKey)}/launch${have ? `?version=${encodeURIComponent(have)}` : ''}`)
    // the owner's curated controls (two-player layouts): every launch path comes through here
    useGameControls.getState().setHint(r.slug, r.controls ?? null)
    const mine = (get().local ?? local).installs.find((i) => i.appId === r.id)
    if (mine && mine.installedVersion !== r.version) {
      await changeInstall(set, get, r.id, (i) => ({ ...i, installedVersion: r.version }))
      if (r.movedUp) {
        toast(`${r.name} was updated to ${r.version}. Version ${mine.installedVersion} is no longer available from its developer.`, {
          action: { label: 'What’s new', run: () => useTabs.getState().openInternal('store', `/app/${encodeURIComponent(r.slug)}`) },
        })
        signal('update', r.id)
      }
      void get().refreshLibrary()
    }
    return r
  },

  launch: async (appId, path) => {
    try {
      const r = await get().fetchLaunch(appId)
      await changeInstall(set, get, appId, (i) => ({ ...i, lastLaunchedAt: Date.now(), launchCount: i.launchCount + 1 }))
      signal('launch', appId)
      // everything the tab needs is also known from the library, so an older or slower server cannot break opening an app
      const card = get().library?.installed.find((i) => i.app.id === appId)?.app
      if (card) noteTaste(card, 'launch')
      const kind = r.kind ?? r.target.kind
      const app: TabApp = {
        id: appId,
        slug: r.slug ?? card?.slug ?? appId,
        scheme: r.scheme ?? (card?.category?.isGame ? 'game' : 'app'),
        name: r.name || card?.name || 'App',
        iconUrl: r.iconUrl ?? card?.iconUrl ?? null,
        kind,
        home: kind === 'linked' ? r.target.url : '',
      }
      // a path in the address (app://discord/channels/1) is resolved against the web app's own site
      let url = r.target.url
      if (path && kind === 'linked') {
        try {
          const u = new URL(path, r.target.url)
          if (u.origin === new URL(r.target.url).origin) url = u.href
        } catch {
          /* keep the start address */
        }
      }
      useTabs.getState().openApp(app, url)
      void get().refreshLibrary()
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' })
      void get().refreshLibrary()
    }
  },

  launchAddress: async ({ slug, path }) => {
    await get().boot()
    if (!get().library) await get().refreshLibrary()
    const item = get().library?.installed.find((i) => i.app.slug === slug)
    if (item) return get().launch(item.app.id, path)
    toast(`“${slug}” isn't installed on this device.`, {
      tone: 'error',
      action: { label: 'Find it in the Store', run: () => useTabs.getState().openInternal('store', `/app/${encodeURIComponent(slug)}`) },
    })
  },

  setFavorite: async (appId, on) => {
    const local = get().local ?? (await loadLocal())
    if (on === local.favorites.includes(appId)) return
    await saveFavorite(appId, on)
    set({ local: { ...local, favorites: on ? [appId, ...local.favorites] : local.favorites.filter((f) => f !== appId) } })
    await get().refreshLibrary()
  },

  follow: async (store, on) => {
    const local = get().local ?? (await loadLocal())
    if (on === local.following.includes(store.id)) return
    await saveFollow(store.id, on)
    set({ local: { ...local, following: on ? [store.id, ...local.following] : local.following.filter((f) => f !== store.id) } })
    signal(on ? 'follow' : 'unfollow', store.id)
    await get().refreshLibrary()
    useStore.setState((s) => ({ catalogVersion: s.catalogVersion + 1 }))
    toast(on ? `You'll see new releases from ${store.name} in the Store.` : `Unfollowed ${store.name}.`, { tone: on ? 'success' : 'info' })
  },

  setPinned: async (appId, pinned) => {
    await changeInstall(set, get, appId, (i) => ({ ...i, pinned }))
    await get().refreshLibrary()
  },

  moveToFolder: async (appId, folderId) => {
    await changeInstall(set, get, appId, (i) => ({ ...i, folderId }))
    await get().refreshLibrary()
  },

  createFolder: async (name) => {
    const n = name.trim().slice(0, 40)
    const local = get().local ?? (await loadLocal())
    if (!n || local.folders.length >= 50) throw new Error(local.folders.length >= 50 ? 'You can have at most 50 folders.' : 'Folder names are 1-40 characters.')
    const folder = { id: crypto.randomUUID(), name: n, createdAt: Date.now() }
    await saveFolder(folder)
    set({ local: { ...local, folders: [...local.folders, folder].sort((a, b) => a.name.localeCompare(b.name)) } })
    await get().refreshLibrary()
  },

  renameFolder: async (id, name) => {
    const n = name.trim().slice(0, 40)
    const local = get().local ?? (await loadLocal())
    const f = local.folders.find((x) => x.id === id)
    if (!f || !n) throw new Error('Folder names are 1-40 characters.')
    const next = { ...f, name: n }
    await saveFolder(next)
    set({ local: { ...local, folders: local.folders.map((x) => (x.id === id ? next : x)).sort((a, b) => a.name.localeCompare(b.name)) } })
    await get().refreshLibrary()
  },

  deleteFolder: async (id) => {
    const local = get().local ?? (await loadLocal())
    await deleteFolderRow(id)
    const installs = local.installs.map((i) => (i.folderId === id ? { ...i, folderId: null } : i))
    for (const i of installs) if (local.installs.find((o) => o.appId === i.appId)?.folderId === id) await saveInstall(i)
    set({ local: { ...local, folders: local.folders.filter((f) => f.id !== id), installs } })
    await get().refreshLibrary()
  },

  signOut: async () => {
    await api.post('/api/auth/logout').catch(() => undefined)
    set({ user: null, pendingRecoveryKey: null })
  },
}))

const LEGACY_FLAG = 'shasta-legacy-library-imported'
const readFlag = (k: string) => {
  try {
    return localStorage.getItem(k) === '1'
  } catch {
    return false
  }
}
const setFlag = (k: string) => {
  try {
    localStorage.setItem(k, '1')
  } catch {
    /* storage blocked */
  }
}

/** Anonymous popularity tally. Fire and forget: no identifier is sent, and failing changes nothing for the visitor. */
function signal(kind: 'install' | 'uninstall' | 'launch' | 'update' | 'follow' | 'unfollow', id: string) {
  void api.post('/api/signals', { kind, id }).catch(() => undefined)
}

type Setter = (partial: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>)) => void
type Getter = () => StoreState

function patchLocal(set: Setter, get: Getter, fn: (l: LocalLibrary) => LocalLibrary) {
  const l = get().local
  if (l) set({ local: fn(l) })
}

/** Updates one install row on the device and in memory. */
async function changeInstall(set: Setter, get: Getter, appId: string, fn: (i: LocalInstall) => LocalInstall) {
  const local = get().local ?? (await loadLocal())
  const cur = local.installs.find((i) => i.appId === appId)
  if (!cur) return
  const next = fn(cur)
  await saveInstall(next)
  set({ local: { ...local, installs: local.installs.map((i) => (i.appId === appId ? next : i)) } })
}

/**
 * Loads the app's own origin in a hidden frame that wipes its storage. The Shasta page cannot reach another origin's
 * storage, so the app's origin does it for itself. Resolves true when the frame confirmed, false on timeout.
 */
function clearAppData(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    let timer: ReturnType<typeof setTimeout>
    const done = (ok: boolean) => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      frame.remove()
      resolve(ok)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source === frame.contentWindow && (e.data as { type?: string })?.type === 'shasta-data-cleared') done(true)
    }
    window.addEventListener('message', onMessage)
    timer = setTimeout(() => done(false), 8000)
    frame.src = url
    document.body.appendChild(frame)
  })
}

export const installedMap = (lib: Library | null) => new Map((lib?.installed ?? []).map((i) => [i.app.id, i]))

registerAppLauncher((addr) => void useStore.getState().launchAddress(addr))
