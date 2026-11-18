// Helpers the desktop's friends page (pages/Friends.tsx) and Settings share: one react-query client for the social
// lists (wired to the live socket once), opening a Store app the way the Store does, the device's name, and the
// wording for the "what I'm playing" switch. The components are in parts.tsx.
import { QueryClient } from '@tanstack/react-query'
import type { ShowcaseApp } from '@/social/types'
import { defaultDeviceName } from '@/social/auth'
import { socialOrigin } from '@/social/origin'
import { wireSocialQueries } from '@/social/queries'
import { useSocial } from '@/social/store'
import { useStore } from '@/store/storeStore'

let client: QueryClient | null = null

/** The desktop's one social query client (feed, threads, profiles, devices). */
export function socialQueryClient(): QueryClient {
  if (!client) {
    client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && ![401, 403, 404].includes((e as { status?: number })?.status ?? 0) },
      },
    })
    wireSocialQueries(client)
    // what one account saw is not the next one's to see
    useSocial.subscribe((s, p) => {
      if (p.status === 'ready' && s.status !== 'ready') client?.clear()
    })
  }
  return client
}

/** Store games in posts, messages and profiles open here, through the Store's own launch. */
export const openStoreApp = (app: ShowcaseApp) => void useStore.getState().launch(app.appId)

/** "Chromebook", "Mac", "Windows computer" or "Computer": what the phone and the devices list call this one. */
export const deviceName = () => defaultDeviceName('desktop')

/** "this Chromebook" / "this computer", for the linking copy. */
export function thisDevice(): string {
  const n = deviceName()
  return n === 'Chromebook' || n === 'Mac' ? `this ${n}` : 'this computer'
}

/** The full Shasta site, for an origin where social is off (a shared Lite mirror); null when unknown. */
export function fullSiteAddress(): string | null {
  const configured = socialOrigin()
  try {
    if (configured && new URL(configured).origin !== location.origin) return configured
  } catch {
    /* not an address */
  }
  return null
}

export const PRESENCE_COPY =
  "Friends see the name of the Store game in front, like “Playing Hextris for 20 min”. Never a website, page title or address, and nothing when you're on anything that isn't a Store game. Off by default; only your friends see it, and nothing is kept once you stop."
