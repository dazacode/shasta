import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useTabs } from '@/stores/tabsStore'
import { internalSection, internalUrl } from '@/lib/url'

export interface Route {
  /** "/app/clicker" -> ["app", "clicker"] */
  segments: string[]
  query: URLSearchParams
}

interface Nav {
  tabId: string
  route: Route
  /** navigate inside the Store, e.g. go('/app/clicker') or go('/search?q=cube'). Adds a history entry. */
  go: (path: string) => void
  href: (path: string) => string
}

const Ctx = createContext<Nav | null>(null)

export function parseRoute(url: string): Route {
  const section = internalSection(url)
  const [path, query = ''] = (section || '/').split('?')
  return { segments: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query) }
}

export function NavProvider({ tabId, url, external = false, children }: { tabId: string; url: string; /** the page is not part of the Store: navigating opens (or focuses) the Store tab */ external?: boolean; children: ReactNode }) {
  const navigateTo = useTabs((s) => s.navigateTo)
  const value = useMemo<Nav>(
    () => ({
      tabId,
      route: parseRoute(url),
      go: (path) => (external ? useTabs.getState().openInternal('store', path) : navigateTo(tabId, internalUrl('store', path))),
      href: (path) => internalUrl('store', path),
    }),
    [tabId, url, navigateTo, external],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStoreNav(): Nav {
  const n = useContext(Ctx)
  if (!n) throw new Error('useStoreNav outside the Store')
  return n
}

export const appPath = (slug: string) => `/app/${encodeURIComponent(slug)}`
export const storePath = (slug: string) => `/storefront/${encodeURIComponent(slug)}`
