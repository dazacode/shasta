// A tiny key-value store in its own IndexedDB database, `shasta-social` (store `kv`): the session token and the live
// socket's resume point. Separate from IndexedDB `shasta` on purpose: "erase library" and profile imports never touch
// it, and signing out clears it without touching anything else. Falls back to memory where IndexedDB is missing
// (tests, some private windows): signed in for this visit only.

const DB = 'shasta-social'
const STORE = 'kv'
const memory = new Map<string, unknown>()
let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'))
  })
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await open()
    const v = await wrap(db.transaction(STORE).objectStore(STORE).get(key))
    return (v ?? null) as T | null
  } catch {
    return (memory.get(key) as T | undefined) ?? null
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value)
  try {
    const db = await open()
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    if (value === null || value === undefined) await wrap(store.delete(key))
    else await wrap(store.put(value, key))
  } catch {
    /* memory only */
  }
  if (value === null || value === undefined) memory.delete(key)
}
