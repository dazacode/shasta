import { useEffect, useRef, useState, type ReactNode } from 'react'
import { prefetchApi, useNearViewport, useReducedMotion } from './hooks'
import { Logo } from '@/components/Logo'
import { AlertTriangle, BadgeCheck, Check, ChevronLeft, ChevronRight, CloudOff, Download, Loader2, Play, RefreshCw, Search as SearchIcon, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore, installedMap } from './storeStore'
import { appPath, storePath, useStoreNav } from './nav'
import type { AppCard as AppCardType, AppStatus, StoreCard, StoreRef, VersionState } from './types'
import { MEDIA_CORS } from '@/lib/appApi'
import { appAddress } from '@/lib/url'

// ---- icons ------------------------------------------------------------------------------------

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

/** The app's uploaded icon. Only an app that has none yet (a developer's draft) shows the lettered tile. */
export function AppIcon({ app, size = 56, className, eager }: { app: Pick<AppCardType, 'name' | 'iconUrl'>; size?: number; className?: string; /** above the fold: load at once */ eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  const radius = Math.round(size * 0.22)
  if (app.iconUrl && !failed)
    return <img crossOrigin={MEDIA_CORS} src={app.iconUrl} alt="" width={size} height={size} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: radius }} className={cn('shrink-0 bg-shasta-field object-cover', className)} />
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: radius, background: `oklch(0.42 0.1 ${hue(app.name)})`, fontSize: size * 0.42 }}
      className={cn('grid shrink-0 place-items-center font-medium text-white', className)}
    >
      {app.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** The app's own Shasta address (game://hextris, app://discord): typing it in the address bar launches it. */
export const addressOf = (app: Pick<AppCardType, 'slug' | 'category'>) => appAddress(app.category?.isGame ? 'game' : 'app', app.slug)

// ---- action button ---------------------------------------------------------------------------

/** Install / Open / Update for one app, driven by the user's real library. */
export function AppAction({ app, size = 'sm', className }: { app: AppCardType; size?: 'sm' | 'lg'; className?: string }) {
  const library = useStore((s) => s.library)
  const busy = useStore((s) => !!s.busy[app.id])
  const { install, launch, update } = useStore.getState()
  const mine = installedMap(library).get(app.id)
  const big = size === 'lg'
  const base = cn(big ? 'h-10 min-w-28 px-4 text-sm' : 'h-8 min-w-[4.5rem] px-3 text-xs', 'rounded-lg font-medium', className)

  // the accent belongs to the page's one big action (hero, listing); tiles in a grid stay quiet
  const key = big ? 'bg-shasta-accent text-shasta-accent-fg hover:bg-shasta-accent/85' : 'bg-shasta-field text-shasta-fg ring-1 ring-shasta-line hover:bg-shasta-hover'

  if (app.status !== 'published' && !mine) return <span className={cn('text-xs text-shasta-muted', className)}>Not available</span>
  if (busy)
    return (
      <Button disabled className={base} variant="secondary">
        <Loader2 className="sh-spin" aria-hidden /> Working…
      </Button>
    )
  if (!mine)
    return (
      <Button className={cn(base, key)} onClick={(e) => (e.stopPropagation(), void install(app))}>
        <Download aria-hidden /> Install
      </Button>
    )
  if (!mine.available)
    return (
      <Button className={base} variant="secondary" disabled title={mine.unavailableReason ?? undefined}>
        Unavailable
      </Button>
    )
  if (mine.updateAvailable)
    return (
      <Button className={cn(base, key)} onClick={(e) => (e.stopPropagation(), void update(app.id))}>
        <RefreshCw aria-hidden /> Update
      </Button>
    )
  return (
    <Button className={base} variant="secondary" onClick={(e) => (e.stopPropagation(), void launch(app.id))}>
      <Play aria-hidden /> Open
    </Button>
  )
}

// ---- cards -------------------------------------------------------------------------------------

// the people who made it come first; the storefront it was found on is shown on the app's own page
const meta = (a: AppCardType) => [a.developer || a.store?.name, a.genres?.[0]?.name ?? a.category?.name].filter(Boolean).join(' · ')

/** Warms the listing while the pointer rests on a tile, so opening it is instant. */
const prefetchListing = (app: AppCardType) => {
  if (app.status === 'published') prefetchApi(`/api/catalog/apps/${encodeURIComponent(app.slug)}`)
}

/** The app's wide artwork, or a gradient in its own colour. Space is reserved (16:9) so nothing jumps when it loads. */
export function AppCover({ app, className, eager }: { app: Pick<AppCardType, 'name' | 'bannerUrl'>; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  const h = hue(app.name)
  return (
    <div className={cn('relative aspect-video overflow-hidden', className)} style={{ background: `linear-gradient(135deg, oklch(0.36 0.06 ${h}), oklch(0.25 0.04 ${h}))` }} aria-hidden>
      {app.bannerUrl && !failed && (
        <img crossOrigin={MEDIA_CORS} src={app.bannerUrl} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      )}
    </div>
  )
}

/**
 * The one link of a tile. Its ::after covers the whole tile, so a click anywhere opens the listing, while the
 * Install/Open button stays a separate control on top (no button nested inside a link: screen readers and keyboards
 * see two clean targets). The tile itself needs `relative`, and its buttons `relative z-10`.
 */
export function TileLink({ app, label, className, children }: { app: AppCardType; label?: string; className?: string; children: ReactNode }) {
  const { go } = useStoreNav()
  const open = () => go(appPath(app.slug))
  return (
    <span
      role="link"
      tabIndex={0}
      aria-label={label ?? `${app.name}, ${meta(app)}`}
      title={app.name}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.preventDefault(), open())
      }}
      onFocus={() => prefetchListing(app)}
      className={cn("cursor-pointer outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']", className)}
    >
      {children}
    </span>
  )
}

/** shared tile frame: lifts on hover, shows a clear ring when its link has keyboard focus */
export const TILE_FRAME =
  'group relative rounded-2xl bg-shasta-home ring-1 ring-shasta-line transition-[box-shadow,background-color] duration-150 ease-shasta hover:bg-shasta-field hover:ring-shasta-fg/15 has-[[role=link]:focus-visible]:ring-2 has-[[role=link]:focus-visible]:ring-shasta-accent'

/**
 * A tile: icon, title, developer, category and the action. Clicking anywhere else opens the listing.
 * `cover` puts the app's artwork on top (games library look); the default card is the compact one.
 */
export function AppTile({ app, className, variant = 'card' }: { app: AppCardType; className?: string; variant?: 'card' | 'cover' }) {
  if (variant === 'cover')
    return (
      <article onPointerEnter={() => prefetchListing(app)} className={cn(TILE_FRAME, 'flex flex-col overflow-hidden', className)}>
        <AppCover app={app} />
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <AppIcon app={app} size={40} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[15px] leading-5 font-medium">
                <TileLink app={app}>{app.name}</TileLink>
              </h3>
              <p className="truncate text-xs text-shasta-muted">{app.developer || app.store?.name}</p>
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-shasta-faint">{app.genres?.length ? app.genres.slice(0, 2).map((g) => g.name).join(' · ') : app.category?.name}</span>
            <AppAction app={app} className="relative z-10 shrink-0" />
          </div>
        </div>
      </article>
    )
  return (
    <article onPointerEnter={() => prefetchListing(app)} className={cn(TILE_FRAME, 'flex flex-col gap-3 p-4', className)}>
      <div className="flex items-start gap-3">
        <AppIcon app={app} size={60} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate leading-5 font-medium">
            <TileLink app={app}>{app.name}</TileLink>
          </h3>
          <p className="mt-0.5 truncate text-xs text-shasta-muted">{meta(app)}</p>
          {app.kind === 'linked' && <p className="mt-0.5 text-xs text-shasta-faint">Linked web app</p>}
        </div>
      </div>
      {app.summary && <p className="line-clamp-2 text-xs text-shasta-muted">{app.summary}</p>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="sh-meta">{app.version ? `v${app.version}` : ''}</span>
        <AppAction app={app} className="relative z-10" />
      </div>
    </article>
  )
}

/** Compact row (search results, charts): icon, title, meta, action. */
export function AppRow({ app, index }: { app: AppCardType; index?: number }) {
  const { go } = useStoreNav()
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => go(appPath(app.slug))}
      onKeyDown={(e) => e.key === 'Enter' && go(appPath(app.slug))}
      className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150 ease-shasta hover:bg-shasta-hover"
    >
      {index !== undefined && <span className="w-6 text-center font-mono text-sm text-shasta-faint tabular-nums">{index + 1}</span>}
      <AppIcon app={app} size={52} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{app.name}</p>
        <p className="truncate text-xs text-shasta-muted">{meta(app)}</p>
        {app.summary && <p className="mt-0.5 truncate text-xs text-shasta-faint">{app.summary}</p>}
      </div>
      <AppAction app={app} />
    </div>
  )
}

// ---- layout bits ----------------------------------------------------------------------------------

export function Section({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-12', className)} aria-label={title}>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="sh-heading">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-shasta-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Horizontal scroller with arrows (like a store shelf). */
export function Shelf({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: false })
  const measure = () => {
    const el = ref.current
    if (el) setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 })
  }
  useEffect(() => {
    measure()
  }, [children])
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <div className="group/shelf relative">
      <div ref={ref} onScroll={measure} className={cn('-mx-1 -my-2 flex snap-x scroll-px-1 gap-4 overflow-x-auto px-1 py-2 [scrollbar-width:none] [&>*]:snap-start [&>*]:shrink-0', className)}>
        {children}
      </div>
      {!edge.start && (
        <button aria-label="Scroll back" onClick={() => scroll(-1)} className="absolute top-1/2 -left-4 z-20 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-popover shadow-md ring-1 ring-shasta-line group-focus-within/shelf:grid group-hover/shelf:grid hover:bg-shasta-hover focus-visible:grid focus-visible:ring-2 focus-visible:ring-shasta-accent">
          <ChevronLeft className="size-5" />
        </button>
      )}
      {!edge.end && (
        <button aria-label="Scroll forward" onClick={() => scroll(1)} className="absolute top-1/2 -right-4 z-20 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-popover shadow-md ring-1 ring-shasta-line group-focus-within/shelf:grid group-hover/shelf:grid hover:bg-shasta-hover focus-visible:grid focus-visible:ring-2 focus-visible:ring-shasta-accent">
          <ChevronRight className="size-5" />
        </button>
      )}
    </div>
  )
}

export function TileSkeletons({ n = 4, variant = 'card' }: { n?: number; variant?: 'card' | 'cover' }) {
  return (
    <div className={cn('grid gap-3', variant === 'cover' ? GRID_COVER : 'grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]')} aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => <TileSkeleton key={i} variant={variant} />)}
    </div>
  )
}

export function TileSkeleton({ variant = 'card', className }: { variant?: 'card' | 'cover'; className?: string }) {
  if (variant === 'cover')
    return (
      <div className={cn('overflow-hidden rounded-2xl bg-shasta-home ring-1 ring-shasta-line', className)} aria-hidden>
        <div className="aspect-video animate-pulse bg-shasta-field" />
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="size-10 animate-pulse rounded-lg bg-shasta-field" />
            <div className="flex-1 space-y-2"><div className="h-3.5 w-3/4 animate-pulse rounded bg-shasta-field" /><div className="h-3 w-1/2 animate-pulse rounded bg-shasta-field" /></div>
          </div>
          <div className="h-8" />
        </div>
      </div>
    )
  return <div className={cn('h-36 animate-pulse rounded-2xl bg-shasta-home ring-1 ring-shasta-line', className)} aria-hidden />
}

const GRID_COVER = 'grid-cols-[repeat(auto-fill,minmax(min(100%,15.5rem),1fr))]'

/**
 * A long grid of cover tiles. Tiles off screen skip layout and paint (`content-visibility`), with a reserved size so
 * the scrollbar does not jump: a few hundred apps scroll as smoothly as a dozen.
 */
export function AppGrid({ apps, busy }: { apps: AppCardType[]; busy?: boolean }) {
  return (
    <div className={cn('grid gap-x-4 gap-y-5 *:[contain-intrinsic-size:auto_17rem] *:[content-visibility:auto]', GRID_COVER)} aria-busy={busy}>
      {apps.map((a) => <AppTile key={a.id} app={a} variant="cover" />)}
    </div>
  )
}

/**
 * The end of an infinitely scrolling list: loads the next page as it nears the screen, with a button for keyboard
 * users, reduced motion and browsers without IntersectionObserver. Also says how much is shown, for screen readers.
 */
export function LoadMore({ shown, total, loading, hasMore, error, onMore, onRetry, noun = 'apps' }: { shown: number; total: number | null; loading: boolean; hasMore: boolean; error?: string | null; onMore: () => void; onRetry?: () => void; noun?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNearViewport(ref, { margin: '800px' })
  const reduced = useReducedMotion()
  const auto = !reduced && !error
  useEffect(() => {
    if (auto && near && hasMore && !loading) onMore()
  }, [auto, near, hasMore, loading, onMore])
  return (
    <div ref={ref} className="mt-4">
      {loading && hasMore && <TileSkeletons n={4} variant="cover" />}
      <div className="mt-5 flex flex-col items-center gap-2">
        {error ? (
          <>
            <p className="text-sm text-shasta-muted">{error}</p>
            {onRetry && <Button variant="secondary" onClick={onRetry}><RefreshCw /> Try again</Button>}
          </>
        ) : hasMore ? (
          <Button variant="secondary" disabled={loading} onClick={onMore}>{loading ? <><Loader2 className="sh-spin" aria-hidden /> Loading…</> : `Show more (${(total ?? 0) - shown} left)`}</Button>
        ) : total !== null && total > 0 ? (
          <p className="text-xs text-shasta-faint">That's all {total} {noun}</p>
        ) : null}
        <p className="sr-only" aria-live="polite">{total !== null ? `Showing ${shown} of ${total} ${noun}` : ''}</p>
      </div>
    </div>
  )
}

/**
 * Renders its children only once they come near the screen, and keeps their space reserved before that. For rails
 * that fetch: the request starts when the person scrolls toward it, not at page load.
 */
export function LazyMount({ children, minHeight = 260, className }: { children: ReactNode; minHeight?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNearViewport(ref, { margin: '500px', once: true })
  return (
    <div ref={ref} className={className} style={near ? undefined : { minHeight }}>
      {near ? children : null}
    </div>
  )
}

export function Message({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-shasta-line px-6 py-14 text-center" role="status">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-shasta-field text-shasta-faint">{icon ?? <SearchIcon className="size-5" />}</div>
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-shasta-muted">{body}</p>}
      {action && <div className="mt-4 flex gap-2">{action}</div>}
    </div>
  )
}

/** A failed load: offline gets its own wording, everything has a retry. */
export function LoadError({ message, offline, onRetry }: { message: string; offline?: boolean; onRetry?: () => void }) {
  const noBackend = useStore((s) => s.noBackend)
  return (
    <Message
      icon={offline ? <CloudOff className="size-5" /> : <AlertTriangle className="size-5" />}
      title={offline ? (noBackend ? 'Not connected yet' : 'You appear to be offline') : "Couldn't load this"}
      body={message}
      action={onRetry && <Button variant="secondary" onClick={onRetry}><RefreshCw /> Try again</Button>}
    />
  )
}

const STATUS_STYLE: Record<AppStatus | VersionState, string> = {
  draft: 'bg-shasta-field text-shasta-muted',
  pending: 'bg-amber-500/15 text-shasta-warn',
  published: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  live: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  unpublished: 'bg-shasta-field text-shasta-muted',
  archived: 'bg-shasta-field text-shasta-muted',
  rejected: 'bg-shasta-danger/15 text-shasta-danger',
  removed: 'bg-shasta-danger/15 text-shasta-danger',
}
const STATUS_LABEL: Record<string, string> = { pending: 'Pending review', live: 'Live', archived: 'Previous', published: 'Published' }

export function StatusBadge({ status }: { status: AppStatus | VersionState }) {
  return <span className={cn('inline-flex h-5 items-center rounded-md px-2 text-xs capitalize', STATUS_STYLE[status])}>{STATUS_LABEL[status] ?? status}</span>
}

export function Chip({ active, children, ...props }: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 ease-shasta outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background', active ? 'sh-selected' : 'text-shasta-muted ring-1 ring-shasta-line hover:bg-shasta-hover hover:text-shasta-fg', props.className)}
    >
      {children}
    </button>
  )
}

/** Small labelled value, used in info tables and stat strips. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-shasta-home px-4 py-3 ring-1 ring-shasta-line">
      <p className="text-xs text-shasta-muted">{label}</p>
      <p className="mt-1 text-xl font-medium tabular-nums">{value}</p>
      {hint && <p className="text-xs text-shasta-faint">{hint}</p>}
    </div>
  )
}

// ---- storefronts ---------------------------------------------------------------------------------------

/** A storefront's logo, or its first letter on its own colour. */
export function StoreAvatar({ store, size = 40, className }: { store: Pick<StoreRef, 'name' | 'accent' | 'logoUrl'> & { official?: boolean }; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const radius = Math.round(size * 0.28)
  // the official storefront wears the Shasta mark until it has a logo of its own
  if (store.official && (!store.logoUrl || failed))
    return (
      <span aria-hidden style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(145deg, oklch(0.62 0.17 ${store.accent}), oklch(0.36 0.12 ${store.accent}))` }} className={cn('grid shrink-0 place-items-center text-white', className)}>
        <Logo className="size-[58%]" />
      </span>
    )
  if (store.logoUrl && !failed)
    return <img crossOrigin={MEDIA_CORS} src={store.logoUrl} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: radius }} className={cn('shrink-0 bg-shasta-field object-cover', className)} />
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: radius, background: `oklch(0.5 0.1 ${store.accent})`, fontSize: size * 0.44 }} className={cn('grid shrink-0 place-items-center font-medium text-white', className)}>
      {store.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

export function OfficialBadge() {
  return <span className="inline-flex items-center gap-1 text-xs font-normal text-shasta-muted"><BadgeCheck className="size-3.5" aria-hidden /> Official</span>
}

/** The coloured cover of a storefront: its banner image, or a gradient made from its colour. */
export function StoreCover({ store, className }: { store: Pick<StoreRef, 'accent' | 'bannerUrl' | 'official'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  const h = store.accent
  return (
    <div className={cn('relative overflow-hidden', className)} aria-hidden>
      {store.bannerUrl && !failed ? (
        <img crossOrigin={MEDIA_CORS} src={store.bannerUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(true)} draggable={false} />
      ) : (
        <div
          className="size-full"
          style={{ background: `linear-gradient(120deg, oklch(0.42 0.09 ${h}), oklch(0.27 0.06 ${h}))` }}
        />
      )}
      {store.official && !(store.bannerUrl && !failed) && <Logo className="absolute -right-6 -bottom-8 size-40 text-white opacity-[0.09]" />}
    </div>
  )
}

/** A storefront as a shelf tile: cover, logo, name, tagline and honest counts. */
export function StoreTile({ store, className }: { store: StoreCard; className?: string }) {
  const { go } = useStoreNav()
  return (
    <button
      onClick={() => go(storePath(store.slug))}
      aria-label={`${store.name} storefront, ${store.apps} app${store.apps === 1 ? '' : 's'}`}
      className={cn('sh-theme group overflow-hidden rounded-2xl bg-shasta-home text-left ring-1 ring-shasta-line transition-[box-shadow,background-color] duration-150 ease-shasta hover:bg-shasta-field hover:ring-shasta-fg/15', className)}
      style={{ ['--sh-hue' as string]: store.accent }}
    >
      <StoreCover store={store} className="h-16" />
      <div className="px-4 pb-4">
        <StoreAvatar store={store} size={48} className="relative z-10 -mt-6 ring-4 ring-shasta-home" />
        <p className="mt-2 flex flex-wrap items-center gap-2 font-medium">{store.name}{store.official && <OfficialBadge />}</p>
        <p className="mt-0.5 line-clamp-2 min-h-8 text-xs text-shasta-muted">{store.tagline || `Apps and games from ${store.name}`}</p>
        <p className="mt-2 text-xs text-shasta-faint tabular-nums">{store.apps} app{store.apps === 1 ? '' : 's'}{store.followers > 0 && ` · ${store.followers} follower${store.followers === 1 ? '' : 's'}`}</p>
      </div>
    </button>
  )
}

/** Follow / Following for a storefront. Creates the anonymous account on first use, like installing does. */
/** Following is kept on this device, so the button reads it from there (no account involved). */
export function FollowButton({ store, onChange, quiet }: { store: Pick<StoreRef, 'id' | 'name'>; following?: boolean; onChange?: () => void; /** not the page's main action: no accent fill */ quiet?: boolean }) {
  const [busy, setBusy] = useState(false)
  const following = useStore((s) => !!s.local?.following.includes(store.id))
  return (
    <Button
      disabled={busy}
      aria-pressed={following}
      variant={following || quiet ? 'secondary' : 'default'}
      className={cn('h-9 rounded-lg px-3', !following && !quiet && 'bg-shasta-accent text-shasta-accent-fg hover:bg-shasta-accent/85')}
      onClick={async () => {
        setBusy(true)
        await useStore.getState().follow(store, !following)
        setBusy(false)
        onChange?.()
      }}
    >
      {busy ? <Loader2 className="sh-spin" /> : following ? <Check /> : <UserPlus />} {following ? 'Following' : 'Follow'}
    </Button>
  )
}
