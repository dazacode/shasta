// Shasta Lite on jsDelivr (`bun run deploy:jsdelivr`) runs on cdn.jsdelivr.net, an origin every npm package and GitHub
// repository on jsDelivr shares: any of their pages can read that origin's localStorage and IndexedDB. So nothing a
// website signs in with may rest there. The engine's storage scope (ScramjetConfig.storageScope, Shasta's Scramjet
// fork) keeps the cookie jar and sites' localStorage in this tab's sessionStorage (another tab, and so another site's
// page, never sees it; a reload keeps it; closing the tab ends it) and prefixes sites' IndexedDB databases with this
// tab's scope, so they are deleted once the tab is gone. Each tab holds a Web Lock named after its scope while it runs;
// at start, the databases of every scope whose lock nobody holds are deleted.
// Off everywhere else: a normal origin is Shasta's alone.
import { SHARED_ORIGIN } from './edition'

const KEY = 'shasta-storage-scope'
const LOCK = 'shasta-storage-scope:'

let scope: string | null | undefined

/** This tab's storage scope on a shared origin, or undefined (normal, persistent storage). */
export function storageScope(): string | undefined {
  if (!SHARED_ORIGIN) return undefined
  if (scope !== undefined) return scope ?? undefined
  try {
    scope = sessionStorage.getItem(KEY)
    if (!scope || !/^[a-z0-9]{8,32}$/.test(scope)) {
      scope = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, '0')).join('')
      sessionStorage.setItem(KEY, scope)
    }
  } catch {
    // no sessionStorage: a scope for this page only (still never written to shared storage)
    scope = Math.random().toString(36).slice(2, 14)
  }
  // held until the tab closes; a duplicated tab shares the scope and waits for the lock, which is fine
  void navigator.locks?.request(LOCK + scope, () => new Promise<void>(() => {})).catch(() => {})
  void sweep(scope)
  return scope
}

/** Deletes the sites' databases of tabs that are closed. */
async function sweep(own: string) {
  try {
    if (!navigator.locks || !indexedDB.databases) return
    const held = new Set(((await navigator.locks.query()).held ?? []).map((l) => l.name))
    for (const db of await indexedDB.databases()) {
      const m = db.name && /^([a-z0-9]{8,32})\|/.exec(db.name)
      if (m && m[1] !== own && !held.has(LOCK + m[1])) indexedDB.deleteDatabase(db.name!)
    }
  } catch {
    /* storage blocked: nothing was kept either */
  }
}
