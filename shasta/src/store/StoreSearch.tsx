import { useEffect, useMemo } from 'react'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTabs } from '@/stores/tabsStore'
import { facetsOf, type Facet, type Kind } from './facets'
import type { CategoryRef, GenreCount } from './types'
import { appsQuery, useApi, usePagedApps } from './hooks'
import { useStoreNav } from './nav'
import { AppGrid, Chip, LoadError, LoadMore, Message, TileSkeletons } from './components'
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
  ['package', 'Downloads', 'Zipped packages downloaded from the Store'],
] as const

/**
 * Search results and category / Games / Apps browsing: one page, driven entirely by the address (so back/forward work).
 * The filters live in the address; how far the list has been scrolled does not (a new filter starts at the top), and
 * the pages already loaded for a filter are remembered, so coming back to it shows them at once.
 */
export default function StoreSearch() {
  const { route, go, tabId } = useStoreNav()
  const q = route.query.get('q') ?? ''
  const category = route.query.get('category') ?? ''
  const genre = route.query.get('genre') ?? ''
  const group = route.query.get('group') ?? ''
  const kind = route.query.get('kind') ?? ''
  const sortParam = route.query.get('sort') ?? ''
  const sort = q ? (sortParam || 'relevance') : sortParam === 'relevance' ? 'newest' : sortParam || 'newest'
  const cats = useApi<{ categories: CategoryRef[]; genres?: GenreCount[] }>('/api/catalog/categories')
  const query = useMemo(() => appsQuery({ sort, q, category, genre, group, kind }), [q, category, genre, group, kind, sort])
  const list = usePagedApps(query)

  const facets = useMemo(() => facetsOf(cats.data?.categories ?? [], cats.data?.genres, (group || 'all') as Kind), [cats.data, group])
  const catName = genre ? (cats.data?.genres?.find((g) => g.id === genre)?.name ?? genre) : cats.data?.categories.find((c) => c.id === category)?.name
  const title = q ? `Results for “${q}”` : catName ?? (group === 'games' ? 'Games' : group === 'apps' ? 'Apps' : sortParam === 'updated' ? 'Recently updated' : 'Explore')
  useEffect(() => {
    useTabs.getState().setInternalTitle(tabId, `${title} – Shasta Store`)
  }, [tabId, title])

  const to = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(category && { category }), ...(genre && { genre }), ...(group && { group }), ...(kind && { kind }), ...(sortParam && { sort: sortParam }) })
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k)
    go(`/search?${p}`)
  }
  const filtered = !!(q || category || genre || kind)
  const active = (f: Facet) => (f.param === 'genre' ? genre : category) === f.id

  return (
    <div className="pt-2">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="min-h-5 text-sm text-shasta-muted" aria-live="polite">{list.total !== null && `${list.total} ${list.total === 1 ? 'result' : 'results'}`}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-shasta-muted">
          Sort by
          <select value={sort} onChange={(e) => to({ sort: e.target.value })} className="h-9 rounded-lg bg-shasta-field px-3 text-sm text-shasta-fg ring-1 ring-shasta-line outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent">
            {SORTS.filter(([v]) => v !== 'relevance' || q).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="inline-flex rounded-full bg-shasta-field p-1 ring-1 ring-shasta-line" role="group" aria-label="Show games, apps or both">
          {([['', 'All'], ['games', 'Games'], ['apps', 'Apps']] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={group === v}
              onClick={() => to({ group: v, category: '', genre: '' })}
              className={cn('h-8 rounded-full px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent', group === v ? 'bg-shasta-accent text-shasta-accent-fg' : 'text-shasta-muted hover:text-shasta-fg')}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-full bg-shasta-field p-1 ring-1 ring-shasta-line" role="group" aria-label="Show links, downloads or both">
          {KINDS.map(([v, l, hint]) => (
            <button
              key={v}
              type="button"
              title={hint}
              aria-pressed={kind === v}
              onClick={() => to({ kind: v })}
              className={cn('h-8 rounded-full px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent', kind === v ? 'bg-shasta-accent text-shasta-accent-fg' : 'text-shasta-muted hover:text-shasta-fg')}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {facets.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Filter by genre">
          <Chip active={!category && !genre} onClick={() => to({ category: '', genre: '' })}>All</Chip>
          {facets.map((f) => (
            <Chip key={`${f.param}-${f.id}`} active={active(f)} onClick={() => to({ category: f.param === 'category' ? f.id : '', genre: f.param === 'genre' ? f.id : '' })}>
              {f.name} {f.count !== null && <span className="ml-1 text-xs opacity-60">{f.count}</span>}
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
          body={q ? 'Check the spelling, try fewer or shorter words, or search by developer or category. Partial words work too.' : 'No published apps match these filters yet.'}
          action={filtered ? <Button variant="secondary" onClick={() => go(group ? `/search?group=${group}` : '/search')}>Clear search and filters</Button> : undefined}
        />
      ) : (
        <>
          <AppGrid apps={list.items} busy={list.loading} />
          <LoadMore shown={list.items.length} total={list.total} loading={list.loading} hasMore={list.hasMore} error={list.items.length ? list.error : null} onMore={list.loadMore} onRetry={list.reload} noun={q ? 'results' : 'apps'} />
        </>
      )}
    </div>
  )
}
