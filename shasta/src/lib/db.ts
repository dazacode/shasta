// Small promise wrapper over IndexedDB. Structured, unbounded data (history, bookmarks,
// downloads, favicons) lives here; small synchronous state (settings, session) stays in localStorage.

export const DB_NAME = 'shasta'
export const DB_VERSION = 4

export type StoreName = 'history' | 'bookmarks' | 'downloads' | 'favicons' | 'installs' | 'appFavorites' | 'appFolders' | 'follows' | 'media'

type Migration = (db: IDBDatabase, tx: IDBTransaction) => void

// Each entry upgrades from (index) to (index + 1). Never edit a shipped migration; append a new one.
const MIGRATIONS: Migration[] = [
  (db) => {
    const history = db.createObjectStore('history', { keyPath: 'id' })
    history.createIndex('visitedAt', 'visitedAt')
    history.createIndex('url', 'url')
    db.createObjectStore('bookmarks', { keyPath: 'id' })
  },
  (db) => {
    db.createObjectStore('downloads', { keyPath: 'id' })
    db.createObjectStore('favicons', { keyPath: 'origin' })
  },
  // the Store library lives on the device: no account is needed to install, favorite or follow
  (db) => {
    db.createObjectStore('installs', { keyPath: 'appId' })
    db.createObjectStore('appFavorites', { keyPath: 'appId' })
    db.createObjectStore('appFolders', { keyPath: 'id' })
    db.createObjectStore('follows', { keyPath: 'id' })
  },
  // pictures the person picked for themselves (new tab background); they never leave the device
  (db) => {
    db.createObjectStore('media', { keyPath: 'id' })
  },
]

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable'))
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const tx = req.transaction!
        for (let v = e.oldVersion; v < (e.newVersion ?? DB_VERSION); v++) MIGRATIONS[v](req.result, tx)
      }
      req.onsuccess = () => {
        const db = req.result
        // another tab upgrading the schema, or a "clear site data": drop the handle and reopen on next use
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        db.onclose = () => (dbPromise = null)
        resolve(db)
      }
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
      req.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another Shasta tab'))
    })
    dbPromise.catch(() => (dbPromise = null))
  }
  return dbPromise
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
    tx.onerror = () => reject(tx.error)
  })

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb()
  return wrap<T[]>(db.transaction(store).objectStore(store).getAll())
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb()
  return wrap<T | undefined>(db.transaction(store).objectStore(store).get(key))
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value)
  await done(tx)
}

export async function putMany<T>(store: StoreName, values: T[]): Promise<void> {
  if (!values.length) return
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  const os = tx.objectStore(store)
  for (const v of values) os.put(v)
  await done(tx)
}

export async function remove(store: StoreName, ...keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  const os = tx.objectStore(store)
  for (const k of keys) os.delete(k)
  await done(tx)
}

export async function clear(...stores: StoreName[]): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(stores, 'readwrite')
  for (const s of stores) tx.objectStore(s).clear()
  await done(tx)
}

/** Deletes the whole database (used by "reset Shasta"). */
export async function deleteDb(): Promise<void> {
  if (dbPromise) {
    try {
      ;(await dbPromise).close()
    } catch {
      /* ignore */
    }
    dbPromise = null
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
