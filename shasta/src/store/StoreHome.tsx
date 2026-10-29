import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Flame, Gamepad2, History, LayoutGrid, Megaphone, PackageOpen, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { api } from './api'
import { appsQuery, useApi, usePagedApps } from './hooks'
import { useStore } from './storeStore'
import { appPath, useStoreNav } from './nav'
import { Hero } from './Hero'
import { hasTaste, recommend, topFacets } from './taste'
import { facetQuery, facetsOf, type Facet, type Kind } from './facets'
import { loadTaste, onTasteChange } from './tasteStore'
import { useSettings } from '@/stores/settingsStore'
import { useTabs } from '@/stores/tabsStore'
import { AppAction, AppGrid, AppIcon, AppTile, Chip, LazyMount, LoadError, LoadMore, Message, Section, Shelf, StoreTile, TILE_FRAME, TileLink, TileSkeleton, TileSkeletons } from './components'
import type { AppCard, Home, SearchResult } from './types'

const DAY = 86_400_000
/** a rail with fewer apps than this (after leaving out what is already on the page) is not worth a row */
const MIN_RAIL = 4
/** genre rails, biggest genres first */
const GENRE_RAILS = 8

function SeeAll({ path, label = 'See all' }: { path: string; label?: string }) {
  const { go } = useStoreNav()
  return (
    <button onClick={() => go(path)} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-shasta-accent hover:underline">
      {label} <ArrowRight className="size-3.5" aria-hidden />
    </button>
  )
}

const Row = ({ apps }: { apps: AppCard[] }) => (
  <Shelf>
    {apps.map((a) => (
      <AppTile key={a.id} app={a} variant="cover" className="w-64" />
    ))}
  </Shelf>
)

const RowSkeleton = () => (
  <div className="flex gap-3 overflow-hidden pb-2" aria-busy="true" aria-label="Loading">
    {Array.from({ length: 5 }, (_, i) => <TileSkeleton key={i} variant="cover" className="w-64 shrink-0" />)}
  </div>
)

/** Top-chart tile: a huge outlined rank number beside the app, so the eye lands on the order. */
function RankTile({ app, rank }: { app: AppCard; rank: number }) {
  return (
    <article className={cn(TILE_FRAME, 'flex w-72 items-center gap-2 py-4 pr-4 pl-2')}>
      <span aria-hidden className="w-12 shrink-0 text-center text-5xl font-black tracking-tighter text-shasta-accent/35 tabular-nums transition-colors group-hover:text-shasta-accent/70">{rank}</span>
      <AppIcon app={app} size={64} eager={rank <= 4} />
      <div className="ml-1 flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-snug">
            <TileLink app={app} label={`Number ${rank}: ${app.name}`}>{app.name}</TileLink>
          </p>
          <p className="truncate text-xs text-shasta-muted">{app.genres?.[0]?.name ?? app.category?.name ?? app.developer}</p>
        </div>
        <AppAction app={app} className="relative z-10 w-fit" />
      </div>
    </article>
  )
}

/** Small "jump back in" tile for something already in the library: icon, name, Open. */
function RecentTile({ app }: { app: AppCard }) {
  return (
    <article className={cn(TILE_FRAME, 'flex w-60 items-center gap-3 p-3')}>
      <AppIcon app={app} size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="truncate text-sm font-semibold"><TileLink app={app} label={app.name}>{app.name}</TileLink></p>
        <AppAction app={app} className="relative z-10 w-fit" />
      </div>
    </article>
  )
}

const KINDS = [
  ['all', 'All', Sparkles],
  ['games', 'Games', Gamepad2],
  ['apps', 'Apps', LayoutGrid],
] as const

const fits = (kind: Kind) => (a: AppCard) => kind === 'all' || (kind === 'games') === !!a.category?.isGame

/**
 * A genre (or app category) rail, fetched only when it scrolls near (LazyMount around it). Most installed first, without
 * anything shown higher up the page. Genres overlap (a game can be Action and Platformer), so each rail also skips what
 * the genre rails above it claimed (`claims`, by position). A rail with too little left is skipped.
 */
function FacetRail({ facet, index, exclude, claims }: { facet: Facet; index: number; exclude: Set<string>; claims: Map<number, string[]> }) {
  const { data, error } = useApi<SearchResult>(`/api/catalog/apps?${facetQuery(facet)}&${appsQuery({ sort: 'popular', limit: '30' })}`)
  const apps = useMemo(() => {
    const above = new Set([...claims].filter(([i]) => i < index).flatMap(([, ids]) => ids))
    const out = (data?.items ?? []).filter((a) => !exclude.has(a.id) && !above.has(a.id)).slice(0, 12)
    claims.set(index, out.length >= MIN_RAIL ? out.map((a) => a.id) : [])
    return out
  }, [data, exclude, claims, index])
  if (error || (data && apps.length < MIN_RAIL)) return null
  return (
    <Section title={facet.name} subtitle="Most installed first" action={<SeeAll path={`/search?${facetQuery(facet)}&sort=popular`} label={facet.count ? `See all ${facet.count}` : 'See all'} />}>
      {data ? <Row apps={apps} /> : <RowSkeleton />}
    </Section>
  )
}

/**
 * "Picked for you": candidates are the most-installed apps of the genres this browser leans towards (plain catalogue
 * requests, the same any visitor's browsing makes), ranked on the device by store/taste.ts. Hidden until there is
 * enough of a taste to go on, and when recommendations are off.
 */
function ForYouRail({ exclude, facets, onPicked }: { exclude: Set<string>; facets: Facet[]; onPicked: (ids: string[]) => void }) {
  const on = useSettings((s) => s.settings.storeForYou)
  const [taste, setTaste] = useState(loadTaste)
  useEffect(() => onTasteChange(() => setTaste(loadTaste())), [])
  const version = useStore((s) => s.catalogVersion)
  const tops = useMemo(() => (on && hasTaste(taste) ? topFacets(taste) : []), [on, taste])
  const catsKey = tops.map((f) => facetQuery(f)).join(',')
  const [pools, setPools] = useState<AppCard[][] | null>(null)
  useEffect(() => {
    if (!catsKey) {
      setPools(null)
      return
    }
    const ctl = new AbortController()
    Promise.all(catsKey.split(',').map((q) => api.get<SearchResult>(`/api/catalog/apps?${q}&${appsQuery({ sort: 'popular', limit: '40' })}`, ctl.signal).then((r) => r.items)))
      .then(setPools)
      .catch(() => undefined)
    return () => ctl.abort()
  }, [catsKey, version])
  const picks = useMemo(() => {
    if (!pools) return []
    const name = (id: string) => facets.find((f) => f.id === id)?.name ?? 'this'
    return recommend(taste, pools, { exclude, limit: 12, categoryName: name })
  }, [pools, taste, exclude, facets])
  const ids = picks.map((p) => p.app.id).join(',')
  useEffect(() => {
    onPicked(ids ? ids.split(',') : [])
  }, [ids, onPicked])

  if (!catsKey || (pools && picks.length < MIN_RAIL)) return null
  // the most common reason on the row heads it; each tile says its own
  const lead = picks[0]?.reason
  return (
    <Section
      title="Picked for you"
      subtitle={`${lead ? `${lead}. ` : ''}Worked out on this device from what you open here, never sent anywhere.`}
      action={<button onClick={() => useTabs.getState().openInternal('settings', 'privacy')} className="shrink-0 text-sm text-shasta-muted hover:text-shasta-fg hover:underline">Manage</button>}
    >
      {pools ? (
        <Shelf>
          {picks.map((p) => (
            <div key={p.app.id} className="flex w-64 flex-col gap-2">
              <AppTile app={p.app} variant="cover" />
              <p className="flex items-center gap-1.5 truncate px-1 text-xs text-shasta-muted"><Sparkles className="size-3 shrink-0" aria-hidden /> {p.reason}</p>
            </div>
          ))}
        </Shelf>
      ) : (
        <RowSkeleton />
      )}
    </Section>
  )
}

const SORTS = [
  ['popular', 'Most installed'],
  ['newest', 'Newest'],
  ['name', 'Name (A–Z)'],
] as const

/** The whole catalogue on the home page, a page at a time: proof of how much is here, without leaving Discover. */
function BrowseAll({ kind, facets, kindTotal }: { kind: Kind; facets: Facet[]; kindTotal: number }) {
  const [pick, setPick] = useState<Facet | null>(null)
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('popular')
  useEffect(() => {
    setPick(null)
  }, [kind])
  const group = kind === 'all' ? '' : kind
  const filter = pick ? facetQuery(pick) : appsQuery({ group })
  const list = usePagedApps(`${filter}${filter ? '&' : ''}${appsQuery({ sort })}`)
  const noun = kind === 'games' ? 'games' : kind === 'apps' ? 'apps' : 'games and apps'
  const count = pick ? (pick.count ?? list.total ?? undefined) : kindTotal
  const explore = `/search?${filter}${filter ? '&' : ''}sort=${sort}`

  return (
    <section aria-label="Browse everything" className="mt-4 border-t border-shasta-line pt-10">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{pick ? `${pick.name}: ${count ?? ''}` : `Browse ${count !== undefined ? `all ${count} ` : 'all '}${noun}`}</h2>
          <p className="text-sm text-shasta-muted">Keep scrolling: more load as you go</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-shasta-muted">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 rounded-lg bg-shasta-field px-3 text-sm text-shasta-fg ring-1 ring-shasta-line outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <SeeAll path={explore} label="Open in Explore" />
        </div>
      </header>
      {facets.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by genre">
          <Chip active={!pick} onClick={() => setPick(null)}>All</Chip>
          {facets.map((f) => (
            <Chip key={`${f.param}-${f.id}`} active={pick?.param === f.param && pick.id === f.id} onClick={() => setPick(f)}>
              {f.name} {f.count !== null && <span className="ml-1 text-xs opacity-60">{f.count}</span>}
            </Chip>
          ))}
        </div>
      )}
      {list.error && !list.items.length ? (
        <LoadError message={list.error} offline={list.offline} onRetry={list.reload} />
      ) : list.initial ? (
        <TileSkeletons n={8} variant="cover" />
      ) : (
        <>
          <AppGrid apps={list.items} busy={list.loading} />
          <LoadMore shown={list.items.length} total={list.total} loading={list.loading} hasMore={list.hasMore} error={list.items.length ? list.error : null} onMore={list.loadMore} onRetry={list.reload} noun={noun} />
        </>
      )}
    </section>
  )
}

/**
 * Discover. Ordered by what a person should see before being sent to Explore or search: what they already play, what
 * is hot, what is new, then a rail per genre, then the whole catalogue as an endless grid. No app appears in two rails;
 * rails further down are fetched only when scrolled near.
 */
export default function StoreHome() {
  const [kind, setKind] = useState<Kind>('all')
  const { go } = useStoreNav()
  const user = useStore((s) => s.user)
  const library = useStore((s) => s.library)
  const { data, loading, error, offline, reload } = useApi<Home>('/api/catalog/home')
  const followingKey = useStore((s) => (s.local?.following ?? []).join(','))
  const catalogVersion = useStore((s) => s.catalogVersion)
  const [feedApps, setFeedApps] = useState<AppCard[]>([])
  useEffect(() => {
    if (!followingKey) {
      setFeedApps([])
      return
    }
    let live = true
    api
      .post<{ apps: AppCard[] }>('/api/library/feed', { following: followingKey.split(',') })
      .then((r) => live && setFeedApps(r.apps))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [followingKey, catalogVersion])

  // everything the page shows, worked out once per data/kind change; `shown` grows rail by rail so nothing repeats
  const page = useMemo(() => {
    if (!data) return null
    const fit = fits(kind)
    // a young Store (a handful of apps) still gets its rails; the minimums are for a big catalogue
    const min = data.total < 24 ? 1 : MIN_RAIL
    const shown = new Set<string>()
    const take = (list: AppCard[], max = Infinity, min = 1) => {
      const out = list.filter((a) => fit(a) && !shown.has(a.id)).slice(0, max)
      if (out.length < min) return []
      out.forEach((a) => shown.add(a.id))
      return out
    }
    const installed = (library?.installed ?? []).filter((i) => i.available && fit(i.app))
    const recent = [...installed].filter((i) => i.lastLaunchedAt).sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0)).slice(0, 10).map((i) => i.app)
    installed.forEach((i) => shown.add(i.app.id))
    data.featured.forEach((a) => shown.add(a.id))
    const top = take(data.trending.length >= 3 ? data.trending : data.popular, 10, Math.min(min, 3))
    const follow = take(feedApps, 12, 1)
    const collections = data.collections.map((c) => ({ ...c, apps: take(c.apps, 16, min) })).filter((c) => c.apps.length)
    const added = take(data.recentlyAdded, 12, min)
    const favourites = take(data.popular, 8, min)
    const updated = take(data.recentlyUpdated, 12, min)
    const newThisWeek = data.recentlyAdded.filter((a) => fit(a) && a.releasedAt && Date.now() - a.releasedAt < 7 * DAY).length
    const facets = facetsOf(data.categories, data.genres, kind)
    // genres overlap, so the total comes from the categories (each app has one)
    const kindTotal = kind === 'all' ? data.total : data.categories.filter((c) => (kind === 'games') === c.isGame).reduce((n, c) => n + c.count, 0)
    return { recent, top, follow, collections, added, favourites, updated, newThisWeek, facets, kindTotal, exclude: new Set(shown) }
  }, [data, kind, library, feedApps])

  // "Picked for you" loads on its own: it skips everything the other rails show, and the genre rails skip its picks
  const [picked, setPicked] = useState<string[]>([])
  const onPicked = useCallback((ids: string[]) => setPicked(ids), [])
  const genreExclude = useMemo(() => new Set([...(page?.exclude ?? []), ...picked]), [page, picked])
  // which apps each genre rail took, by position (reset whenever the page's own rails change)
  const claims = useRef(new Map<number, string[]>())
  const railClaims = useMemo(() => {
    claims.current = new Map()
    return claims.current
  }, [genreExclude])

  if (error && !data) return <LoadError message={error} offline={offline} onRetry={reload} />
  if (!data || !page) return (
    <div className="pt-2">
      <div className="mb-9 h-72 animate-pulse rounded-3xl bg-shasta-home ring-1 ring-shasta-line" />
      <RowSkeleton />
    </div>
  )

  const canPublish = user?.role === 'contributor' || user?.role === 'owner'
  if (data.total === 0)
    return (
      <div className="pt-4">
        <Message
          icon={<PackageOpen className="size-5" />}
          title="The Store is empty so far"
          body={canPublish ? 'Nothing has been published yet. Upload the first app or game from the Develop section.' : 'Nothing has been published yet. New games and apps appear here the moment they are approved.'}
          action={canPublish ? <Button onClick={() => go('/develop')}>Open Develop</Button> : undefined}
        />
      </div>
    )

  const { announcement } = data
  const { kindTotal } = page
  const group = kind === 'all' ? '' : `group=${kind}&`
  return (
    <div className="pt-2" aria-busy={loading}>
      {announcement && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-shasta-accent/12 px-4 py-3 ring-1 ring-shasta-accent/30">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-shasta-accent" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{announcement.title}</p>
            {announcement.body && <p className="text-shasta-muted">{announcement.body}</p>}
          </div>
          {announcement.appSlug && <Button size="sm" variant="secondary" onClick={() => go(appPath(announcement.appSlug!))}>View</Button>}
        </div>
      )}

      <Hero apps={data.featured} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-full bg-shasta-field p-1 ring-1 ring-shasta-line" role="group" aria-label="Show">
          {KINDS.map(([v, l, Icon]) => (
            <button
              key={v}
              type="button"
              aria-pressed={kind === v}
              onClick={() => setKind(v)}
              className={cn('flex h-8 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent', kind === v ? 'bg-shasta-accent text-shasta-accent-fg' : 'text-shasta-muted hover:text-shasta-fg')}
            >
              <Icon className="size-4" aria-hidden /> {l}
            </button>
          ))}
        </div>
        <SeeAll path={kind === 'all' ? '/search' : `/search?group=${kind}`} label={`Explore all ${kindTotal}`} />
      </div>

      {page.facets.length > 0 && (
        <nav aria-label="Genres" className="-mx-1 mb-10 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
          {page.facets.map((f) => (
            <Chip key={`${f.param}-${f.id}`} className="shrink-0" onClick={() => go(`/search?${facetQuery(f)}`)}>
              {f.name} {f.count !== null && <span className="ml-1 text-xs opacity-60">{f.count}</span>}
            </Chip>
          ))}
        </nav>
      )}

      {page.recent.length > 0 && (
        <Section title="Jump back in" subtitle="What you opened last on this device" action={<History className="size-4 text-shasta-muted" aria-hidden />}>
          <Shelf>{page.recent.map((a) => <RecentTile key={a.id} app={a} />)}</Shelf>
        </Section>
      )}

      {page.top.length > 0 && (
        <Section title={kind === 'games' ? 'Top games' : kind === 'apps' ? 'Top apps' : 'Top 10 right now'} subtitle={data.trending.length >= 3 ? 'Most installed in the last two weeks' : 'Most installed'} action={<SeeAll path={`/search?${group}sort=popular`} />}>
          <Shelf>{page.top.map((a, i) => <RankTile key={a.id} app={a} rank={i + 1} />)}</Shelf>
        </Section>
      )}

      {page.follow.length > 0 && (
        <Section title="From storefronts you follow" subtitle="Latest releases from your favourite publishers"><Row apps={page.follow} /></Section>
      )}

      {kind === 'all' && <ForYouRail exclude={page.exclude} facets={page.facets} onPicked={onPicked} />}

      {page.collections.map((c) => (
        <Section key={c.id} title={c.title} subtitle={c.description || undefined} action={<Sparkles className="size-4 text-shasta-muted" aria-hidden />}>
          <Row apps={c.apps} />
        </Section>
      ))}

      {page.added.length > 0 && (
        <Section
          title="Recently added"
          subtitle={page.newThisWeek > 0 ? `${page.newThisWeek} new this week` : 'The newest arrivals'}
          action={<SeeAll path={`/search?${group}sort=newest`} label={`See all ${kindTotal}`} />}
        >
          <Row apps={page.added} />
        </Section>
      )}

      {page.favourites.length > 0 && (
        <Section title="All-time favourites" subtitle="Most installed of all time" action={<Flame className="size-4 text-shasta-accent" aria-hidden />}>
          <Row apps={page.favourites} />
        </Section>
      )}

      {page.updated.length > 0 && <Section title="Recently updated" action={<SeeAll path={`/search?${group}sort=updated`} />}><Row apps={page.updated} /></Section>}

      {page.facets.slice(0, GENRE_RAILS).map((f, i) => (
        <LazyMount key={`${kind}-${f.param}-${f.id}`} minHeight={300}>
          <FacetRail facet={f} index={i} exclude={genreExclude} claims={railClaims} />
        </LazyMount>
      ))}

      {data.stores.length > 0 && kind === 'all' && (
        <Section title="Storefronts" subtitle="Every publisher has their own page" action={<SeeAll path="/stores" />}>
          <Shelf>
            {data.stores.map((s) => <StoreTile key={s.id} store={s} className="w-64" />)}
          </Shelf>
        </Section>
      )}

      <LazyMount minHeight={600}>
        <BrowseAll kind={kind} facets={page.facets} kindTotal={kindTotal} />
      </LazyMount>
    </div>
  )
}
