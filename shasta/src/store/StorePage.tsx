import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CloudOff, Compass, LayoutGrid, Search, Send, ShieldCheck, Store, UserRound, Wrench, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'
import { AdSlot } from '@/components/ads/AdSlot'
import { useTabs } from '@/stores/tabsStore'
import { internalUrl } from '@/lib/url'
import { useDebounced, useApi, useStoreBoot } from './hooks'
import { NavProvider, appPath, useStoreNav } from './nav'
import { AppIcon, Message } from './components'
import { useStore } from './storeStore'
import type { AppCard, Suggestions } from './types'
import { SupporterBadge } from '@/components/SupporterBadge'
import { FULL_SITE, LITE } from '@/lib/edition'
import { useSeasonLook } from '@/lib/seasonal'
import { THEMES } from '@/components/seasonal/Season'

const StoreHome = lazy(() => import('./StoreHome'))
const StoreSearch = lazy(() => import('./StoreSearch'))
const AppDetails = lazy(() => import('./AppDetails'))
const AccountPanel = lazy(() => import('./AccountPanel'))
const ApplyPage = lazy(() => import('./ApplyPage'))
const DeveloperDashboard = lazy(() => import('./DeveloperDashboard'))
const AdminDashboard = lazy(() => import('./AdminDashboard'))
const Storefront = lazy(() => import('./StorefrontPage').then((m) => ({ default: m.Storefront })))
const StoresDirectory = lazy(() => import('./StorefrontPage').then((m) => ({ default: m.StoresDirectory })))

// ---- search box with instant suggestions -----------------------------------------------------------------

function SearchBox() {
  const { go, route } = useStoreNav()
  const [text, setText] = useState(route.segments[0] === 'search' ? (route.query.get('q') ?? '') : '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const q = useDebounced(text.trim(), 120)
  const { data } = useApi<Suggestions>(open && q ? `/api/catalog/suggest?q=${encodeURIComponent(q)}` : null, { live: false })

  // keep the box in sync when the route changes (back/forward, clicking a category)
  const routeQuery = route.segments[0] === 'search' ? (route.query.get('q') ?? '') : ''
  useEffect(() => {
    setText(routeQuery)
  }, [routeQuery])
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  type Row = { key: string; label: string; sub?: string; app?: AppCard; run: () => void }
  const rows = useMemo<Row[]>(() => {
    if (!data || !q) return []
    return [
      ...data.apps.map((a) => ({ key: a.id, label: a.name, sub: [a.developer, a.category?.name].filter(Boolean).join(' · '), app: a, run: () => go(appPath(a.slug)) })),
      ...(data.genres ?? []).map((g) => ({ key: `g-${g.id}`, label: g.name, sub: 'isGame' in g && g.isGame === false ? 'Topic' : 'Genre', run: () => go(`/search?genre=${g.id}`) })),
      ...data.categories.filter((c) => !(data.genres?.length && c.name === 'Games')).map((c) => ({ key: `c-${c.id}`, label: c.name, sub: 'Category', run: () => go(`/search?category=${c.id}`) })),
      ...data.developers.map((d) => ({ key: `d-${d}`, label: d, sub: 'Developer', run: () => go(`/search?q=${encodeURIComponent(d)}`) })),
    ]
  }, [data, q, go])

  const submit = () => {
    setOpen(false)
    if (text.trim()) go(`/search?q=${encodeURIComponent(text.trim())}`)
  }

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (active >= 0 && rows[active]) (setOpen(false), rows[active].run())
          else submit()
        }}
        className="flex h-10 items-center gap-2 rounded-[10px] bg-shasta-field px-3 ring-1 ring-shasta-line transition-shadow duration-150 ease-shasta focus-within:ring-2 focus-within:ring-shasta-accent/60"
      >
        <Search className="size-4 shrink-0 text-shasta-muted" aria-hidden />
        <input
          aria-label="Search games and apps"
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-controls="store-suggest"
          value={text}
          onChange={(e) => (setText(e.target.value), setOpen(true), setActive(-1))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, rows.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, -1)))
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search games and apps"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-shasta-faint"
        />
        {text && (
          <button type="button" aria-label="Clear search" onClick={() => (setText(''), setOpen(false))} className="rounded-full p-0.5 text-shasta-muted hover:text-shasta-fg">
            <X className="size-4" />
          </button>
        )}
      </form>
      {open && q && (
        <ul id="store-suggest" role="listbox" className="absolute inset-x-0 top-12 z-30 overflow-hidden rounded-xl bg-popover p-1 shadow-xl ring-1 ring-shasta-line">
          {rows.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => (setOpen(false), r.run())}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm', i === active && 'bg-shasta-hover')}
              >
                {r.app ? <AppIcon app={r.app} size={32} /> : <Search className="size-4 text-shasta-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.label}</span>
                  {r.sub && <span className="block truncate text-xs text-shasta-faint">{r.sub}</span>}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={submit} className="w-full rounded-lg px-3 py-2 text-left text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
              {rows.length ? 'See all results for' : 'Search for'} “{text.trim()}”
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

// ---- sidebar ------------------------------------------------------------------------------------------------

function NavItem({ path, icon, label, badge, current }: { path: string; icon: ReactNode; label: string; badge?: number; current: boolean }) {
  const { go } = useStoreNav()
  return (
    <button
      onClick={() => go(path)}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm transition-[color,background-color,box-shadow] duration-150 ease-shasta md:w-full',
        current ? 'sh-selected' : 'text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg',
      )}
    >
      <span className={cn('grid w-[18px] place-items-center [&>svg]:size-[18px]', current ? 'text-shasta-fg' : 'text-shasta-faint')}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {!!badge && <span className="sh-meta text-shasta-muted">{badge}</span>}
    </button>
  )
}

function Sidebar() {
  const { route } = useStoreNav()
  const user = useStore((s) => s.user)
  const queue = useApi<{ items: unknown[] }>(user?.role === 'owner' ? '/api/admin/queue' : null)
  const seg = route.segments[0] ?? ''
  const { go } = useStoreNav()

  return (
    <nav aria-label="Store" className="flex shrink-0 gap-1 overflow-x-auto border-b border-shasta-line p-2 md:w-60 md:flex-col md:gap-0.5 md:overflow-visible md:border-r md:border-b-0 md:p-3">
      <button onClick={() => go('/')} className="hidden h-9 items-center gap-2.5 px-3 mb-4 md:flex" aria-label="Store home">
        <Logo className="size-[18px] text-shasta-fg" />
        <span className="text-base font-medium">Store</span>
      </button>
      <NavItem path="/" icon={<Compass />} label="Discover" current={seg === ''} />
      <NavItem path="/search" icon={<LayoutGrid />} label="Explore" current={seg === 'search'} />
      <NavItem path="/stores" icon={<Store />} label="Storefronts" current={seg === 'stores' || seg === 'storefront'} />
      {user?.role === 'contributor' || user?.role === 'owner' ? <NavItem path="/develop" icon={<Wrench />} label="Develop" current={seg === 'develop'} /> : <NavItem path="/apply" icon={<Send />} label="Publish" current={seg === 'apply'} />}
      {user?.role === 'owner' && <NavItem path="/admin" icon={<ShieldCheck />} label="Manage" badge={queue.data?.items.length} current={seg === 'admin'} />}
      <div className="hidden flex-1 md:block" />
      <NavItem path="/account" icon={<UserRound />} label={user ? user.displayName : 'Account'} current={seg === 'account'} />
    </nav>
  )
}

// ---- shell ---------------------------------------------------------------------------------------------------

/** The Library is its own page now (shasta://library). Old links into the Store's /library land there. */
function LibraryRedirect() {
  const { tabId } = useStoreNav()
  useEffect(() => {
    useTabs.getState().navigateTo(tabId, internalUrl('library'))
  }, [tabId])
  return null
}

function Routes() {
  const { route } = useStoreNav()
  const [a, b] = route.segments
  switch (a) {
    case undefined:
      return <StoreHome />
    case 'search':
      return <StoreSearch />
    case 'app':
      return <AppDetails slug={b ?? ''} />
    case 'storefront':
      return <Storefront key={b} slug={b ?? ''} />
    case 'stores':
      return <StoresDirectory />
    case 'library':
      return <LibraryRedirect />
    case 'account':
      return <AccountPanel />
    case 'apply':
      return <ApplyPage />
    case 'develop':
      return <DeveloperDashboard />
    case 'admin':
      return <AdminDashboard />
    default:
      return <Message title="That page doesn't exist" body="Use the sidebar to find what you're looking for." />
  }
}

export function StorePage({ tabId, url }: { tabId: string; url: string }) {
  useStoreBoot()
  const offline = useStore((s) => s.offline)
  const noBackend = useStore((s) => s.noBackend)
  const season = useSeasonLook()
  const scroller = useRef<HTMLDivElement>(null)
  // each Store page starts at the top
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [url])
  useEffect(() => {
    // fall back to a plain title; pages with more to say (an app's listing) overwrite it
    useTabs.getState().setInternalTitle(tabId, 'Shasta Store')
  }, [tabId, url])

  return (
    <NavProvider tabId={tabId} url={url}>
      <div className={cn('flex h-full flex-col text-shasta-fg md:flex-row', season && 'sh-theme')} style={season ? ({ '--sh-hue': THEMES[season.event.theme].hue } as React.CSSProperties) : undefined}>
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-4 px-5 py-3 md:px-8">
            <SearchBox />
            {season && <span className="hidden text-sm text-shasta-faint sm:block">{season.greeting}</span>}
            <SupporterBadge />
          </header>
          {offline && (
            <div role="alert" className="mx-5 mb-2 flex items-center gap-2 rounded-lg bg-shasta-warn/10 px-4 py-2 text-sm text-shasta-warn md:mx-8">
              <CloudOff className="size-4 shrink-0" /> {noBackend && LITE ? `The Store is on the full Shasta: ${FULL_SITE}` : noBackend ? "The Store isn't connected in this development build yet. Your library on this device still works." : "The Store server can't be reached. Browsing and your installed apps may be unavailable until you're back online."}
            </div>
          )}
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 md:px-8">
            <Suspense fallback={<p className="py-10 text-center text-sm text-shasta-faint">Loading…</p>}>
              <Routes />
            </Suspense>
            <AdSlot format="native" className="mx-auto mt-8 max-w-3xl pb-4" minHeight={120} />
          </div>
        </div>
      </div>
    </NavProvider>
  )
}
