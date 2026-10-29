// The visitor's Store library: installed apps, favorites, folders and followed storefronts. It lives in this browser's
// IndexedDB and is never sent anywhere as a whole. The server is only asked to describe the ids this file holds
// (POST /api/library/resolve) and receives anonymous tallies; it never learns what a particular device has installed.
import { clear, getAll, put, putMany, remove } from '@/lib/db'
import type { InstalledApp, Library } from './types'

export interface LocalInstall {
  appId: string
  installedVersion: string
  installedAt: number
  lastLaunchedAt: number | null
  launchCount: number
  pinned: boolean
  folderId: string | null
}
export interface LocalFolder {
  id: string
  name: string
  createdAt: number
}
export interface LocalLibrary {
  installs: LocalInstall[]
  favorites: string[]
  folders: LocalFolder[]
  following: string[]
}

export const emptyLocal = (): LocalLibrary => ({ installs: [], favorites: [], folders: [], following: [] })

export async function loadLocal(): Promise<LocalLibrary> {
  try {
    const [installs, favs, folders, follows] = await Promise.all([
      getAll<LocalInstall>('installs'),
      getAll<{ appId: string; createdAt: number }>('appFavorites'),
      getAll<LocalFolder>('appFolders'),
      getAll<{ id: string; followedAt: number }>('follows'),
    ])
    return {
      installs,
      favorites: favs.sort((a, b) => b.createdAt - a.createdAt).map((f) => f.appId),
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      following: follows.sort((a, b) => b.followedAt - a.followedAt).map((f) => f.id),
    }
  } catch {
    // IndexedDB blocked (some private windows, storage disabled): the Store still works for this visit, it just cannot remember
    return emptyLocal()
  }
}

/** Writes never throw: a browser that refuses storage should degrade to "not remembered", not break installing. */
const safe = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch {
    /* storage unavailable */
  }
}

export const saveInstall = (i: LocalInstall) => safe(() => put('installs', i))
export const deleteInstall = (appId: string) => safe(() => remove('installs', appId))
export const saveFavorite = (appId: string, on: boolean) => safe(() => (on ? put('appFavorites', { appId, createdAt: Date.now() }) : remove('appFavorites', appId)))
export const saveFolder = (f: LocalFolder) => safe(() => put('appFolders', f))
export const deleteFolderRow = (id: string) => safe(() => remove('appFolders', id))
export const saveFollow = (id: string, on: boolean) => safe(() => (on ? put('follows', { id, followedAt: Date.now() }) : remove('follows', id)))

/** Replaces everything (profile import, "erase library"). */
export async function replaceLocal(data: LocalLibrary): Promise<void> {
  await safe(async () => {
    await clear('installs', 'appFavorites', 'appFolders', 'follows')
    await putMany('installs', data.installs)
    await putMany('appFavorites', data.favorites.map((appId, i) => ({ appId, createdAt: Date.now() - i })))
    await putMany('appFolders', data.folders)
    await putMany('follows', data.following.map((id, i) => ({ id, followedAt: Date.now() - i })))
  })
}

/** What the server says about the ids we hold. */
export interface Resolved {
  installed: Omit<InstalledApp, 'installedVersion' | 'installedAt' | 'lastLaunchedAt' | 'launchCount' | 'pinned' | 'folderId'>[]
  favorites: Library['favorites']
  following: Library['following']
}

/** Joins what this device holds with what the server knows about those apps into the shape the screens use. */
export function composeLibrary(local: LocalLibrary, resolved: Resolved): Library {
  const mine = new Map(local.installs.map((i) => [i.appId, i]))
  const installed: InstalledApp[] = []
  for (const r of resolved.installed) {
    const l = mine.get(r.app.id)
    if (!l) continue
    installed.push({ ...r, installedVersion: l.installedVersion, installedAt: l.installedAt, lastLaunchedAt: l.lastLaunchedAt, launchCount: l.launchCount, pinned: l.pinned, folderId: l.folderId })
  }
  // keep the order the device holds them in (favorites and follows are already newest first)
  const order = new Map(local.favorites.map((id, i) => [id, i]))
  const folderIds = new Set(local.folders.map((f) => f.id))
  return {
    installed: installed.map((i) => (i.folderId && !folderIds.has(i.folderId) ? { ...i, folderId: null } : i)),
    favorites: [...resolved.favorites].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    folders: local.folders.map((f) => ({ id: f.id, name: f.name })),
    following: resolved.following,
  }
}

/** Adds what `incoming` holds to `base` without overwriting anything the device already has (used by imports). */
export function mergeLocal(base: LocalLibrary, incoming: LocalLibrary): LocalLibrary {
  const have = new Set(base.installs.map((i) => i.appId))
  const folderIds = new Set(base.folders.map((f) => f.id))
  const folders = [...base.folders, ...incoming.folders.filter((f) => !folderIds.has(f.id))]
  const known = new Set(folders.map((f) => f.id))
  return {
    installs: [...base.installs, ...incoming.installs.filter((i) => !have.has(i.appId)).map((i) => ({ ...i, folderId: i.folderId && known.has(i.folderId) ? i.folderId : null }))],
    favorites: [...new Set([...base.favorites, ...incoming.favorites])],
    folders,
    following: [...new Set([...base.following, ...incoming.following])],
  }
}

// ---- profile export: the installed-app manifest -------------------------------------------------------------

export interface AppManifest {
  appId: string
  version: string
  pinned: boolean
  folderId: string | null
}
export interface LibraryManifest {
  apps: AppManifest[]
  favorites: string[]
  folders: { id: string; name: string }[]
  following: string[]
}

/** Only ids and organisation: no launch counts or times, and nothing the apps themselves saved. */
export function toManifest(l: LocalLibrary): LibraryManifest {
  return {
    apps: l.installs.map((i) => ({ appId: i.appId, version: i.installedVersion, pinned: i.pinned, folderId: i.folderId })),
    favorites: l.favorites,
    folders: l.folders.map((f) => ({ id: f.id, name: f.name })),
    following: l.following,
  }
}

const str = (v: unknown, max = 80) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

/** Validates untrusted manifest JSON. Anything malformed is dropped rather than trusted. */
export function fromManifest(raw: unknown, now = Date.now()): LocalLibrary {
  const m = (raw ?? {}) as Partial<LibraryManifest>
  const folders = (Array.isArray(m.folders) ? m.folders : [])
    .slice(0, 50)
    .map((f) => ({ id: str(f?.id), name: str(f?.name, 40) }))
    .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
    .map((f) => ({ ...f, createdAt: now }))
  const ids = new Set(folders.map((f) => f.id))
  const seen = new Set<string>()
  const installs: LocalInstall[] = []
  for (const a of (Array.isArray(m.apps) ? m.apps : []).slice(0, 500)) {
    const appId = str(a?.appId)
    if (!appId || seen.has(appId)) continue
    seen.add(appId)
    const folderId = str(a?.folderId)
    installs.push({ appId, installedVersion: str(a?.version, 40) ?? '', installedAt: now, lastLaunchedAt: null, launchCount: 0, pinned: a?.pinned === true, folderId: folderId && ids.has(folderId) ? folderId : null })
  }
  const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).slice(0, 500).map((x) => str(x)).filter((x): x is string => !!x))]
  return { installs, favorites: list(m.favorites), folders, following: list(m.following) }
}
