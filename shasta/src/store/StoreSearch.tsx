import { useEffect, useMemo, type ReactNode } from 'react'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTabs } from '@/stores/tabsStore'
import { facetsOf, type Facet, type Kind } from './facets'
import type { AppCard, CategoryRef, GenreCount, SearchIntent, SearchMeta } from './types'
import { appsQuery, useApi, usePagedApps } from './hooks'
import { useStoreNav } from './nav'
import { AppAction, AppCover, AppGrid, AppIcon, Chip, ChipRail, LoadError, LoadMore, Message, TILE_FRAME, TileLink, TileSkeletons } from './components'

const SORTS = [
  ['relevance', 'Best match'],
  ['newest', 'Newest'],
  ['updated', 'Recently updated'],
  ['popular', 'Most installed'],
  ['name', 'Name (A–Z)'],
] as const
// `kind` on the API: linked web apps open the site through the proxy, packages are zips uploaded to (and run from) the Store
const KINDS = [
  ['', 'Any type', 'Links and downloads'],
  ['linked', 'Links', 'Web games and apps that open their own site'],
  ['package', 'Downloads', 'Zipped packages downloaded from the Store, they keep working offline'],
] as const

/** Queries that show what the search understands; offered when nothing matched. */
const TRY = ['horror games', '2 player games', 'games like minecraft', 'gba pokemon', 'new puzzle games', 'offline games']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Popular horror games", "Games like Minecraft", "Puzzle games by RobTop": what the words were read as. */
export function describeIntent(i: SearchIntent, developerName?: string): string {
  const what = i.facets.map((f) => f.label).join(' ')
  const group = i.group === 'games' ? 'games' : i.group === 'apps' ? 'apps' : ''
  let s = [i.order === 'newest' ? 'new' : i.order === 'popular' ? 'popular' : '', what, group].filter(Boolean).join(' ')
  if (i.like) s = `${s || 'games and apps'} like ${i.like.name}`
  if (i.developer) s = `${s || 'everything'} by ${developerName ?? i.developer}`
  if (i.kind === 'package') s = `${s || 'apps and games'} that work offline`
  else if (i.kind === 'linked') s = `${s || 'apps and games'} that open their site`
  if (!s) s = 'everything'
  // keep proper names as they are ("Horror", "Game Boy Advance"); only the first letter of the line is raised
  return cap(s)
}

/**
 * Search results and category / Games / Apps browsing: one page, driven entirely by the address (so back/forward work).
 * A text search also gets what the server understood (services/catalog.ts): a genre or system it read, a typo it
 * corrected, a clear best match, counts to narrow down, matching developers. The filters live in the address; how far
 * the list has been scrolled does not, and the pages already loaded for a filter are remembered.
 */
export default function StoreSearch() {
  const { route, go, tabId } = useStoreNav()
  const q = route.query.get('q') ?? ''
  const category = route.query.get('category') ?? ''
  const genre = route.query.get('genre') ?? ''
  const group = route.query.get('group') ?? ''
  const kind = route.query.get('kind') ?? ''
  const exact = route.query.get('exact') === '1'
  const sortParam = route.query.get('sort') ?? ''
  const sort = q ? (sortParam || 'relevance') : sortParam === 'relevance' ? 'newest' : sortParam || 'newest'
  const cats = useApi<{ categories: CategoryRef[]; genres?: GenreCount[] }>('/api/catalog/categories')
  const query = useMemo(() => appsQuery({ sort, q, category, genre, group, kind, exact: exact ? '1' : '' }), [q, category, genre, group, kind, sort, exact])
  const list = usePagedApps(query)
  const meta = q ? list.meta : null
  const intent = meta?.intent ?? null

  const facets = useMemo(() => facetsOf(cats.data?.categories ?? [], cats.data?.genres, (group === 'all' ? 'all' : group || 'all') as Kind), [cats.data, group])
  const catName = genre ? (cats.data?.genres?.find((g) => g.id === genre)?.name ?? meta?.refine.genres.find((g) => g.id === genre)?.name ?? genre) : cats.data?.categories.find((c) => c.id === category)?.name
  const devName = intent?.developer ? meta?.developers[0]?.name : undefined
  // a query that was only an intention ("horror games") is titled by what it meant; anything else by its words
  const shownQ = meta?.corrected?.applied ? meta.corrected.query : q
  const heading = q ? (intent?.browse ? describeIntent(intent, devName) : `“${shownQ}”`) : catName ?? (group === 'games' ? 'Games' : group === 'apps' ? 'Apps' : sortParam === 'updated' ? 'Recently updated' : 'Explore')
  const tabTitle = q ? `${q} – Shasta Store` : `${heading} – Shasta Store`
  useEffect(() => {
    useTabs.getState().setInternalTitle(tabId, tabTitle)
  }, [tabId, tabTitle])

  const to = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(category && { category }), ...(genre && { genre }), ...(group && { group }), ...(kind && { kind }), ...(exact && { exact: '1' }), ...(sortParam && { sort: sortParam }) })
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k)
    go(`/search?${p}`)
  }
  const search = (words: string, extra: Record<string, string> = {}) => go(`/search?${new URLSearchParams({ q: words, ...extra })}`)
  const filtered = !!(q || category || genre || kind)
  const active = (f: Facet) => (f.param === 'genre' ? genre : category) === f.id

  // what the segmented controls show as chosen: the address, else what the words chose ("calculator app")
  const shownGroup = group === 'all' ? '' : group || intent?.group || ''
  const shownKind = kind === 'any' ? '' : kind || intent?.kind || ''
  const refine = meta?.refine
  const genreChips: Facet[] = q && refine ? refine.genres.filter((g) => g.count > 0 && (!shownGroup || (g.isGame !== false) === (shownGroup === 'games'))).map((g) => ({ param: 'genre', id: g.id, name: g.name, count: g.count, isGame: g.isGame !== false })) : facets

  // the clear best match (or the title "games like X" was matched to) gets its own card above the grid
  const featured = pickFeatured(meta, list.items, sort, !!(genre || category))
  const rest = featured ? list.items.filter((a) => a.id !== featured.app.id) : list.items

  return (
    <div className="pt-2">
      <div className="mb-5">
        <div className="min-w-0">
          <h1 className="sh-title break-words">{heading}</h1>
          <p className="mt-1 min-h-5 text-sm text-shasta-muted tabular-nums" aria-live="polite">
            {list.total !== null && `${list.total.toLocaleString()} ${list.total === 1 ? 'result' : 'results'}`}
            {q && intent?.browse && <span className="text-shasta-faint"> for “{q}”</span>}
          </p>
        </div>
      </div>

      {q && <Understood q={q} meta={meta} exact={exact} devName={devName} onSearch={search} onGenre={(id) => go(`/search?genre=${encodeURIComponent(id)}${intent?.group ? `&group=${intent.group}` : ''}`)} />}

      {/* every "how to show the results" control on one toolbar row: what, which type, then the order on the far side */}
      {!(q && list.total === 0) && <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="Show games, apps or both"
          value={shownGroup}
          options={[
            ['', 'All', refine ? refine.groups.games + refine.groups.apps : null],
            ['games', 'Games', refine?.groups.games ?? null],
            ['apps', 'Apps', refine?.groups.apps ?? null],
          ]}
          onChange={(v) => to({ group: v || (q && intent?.group ? 'all' : ''), category: '', genre: '' })}
        />
        <Segmented
          label="Show links, downloads or both"
          value={shownKind}
          options={KINDS.map(([v, l, hint]) => [v, l, refine ? (v === 'linked' ? refine.kinds.linked : v === 'package' ? refine.kinds.package : refine.kinds.linked + refine.kinds.package) : null, hint] as const)}
          onChange={(v) => to({ kind: v || (q && intent?.kind ? 'any' : '') })}
        />
        <label className="ml-auto flex items-center gap-2 text-sm text-shasta-muted">
          Sort by
          <select value={sort} onChange={(e) => to({ sort: e.target.value })} className="h-9 rounded-lg bg-shasta-field px-3 text-sm text-shasta-fg ring-1 ring-shasta-line outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent">
            {SORTS.filter(([v]) => v !== 'relevance' || q).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>}

      {genreChips.length > 0 && (
        <ChipRail label={q ? 'Narrow down by genre' : 'Filter by genre'} className="mb-6">
          <Chip active={!category && !genre} onClick={() => to({ category: '', genre: '' })}>All</Chip>
          {genreChips.map((f) => (
            <Chip key={`${f.param}-${f.id}`} active={active(f)} onClick={() => to({ category: f.param === 'category' ? f.id : '', genre: active(f) ? '' : f.param === 'genre' ? f.id : '' })}>
              {f.name}{f.count !== null && <span className="font-mono text-xs text-shasta-faint tabular-nums">{f.count.toLocaleString()}</span>}
            </Chip>
          ))}
        </ChipRail>
      )}

      {q && !intent?.developer && !!meta?.developers.length && (
        <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Developers">
          <span className="mr-1 text-sm text-shasta-muted">Developers</span>
          {meta.developers.map((d) => (
            <Chip key={d.name} onClick={() => search(`by ${d.name}`)}>
              <span aria-hidden className="grid size-5 place-items-center rounded-full bg-shasta-field text-[11px] font-medium text-shasta-fg">{d.name.charAt(0).toUpperCase()}</span>
              {d.name}
              <span className="font-mono text-xs text-shasta-faint tabular-nums">{d.count}</span>
            </Chip>
          ))}
        </div>
      )}

      {list.error && !list.items.length ? (
        <LoadError message={list.error} offline={list.offline} onRetry={list.reload} />
      ) : list.initial ? (
        <TileSkeletons n={8} variant="cover" />
      ) : list.items.length === 0 ? (
        <Message
          icon={<SearchX className="size-5" />}
          title={q ? `Nothing matches “${q}”` : 'Nothing here yet'}
          body={q ? 'Try fewer words, a genre or a system (“horror games”, “gba”), a developer (“by RobTop”), or “games like …”.' : 'No published apps match these filters yet.'}
          action={
            <div className="flex max-w-lg flex-col items-center gap-4">
              {q && (
                <div className="flex flex-wrap justify-center gap-2">
                  {TRY.map((t) => <Chip key={t} onClick={() => search(t)}>{t}</Chip>)}
                </div>
              )}
              {filtered && <Button variant="secondary" onClick={() => go(group && group !== 'all' ? `/search?group=${group}` : '/search')}>Clear search and filters</Button>}
            </div>
          }
        />
      ) : (
        <>
          {featured && <TopResult app={featured.app} label={featured.label} />}
          {featured && rest.length > 0 && <h2 className="mb-3 text-sm font-medium text-shasta-muted">{featured.like ? `More like ${featured.app.name}` : 'More results'}</h2>}
          <AppGrid apps={rest} busy={list.loading} />
          <LoadMore shown={list.items.length} total={list.total} loading={list.loading} hasMore={list.hasMore} error={list.items.length ? list.error : null} onMore={list.loadMore} onRetry={list.reload} noun={q ? 'results' : 'apps'} />
        </>
      )}
    </div>
  )
}

function pickFeatured(meta: SearchMeta | null, items: AppCard[], sort: string, narrowed: boolean): { app: AppCard; label: string; like?: boolean } | null {
  if (!meta || sort !== 'relevance' || narrowed || !items.length) return null
  const like = meta.intent?.like
  if (like && items[0]?.id === like.id) return { app: items[0], label: 'You asked for things like', like: true }
  if (meta.topId && items[0]?.id === meta.topId) return { app: items[0], label: 'Top result' }
  return null
}

/**
 * How the words were read, in one quiet line: the genres/systems/developer it understood (each a way to browse that on
 * its own), a typo it corrected, and always a way back to the literal words.
 */
function Understood({ q, meta, exact, devName, onSearch, onGenre }: { q: string; meta: SearchMeta | null; exact: boolean; devName?: string; onSearch: (q: string, extra?: Record<string, string>) => void; onGenre: (id: string) => void }) {
  const intent = meta?.intent
  const corrected = meta?.corrected
  const lines: ReactNode[] = []
  if (corrected?.applied)
    lines.push(
      <p key="fix">
        Showing results for <button type="button" className="font-medium text-shasta-fg underline-offset-4 hover:underline" onClick={() => onSearch(corrected.query)}>{corrected.query}</button>.{' '}
        <button type="button" className="text-shasta-muted underline-offset-4 hover:text-shasta-fg hover:underline" onClick={() => onSearch(q, { exact: '1' })}>Search for “{q}” instead</button>
      </p>,
    )
  else if (corrected)
    lines.push(
      <p key="fix">
        Did you mean <button type="button" className="font-medium text-shasta-fg underline-offset-4 hover:underline" onClick={() => onSearch(corrected.query)}>{corrected.query}</button>?
      </p>,
    )
  if (intent) {
    const pills: ReactNode[] = []
    for (const f of intent.facets)
      pills.push(
        f.genre && !f.tags ? (
          <Pill key={`f-${f.label}`} onClick={() => onGenre(f.genre!)} title={`Browse all of ${f.label}`}>{f.label}</Pill>
        ) : (
          <Pill key={`f-${f.label}`}>{f.label}</Pill>
        ),
      )
    if (intent.group) pills.push(<Pill key="g">{intent.group === 'games' ? 'Games' : 'Apps'}</Pill>)
    if (intent.kind) pills.push(<Pill key="k">{intent.kind === 'package' ? 'Works offline' : 'Links'}</Pill>)
    if (intent.order) pills.push(<Pill key="o">{intent.order === 'newest' ? 'Newest first' : 'Most played first'}</Pill>)
    if (intent.developer) pills.push(<Pill key="d">By {devName ?? intent.developer}</Pill>)
    if (intent.like)
      pills.push(
        <Pill key="l">
          <AppIcon app={intent.like} size={16} className="-ml-1" /> Like {intent.like.name}
        </Pill>,
      )
    if (intent.text) pills.push(<Pill key="t" quiet>“{intent.text}”</Pill>)
    lines.push(
      <div key="intent" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5">Searching</span>
        {pills}
        <button type="button" onClick={() => onSearch(q, { exact: '1' })} className="ml-1 text-shasta-muted underline-offset-4 hover:text-shasta-fg hover:underline">
          Just the words instead
        </button>
      </div>,
    )
  }
  if (exact)
    lines.push(
      <p key="exact">
        Searching for exactly these words.{' '}
        <button type="button" onClick={() => onSearch(q)} className="text-shasta-muted underline-offset-4 hover:text-shasta-fg hover:underline">
          Let Shasta read what you meant
        </button>
      </p>,
    )
  if (!lines.length) return null
  return <div className="mb-5 flex flex-col gap-2 text-sm text-shasta-muted">{lines}</div>
}

function Pill({ children, onClick, title, quiet }: { children: ReactNode; onClick?: () => void; title?: string; quiet?: boolean }) {
  const cls = cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px]', quiet ? 'text-shasta-muted ring-1 ring-shasta-line' : 'bg-shasta-field text-shasta-fg ring-1 ring-shasta-line')
  if (!onClick) return <span className={cls}>{children}</span>
  return (
    <button type="button" onClick={onClick} title={title} className={cn(cls, 'transition-colors duration-150 ease-shasta outline-none hover:bg-shasta-hover focus-visible:ring-2 focus-visible:ring-shasta-accent')}>
      {children}
    </button>
  )
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string, number | null, string?])[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-[10px] bg-shasta-field p-0.5" role="group" aria-label={label}>
      {options.map(([v, l, n, hint]) => (
        <button
          key={v}
          type="button"
          title={hint}
          aria-pressed={value === v}
          disabled={n === 0 && value !== v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-[color,background-color,box-shadow] duration-150 ease-shasta outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent disabled:opacity-40',
            value === v ? 'sh-selected' : 'text-shasta-muted hover:text-shasta-fg',
          )}
        >
          {l}
          {n !== null && <span className="font-mono text-xs text-shasta-faint tabular-nums">{n.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  )
}

/** The one result the words clearly asked for: wide art, what it is, and its action right there. */
function TopResult({ app, label }: { app: AppCard; label: string }) {
  const genres = app.genres?.length ? app.genres.slice(0, 3).map((g) => g.name) : app.category ? [app.category.name] : []
  return (
    <article className={cn(TILE_FRAME, 'mb-8 grid overflow-hidden sm:grid-cols-[minmax(0,20rem)_1fr]')} aria-label={`${label}: ${app.name}`}>
      <AppCover app={app} eager className="sm:aspect-auto sm:h-full sm:min-h-44" />
      <div className="flex min-w-0 flex-col gap-3 p-5">
        <p className="text-xs text-shasta-faint">{label}</p>
        <div className="flex min-w-0 items-center gap-3">
          <AppIcon app={app} size={52} eager />
          <div className="min-w-0">
            <h2 className="truncate text-xl leading-7 font-medium">
              <TileLink app={app}>{app.name}</TileLink>
            </h2>
            <p className="truncate text-sm text-shasta-muted">{app.developer || app.store?.name}</p>
          </div>
        </div>
        {app.summary && <p className="line-clamp-2 max-w-prose text-sm text-shasta-muted">{app.summary}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <AppAction app={app} size="lg" className="relative z-10" />
          <span className="text-xs text-shasta-faint">{[...genres, app.kind === 'package' ? 'Works offline' : 'Opens its site'].join(' · ')}</span>
        </div>
      </div>
    </article>
  )
}

