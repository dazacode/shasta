// The Store library on this phone: what came over from the Chromebook (IndexedDB `shasta`, the same place the full
// Shasta site keeps it), described by the server the way the Store does it (POST /api/library/resolve: ids in, public
// catalogue data out; the server never learns what a particular device has). Shown as games to play on a linked
// Chromebook or to open on the phone.
import { useQuery } from '@tanstack/react-query'
import { api } from '@/store/api'
import { loadLocal, type Resolved } from '@/store/localLibrary'
import type { ShowcaseApp } from '@/social/types'
import { socialOrigin } from '@/social/origin'

export interface PhoneApp extends ShowcaseApp {
  available: boolean
  favorite: boolean
}

export async function loadPhoneLibrary(): Promise<PhoneApp[]> {
  const local = await loadLocal()
  if (!local.installs.length && !local.favorites.length) return []
  const resolved = await api.post<Resolved>('/api/library/resolve', {
    installs: local.installs.map((i) => ({ appId: i.appId, version: i.installedVersion })),
    favorites: local.favorites,
    following: local.following,
  })
  const favs = new Set(local.favorites)
  const seen = new Set<string>()
  const out: PhoneApp[] = []
  for (const r of resolved.installed) {
    if (seen.has(r.app.id)) continue
    seen.add(r.app.id)
    out.push({ appId: r.app.id, name: r.app.name, slug: r.app.slug, scheme: r.address.startsWith('game://') ? 'game' : 'app', iconUrl: r.app.iconUrl, available: r.available, favorite: favs.has(r.app.id) })
  }
  return out.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))
}

export const usePhoneLibrary = () => useQuery({ queryKey: ['me', 'library'], queryFn: loadPhoneLibrary, staleTime: 5 * 60_000 })

/** Opens the app's Store page in the full Shasta site on this phone (`?app=<slug>`, lib/shareLink.ts), where it plays. */
export const openOnPhoneUrl = (app: ShowcaseApp) => `${socialOrigin()}/?app=${encodeURIComponent(app.slug)}`

export function openApp(app: ShowcaseApp) {
  window.open(openOnPhoneUrl(app), '_blank', 'noopener')
}
