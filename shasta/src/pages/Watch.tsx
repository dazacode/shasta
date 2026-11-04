// Shasta Watch (shasta://watch): one entertainment site for films, TV, anime, manga, comics and books, built entirely
// from live API data. A top nav splits it into Watch (Films, TV, Anime) and Read (Manga, Comics, Books); Home mixes
// both. Every section is a hero + rows from the server registry (/api/watch/home); a title opens on its own page and
// the Player / Reader only take over once Play / Read is pressed. My List and progress stay on this device.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, BookOpen, Bookmark, Check, ChevronDown, Clock, Film, Library, Loader2, Play, Plus, Star, Trash2, Tv as TvIcon, X } from 'lucide-react'
import { MEDIA_CORS } from '@/lib/appApi'
import * as proxy from '@/proxy/scramjetAdapter'
import { artUrl, watchApi, WatchError } from '@/watch/api'
import { CardGrid, featuredFromRow, Hero, KIND_LABEL, MediaCard, RowHeading, RowSection, Scroller, SkeletonCard, typeIcon, useFirstFilledRow, useRow } from '@/watch/components'
import { Player, useFitHeight } from '@/watch/Player'
import { SearchBox, SearchResults } from '@/watch/Search'
import { Reader } from '@/watch/Reader'
import { useWatch } from '@/watch/store'
import type { Candidate, Card, Continue, Featured, Kind, Row, Scope, Title } from '@/watch/types'
import { isReadKind } from '@/watch/types'
import { cn } from '@/lib/utils'
import { AdSlot } from '@/components/ads/AdSlot'
import { useSeasonLook } from '@/lib/seasonal'
import { SeasonSection, THEMES } from '@/components/seasonal/Season'

// ---- navigation ------------------------------------------------------------------------------------------------------

const WATCH_NAV: { key: Kind; label: string }[] = [
  { key: 'movie', label: 'Films' },
  { key: 'tv', label: 'TV' },
  { key: 'anime', label: 'Anime' },
]
const READ_NAV: { key: Kind; label: string }[] = [
  { key: 'manga', label: 'Manga' },
  { key: 'comic', label: 'Comics' },
  { key: 'book', label: 'Books' },
]
const SECTION_LABEL: Record<Kind, string> = { movie: 'Films', tv: 'TV', anime: 'Anime', manga: 'Manga', comic: 'Comics', book: 'Books' }

/** The "Browse" tiles on Home: each borrows a few covers from a row Home already shows. */
const TILES: { scope: Kind; line: string; from: string[] }[] = [
  { scope: 'movie', line: 'In cinemas and top rated', from: ['all:trending', 'movie:trending'] },
  { scope: 'tv', line: 'Airing now and top rated', from: ['all:trending', 'tv:trending'] },
  { scope: 'anime', line: 'Airing now and classics', from: ['all:trending', 'anime:trending'] },
  { scope: 'manga', line: 'Manga, manhwa, manhua', from: ['manga:trending'] },
  { scope: 'comic', line: 'Marvel, DC and more', from: ['comic:popular', 'comic:new'] },
  { scope: 'book', line: 'Web novels and classics', from: ['book:novels', 'book:classics'] },
]

const isReadRow = (r: Row) => /^(manga|comic|book):/.test(r.key)
const isTrending = (r: Row) => r.key.endsWith(':trending')
/** "Anime · TV_SHORT" -> ["Anime", "TV short"]; reading titles lead with their own format (Manhwa, Web novel). */
function kindFacts(t: Title): string[] {
  if (t.kind === 'anime') {
    const sub = t.format?.split(' · ')[1]
    const pretty = sub ? (sub === 'TV' || sub === 'ONA' || sub === 'OVA' ? sub : sub.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())) : null
    return pretty ? ['Anime', pretty] : ['Anime']
  }
  if (isReadKind(t.kind)) return [t.format || KIND_LABEL[t.kind]]
  return [KIND_LABEL[t.kind]]
}
/** "1999-10-20" -> "20 Oct 1999" in the person's own locale; anything unparseable is shown as it came. */
function airDateText(d: string | null): string {
  if (!d) return ''
  const t = Date.parse(d)
  // a bare date parses as UTC midnight: format it in UTC too, or it shows the day before west of Greenwich
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : d
}
const statusText = (s?: string) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '')

type Detail = { kind: Kind; id: string; season: number; episode: number; play: boolean }
type View = { name: 'browse' } | { name: 'list' } | { name: 'shelf'; key: string; title: string }

/** The newest progress entry per title (progress is stored per episode/chapter, newest first). */
function latestPerTitle(progress: Continue[]): Continue[] {
  const seen = new Set<string>()
  return progress.filter((p) => {
    const k = `${p.kind}:${p.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

// ---- page ------------------------------------------------------------------------------------------------------------

export function Watch({ tabId, initial }: { tabId: string; initial: string }) {
  void tabId
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [tmdb, setTmdb] = useState(true)
  const [read, setRead] = useState(true)
  const [scope, setScope] = useState<Scope>('all')
  const [view, setView] = useState<View>({ name: 'browse' })
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [featured, setFeatured] = useState<Featured[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const toTop = useCallback(() => scrollParent(rootRef.current)?.scrollTo({ top: 0 }), [])

  const openDetail = useCallback((d: Detail) => {
    setDetail((cur) => {
      if (!cur) savedScroll.current = scrollParent(rootRef.current)?.scrollTop ?? 0
      return d
    })
    requestAnimationFrame(toTop)
  }, [toTop])
  const open = useCallback((c: Card, play = false) => openDetail({ kind: c.kind, id: c.id, season: 1, episode: 1, play }), [openDetail])
  const resume = useCallback((p: Continue) => openDetail({ kind: p.kind, id: p.id, season: p.season, episode: p.episode, play: true }), [openDetail])
  const closeDetail = useCallback(() => {
    setDetail(null)
    const y = savedScroll.current
    requestAnimationFrame(() => scrollParent(rootRef.current)?.scrollTo({ top: y }))
  }, [])

  const go = useCallback((s: Scope, v: View = { name: 'browse' }) => {
    setDetail(null)
    setQuery('')
    setScope(s)
    setView(v)
    requestAnimationFrame(toTop)
  }, [toTop])

  useEffect(() => {
    setEnabled(true)
    void watchApi.check().then((c) => { setEnabled(c.enabled); setTmdb(c.tmdb); setRead(c.read !== false) }).catch(() => setEnabled(false))
    void watchApi.featured().then((d) => setFeatured(d.items)).catch(() => undefined)
    const m = /^(anime|movie|tv|manga|comic|book):(.+?)(?::(\d+))?(?::(\d+))?$/.exec(initial ?? '')
    if (m) setDetail({ kind: m[1] as Kind, id: m[2], season: Number(m[3]) || 1, episode: Number(m[4]) || 1, play: false })
  }, [initial])

  // the rows of the chosen section (the server decides which; the page renders them generically)
  useEffect(() => {
    if (enabled === false) return
    let live = true
    setRows(null)
    void watchApi.home(scope).then((d) => live && setRows(d.rows)).catch(() => live && setRows([]))
    return () => { live = false }
  }, [scope, enabled])

  if (enabled === false) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-shasta-muted">
        <div><Film className="mx-auto mb-3 size-8" /><p>Watch is turned off on this server.</p></div>
      </div>
    )
  }

  const q = query.trim()
  return (
    <div ref={rootRef} className="mx-auto w-full max-w-[1600px] px-4 pb-20 sm:px-8">
      <TopNav
        scope={scope}
        view={view}
        read={read}
        query={query}
        onQuery={(v) => { setQuery(v); setDetail(null); requestAnimationFrame(toTop) }}
        onPick={(c) => open(c)}
        onScope={(s) => go(s)}
        onList={() => go(scope, { name: 'list' })}
      />

      {!tmdb && (
        <p className="mb-4 rounded-lg border border-shasta-line bg-shasta-field px-3 py-2 text-xs text-shasta-warn">Films and TV need a TMDB key on the server; films and TV rows are hidden.</p>
      )}

      {detail && (
        isReadKind(detail.kind)
          ? <ReadDetail key={`${detail.kind}:${detail.id}`} detail={detail} onBack={closeDetail} onOpen={open} onTop={toTop} />
          : <VideoDetail key={`${detail.kind}:${detail.id}`} detail={detail} onBack={closeDetail} onOpen={open} onTop={toTop} />
      )}

      {/* the page under a title stays mounted (rows, hero position) so Back returns to the same place */}
      <div hidden={!!detail}>
        {q ? (
          <SearchResults query={q} scope={scope} read={read} onOpen={open} onSearch={(v) => { setQuery(v); requestAnimationFrame(toTop) }} />
        ) : view.name === 'list' ? (
          <ListView onOpen={open} onResume={resume} />
        ) : view.name === 'shelf' ? (
          <ShelfView rowKey={view.key} title={view.title} onBack={() => go(scope)} onOpen={open} />
        ) : scope === 'all' ? (
          <HomeView
            rows={rows}
            featured={featured}
            read={read}
            onOpen={open}
            onResume={resume}
            onScope={(s) => go(s)}
            onSeeAll={(key, title) => go(scope, { name: 'shelf', key, title })}
          />
        ) : (
          <SectionView
            kind={scope}
            rows={rows}
            onOpen={open}
            onResume={resume}
            onSeeAll={(key, title) => go(scope, { name: 'shelf', key, title })}
          />
        )}
      </div>
    </div>
  )
}

// ---- top nav ---------------------------------------------------------------------------------------------------------

function TopNav({ scope, view, read, query, onQuery, onPick, onScope, onList }: {
  scope: Scope
  view: View
  read: boolean
  query: string
  onQuery: (q: string) => void
  onPick: (c: Card) => void
  onScope: (s: Scope) => void
  onList: () => void
}) {
  const listCount = useWatch((s) => s.list.length)
  const onList_ = view.name === 'list' && !query.trim()
  const item = (key: Scope, label: string) => {
    const active = scope === key && view.name !== 'list' && !query.trim()
    return (
      <button
        key={key}
        onClick={() => onScope(key)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-12 shrink-0 items-center px-2.5 text-sm transition-colors duration-150 ease-shasta sm:h-14',
          active ? 'font-medium text-shasta-fg after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-shasta-fg' : 'text-shasta-muted hover:text-shasta-fg',
        )}
      >
        {label}
      </button>
    )
  }
  return (
    <header className="sticky top-0 z-40 -mx-4 mb-6 flex flex-wrap items-center gap-x-4 border-b border-shasta-line bg-shasta-bg px-4 sm:-mx-8 sm:flex-nowrap sm:px-8">
      <button onClick={() => onScope('all')} className="flex h-14 shrink-0 items-center gap-2 text-[17px] font-medium">
        <Film className="size-[18px] text-shasta-muted" strokeWidth={1.5} /> Watch
      </button>

      <nav aria-label="Sections" className="order-3 -mx-4 flex w-[calc(100%+2rem)] items-center overflow-x-auto px-2 [scrollbar-width:none] sm:order-2 sm:mx-0 sm:w-auto sm:px-0 [&::-webkit-scrollbar]:hidden">
        {item('all', 'Home')}
        {WATCH_NAV.map((n) => item(n.key, n.label))}
        {read && <span aria-hidden className="mx-2 h-4 w-px shrink-0 bg-shasta-line" />}
        {read && READ_NAV.map((n) => item(n.key, n.label))}
      </nav>

      <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
        <SearchBox committed={query} scope={scope} onSubmit={onQuery} onOpen={onPick} />
        <button
          onClick={onList}
          aria-current={onList_ ? 'page' : undefined}
          className={cn('sh-press flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-sm', onList_ ? 'sh-selected' : 'text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg')}
        >
          <Bookmark className="size-4" />
          <span className="hidden lg:inline">My List</span>
          {listCount > 0 && <span className="sh-meta hidden lg:inline">{listCount}</span>}
        </button>
      </div>
    </header>
  )
}

// ---- home ------------------------------------------------------------------------------------------------------------

function HomeView({ rows, featured, read, onOpen, onResume, onScope, onSeeAll }: {
  rows: Row[] | null
  featured: Featured[]
  read: boolean
  onOpen: (c: Card, play?: boolean) => void
  onResume: (p: Continue) => void
  onScope: (s: Scope) => void
  onSeeAll: (key: string, title: string) => void
}) {
  const progress = useWatch((s) => s.progress)
  const list = useWatch((s) => s.list)
  const latest = useMemo(() => latestPerTitle(progress), [progress])
  const watching = useMemo(() => latest.filter((p) => !isReadKind(p.kind)), [latest])
  const reading = useMemo(() => latest.filter((p) => isReadKind(p.kind)), [latest])

  // holiday shelves come tagged with their theme as `section` and are drawn as one block while that holiday is on here
  const season = useSeasonLook()
  const theme = season?.event.theme
  const holiday = useMemo(() => (theme ? (rows ?? []).filter((r) => r.section === theme) : []), [rows, theme])
  const plain = useMemo(() => (rows ?? []).filter((r) => !r.section), [rows])
  const top = plain.find((r) => r.key === 'all:trending')
  const watchRows = plain.filter((r) => r !== top && !isReadRow(r))
  const readRows = plain.filter(isReadRow)

  const recs = useBecauseYouWatched(latest)

  return (
    <>
      {featured.length > 0 ? <Hero items={featured} onOpen={onOpen} /> : rows === null && <div className="h-[46vh] min-h-[340px] animate-pulse rounded-2xl bg-shasta-field sm:h-[58vh] sm:max-h-[640px]" />}

      <ContinueRails watching={watching} reading={reading} onResume={onResume} />

      {top && <RowSection rowKey={top.key} title="Top 10 right now" variant="top10" onOpen={onOpen} />}

      <BrowseTiles read={read} onScope={onScope} />

      <AdSlot className="mt-9" minHeight={110} />

      {list.length > 0 && (
        <section className="mt-9">
          <RowHeading title="My List" icon={<Bookmark className="size-4" />} />
          <Scroller>{list.slice(0, 20).map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={onOpen} showKind fixed />)}</Scroller>
        </section>
      )}

      {recs.because && (
        <section className="mt-9">
          <RowHeading title={`Because you watched ${recs.because.title}`} />
          <Scroller>{recs.because.items.slice(0, 18).map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={onOpen} fixed />)}</Scroller>
        </section>
      )}

      {season && holiday.length > 0 && (
        <SeasonSection place="watch" season={season} title={THEMES[season.event.theme].watch.title} subtitle={THEMES[season.event.theme].watch.subtitle}>
          {holiday.map((r) => <RowSection key={r.key} rowKey={r.key} title={r.title} onOpen={onOpen} onSeeAll={onSeeAll} />)}
        </SeasonSection>
      )}

      {rows === null ? (
        <RowsSkeleton />
      ) : (
        <>
          {watchRows.map((r) => <RowSection key={r.key} rowKey={r.key} title={r.title} onOpen={onOpen} onSeeAll={onSeeAll} showKind={r.key.startsWith('all:')} />)}

          {recs.forYou.length > 0 && (
            <section className="mt-9">
              <RowHeading title="Recommended for you" subtitle="From what you watched and read on this device" />
              <Scroller>{recs.forYou.map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={onOpen} showKind fixed />)}</Scroller>
            </section>
          )}

          {readRows.length > 0 && (
            <div className="mt-14 border-t border-shasta-line pt-8">
              <div className="flex items-end justify-between gap-4 px-1">
                <div>
                  <h2 className="sh-heading">Read</h2>
                  <p className="mt-1 text-[13px] text-shasta-muted">Manga, comics and books, read right here with your place saved on this device.</p>
                </div>
              </div>
              {readRows.map((r) => <RowSection key={r.key} rowKey={r.key} title={r.title} onOpen={onOpen} onSeeAll={onSeeAll} />)}
            </div>
          )}

          {rows.length === 0 && <p className="mt-10 text-center text-sm text-shasta-muted">No rows answered right now. Try again in a moment.</p>}
        </>
      )}
    </>
  )
}

/** "Because you watched X" + "Recommended for you", from the recommendations of the last few titles opened here. */
function useBecauseYouWatched(latest: Continue[]) {
  const [because, setBecause] = useState<{ title: string; items: Card[] } | null>(null)
  const [forYou, setForYou] = useState<Card[]>([])
  const recentKey = latest.slice(0, 3).map((p) => `${p.kind}:${p.id}`).join('|')
  useEffect(() => {
    if (!recentKey) { setBecause(null); setForYou([]); return }
    let live = true
    const recent = recentKey.split('|').map((k) => { const i = k.indexOf(':'); return { kind: k.slice(0, i) as Kind, id: k.slice(i + 1) } })
    void Promise.all(recent.map((p) => watchApi.title(p.kind, p.id).catch(() => null))).then((titles) => {
      if (!live) return
      const withRecs = titles.filter((t): t is Title => !!t && !!t.recommendations?.length)
      if (!withRecs.length) return
      const first = withRecs[0]
      const seen = new Set<string>([...recent, ...(first.recommendations ?? [])].map((c) => `${c.kind}:${c.id}`))
      const merged: Card[] = []
      for (const t of withRecs.slice(1)) for (const c of t.recommendations ?? []) {
        const k = `${c.kind}:${c.id}`
        if (seen.has(k)) continue
        seen.add(k)
        merged.push(c)
      }
      setBecause({ title: first.title, items: first.recommendations ?? [] })
      setForYou(merged.slice(0, 22))
    })
    return () => { live = false }
  }, [recentKey])
  return { because, forYou }
}

function ContinueRails({ watching, reading, onResume }: { watching: Continue[]; reading: Continue[]; onResume: (p: Continue) => void }) {
  const card = (p: Continue): Card => ({
    kind: p.kind,
    id: p.id,
    title: p.title,
    year: null,
    poster: p.poster,
    score: 0,
    subtitle: isReadKind(p.kind) ? `Chapter ${p.episode}` : p.kind === 'movie' ? undefined : `S${p.season} · E${p.episode}`,
  })
  return (
    <>
      {watching.length > 0 && (
        <section className="mt-9">
          <RowHeading title="Continue watching" icon={<Clock className="size-4" />} />
          <Scroller>
            {watching.slice(0, 14).map((p) => (
              <MediaCard key={`${p.kind}:${p.id}`} card={card(p)} progress={p.duration ? p.position / p.duration : 0} onOpen={() => onResume(p)} fixed />
            ))}
          </Scroller>
        </section>
      )}
      {reading.length > 0 && (
        <section className="mt-9">
          <RowHeading title="Continue reading" icon={<BookOpen className="size-4" />} />
          <Scroller>
            {reading.slice(0, 14).map((p) => (
              <MediaCard key={`${p.kind}:${p.id}`} card={card(p)} progress={p.duration ? p.episode / p.duration : 0} onOpen={() => onResume(p)} fixed />
            ))}
          </Scroller>
        </section>
      )}
    </>
  )
}

function BrowseTiles({ read, onScope }: { read: boolean; onScope: (s: Scope) => void }) {
  const tiles = TILES.filter((t) => read || !isReadKind(t.scope))
  return (
    <section className="mt-9">
      <RowHeading title="Browse" />
      <div className="grid grid-cols-2 gap-3 px-1 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => <BrowseTile key={t.scope} tile={t} onPick={() => onScope(t.scope)} />)}
      </div>
    </section>
  )
}

function BrowseTile({ tile, onPick }: { tile: (typeof TILES)[number]; onPick: () => void }) {
  const { items } = useFirstFilledRow(tile.from)
  const covers = (items ?? []).filter((c) => c.kind === tile.scope && c.poster).slice(0, 3)
  const Icon = typeIcon(tile.scope)
  return (
    <button
      onClick={onPick}
      className="group/tile relative flex h-40 overflow-hidden rounded-xl bg-shasta-field p-4 text-left ring-1 ring-shasta-line transition-shadow duration-150 ease-shasta hover:ring-shasta-fg/25"
    >
      <span className="relative z-10 flex max-w-[60%] flex-col">
        <span className="flex items-center gap-1.5 text-[15px] font-medium"><Icon className="size-4 text-shasta-muted" strokeWidth={1.75} /> {SECTION_LABEL[tile.scope]}</span>
        <span className="mt-1 text-xs leading-4 text-shasta-muted">{tile.line}</span>
      </span>
      {/* a small fan of real covers from the section */}
      <span aria-hidden className="absolute -bottom-3 right-3 h-24 w-28">
        {covers.map((c, i) => (
          <img
            key={c.id}
            src={artUrl(c.poster)}
            crossOrigin={MEDIA_CORS}
            loading="lazy"
            alt=""
            style={{ zIndex: 3 - i }}
            className={cn(
              'absolute bottom-0 aspect-[2/3] h-[88px] rounded-md object-cover shadow-[0_6px_16px_rgb(0_0_0/0.35)] ring-1 ring-black/10 transition-transform duration-200 ease-shasta',
              i === 0 && 'right-0 rotate-[4deg] group-hover/tile:-translate-y-1 group-hover/tile:rotate-[6deg]',
              i === 1 && 'right-6 -rotate-[3deg] group-hover/tile:-rotate-[6deg]',
              i === 2 && 'right-12 -rotate-[9deg] group-hover/tile:-translate-x-1 group-hover/tile:-rotate-[12deg]',
            )}
          />
        ))}
      </span>
    </button>
  )
}

function RowsSkeleton() {
  return (
    <div className="mt-9 space-y-10">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i}>
          <div className="mb-3 h-4 w-40 animate-pulse rounded bg-shasta-field" />
          <div className="flex gap-3 overflow-hidden">{Array.from({ length: 8 }, (_, j) => <SkeletonCard key={j} />)}</div>
        </div>
      ))}
    </div>
  )
}

// ---- a section (Films, TV, Anime, Manga, Comics, Books) -------------------------------------------------------------

function SectionView({ kind, rows, onOpen, onResume, onSeeAll }: {
  kind: Kind
  rows: Row[] | null
  onOpen: (c: Card, play?: boolean) => void
  onResume: (p: Continue) => void
  onSeeAll: (key: string, title: string) => void
}) {
  const progress = useWatch((s) => s.progress)
  const mine = useMemo(() => latestPerTitle(progress).filter((p) => p.kind === kind), [progress, kind])
  const plain = useMemo(() => (rows ?? []).filter((r) => !r.section), [rows])
  // the hero comes from the section's first shelf after "Trending" (Trending is the Top 10 right below) that has titles
  const heroKeys = useMemo(() => {
    const keys = plain.map((r) => r.key)
    return plain[0] && isTrending(plain[0]) && keys.length > 1 ? [...keys.slice(1), keys[0]] : keys
  }, [plain])
  const { key: heroKey, items: heroItems, done: heroDone } = useFirstFilledRow(heroKeys)
  const heroTitle = plain.find((r) => r.key === heroKey)?.title ?? ''
  const hero = useMemo(() => (heroItems ? featuredFromRow(heroItems, heroTitle) : []), [heroItems, heroTitle])

  return (
    <>
      {hero.length > 0 ? (
        <Hero items={hero} onOpen={onOpen} />
      ) : rows === null || !heroDone ? (
        <div className="h-[46vh] min-h-[340px] animate-pulse rounded-2xl bg-shasta-field sm:h-[58vh] sm:max-h-[640px]" />
      ) : (
        <h1 className="sh-title px-1">{SECTION_LABEL[kind]}</h1>
      )}

      <ContinueRails watching={isReadKind(kind) ? [] : mine} reading={isReadKind(kind) ? mine : []} onResume={onResume} />

      {rows === null ? (
        <RowsSkeleton />
      ) : plain.length === 0 ? (
        <p className="mt-10 text-center text-sm text-shasta-muted">Nothing answered for {SECTION_LABEL[kind]} right now. Try again in a moment.</p>
      ) : (
        plain.map((r, i) => (
          <div key={r.key}>
            {i === 0 && isTrending(r)
              ? <RowSection rowKey={r.key} title={`Top 10 in ${SECTION_LABEL[kind]}`} variant="top10" onOpen={onOpen} />
              : <RowSection rowKey={r.key} title={r.title} onOpen={onOpen} onSeeAll={onSeeAll} />}
            {i === 1 && <AdSlot className="mt-9" minHeight={110} />}
          </div>
        ))
      )}
    </>
  )
}

// ---- "See all", My List, search --------------------------------------------------------------------------------------

function ShelfView({ rowKey, title, onBack, onOpen }: { rowKey: string; title: string; onBack: () => void; onOpen: (c: Card, play?: boolean) => void }) {
  const { items, failed } = useRow(rowKey)
  return (
    <section>
      <BackButton onClick={onBack} />
      <h1 className="sh-title mb-6 px-1">{title}</h1>
      {failed ? <p className="text-sm text-shasta-muted">This shelf did not answer. Try again in a moment.</p>
        : !items ? <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-shasta-muted" /></div>
        : <CardGrid cards={items} onOpen={onOpen} showKind={rowKey.startsWith('all:')} />}
    </section>
  )
}

function ListView({ onOpen, onResume }: { onOpen: (c: Card, play?: boolean) => void; onResume: (p: Continue) => void }) {
  const list = useWatch((s) => s.list)
  const progress = useWatch((s) => s.progress)
  const clearProgress = useWatch((s) => s.clearProgress)
  const [filter, setFilter] = useState<'all' | 'watch' | 'read'>('all')
  const shown = list.filter((c) => filter === 'all' || (filter === 'read') === isReadKind(c.kind))
  const history = useMemo(() => latestPerTitle(progress), [progress])
  const counts = { all: list.length, watch: list.filter((c) => !isReadKind(c.kind)).length, read: list.filter((c) => isReadKind(c.kind)).length }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="sh-title">My List</h1>
          <p className="mt-1 text-[13px] text-shasta-muted">Saved on this device only. Add a title with + on its poster or page.</p>
        </div>
        <div className="flex rounded-[10px] bg-shasta-field p-0.5">
          {(['all', 'watch', 'read'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cn('flex h-7 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-[color,background-color,box-shadow] duration-150 ease-shasta', filter === f ? 'sh-selected' : 'text-shasta-muted hover:text-shasta-fg')}>
              {f === 'all' ? 'Everything' : f === 'watch' ? 'To watch' : 'To read'} <span className="sh-meta">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {shown.length > 0 ? (
          <CardGrid cards={shown} onOpen={onOpen} showKind />
        ) : (
          <div className="grid place-items-center rounded-xl border border-dashed border-shasta-line py-16 text-center">
            <Library className="mb-3 size-6 text-shasta-faint" />
            <p className="text-sm text-shasta-muted">{list.length ? 'Nothing here in this filter.' : 'Your list is empty.'}</p>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-14">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="flex items-center gap-2 text-base font-medium"><Clock className="size-4 text-shasta-faint" /> History</h2>
            <button onClick={clearProgress} className="flex items-center gap-1 text-[13px] text-shasta-muted hover:text-shasta-fg"><Trash2 className="size-3.5" /> Clear history</button>
          </div>
          <Scroller>
            {history.slice(0, 30).map((p) => (
              <MediaCard
                key={`${p.kind}:${p.id}`}
                card={{ kind: p.kind, id: p.id, title: p.title, year: null, poster: p.poster, score: 0, subtitle: isReadKind(p.kind) ? `Chapter ${p.episode}` : p.kind === 'movie' ? undefined : `S${p.season} · E${p.episode}` }}
                progress={isReadKind(p.kind) ? (p.duration ? p.episode / p.duration : 0) : p.duration ? p.position / p.duration : 0}
                onOpen={() => onResume(p)}
                showKind
                fixed
              />
            ))}
          </Scroller>
        </div>
      )}
    </section>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cn('flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] transition-[color,background-color,box-shadow] duration-150 ease-shasta', on ? 'sh-selected' : 'bg-shasta-field text-shasta-muted hover:text-shasta-fg')}>
      {children}
    </button>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative z-10 -ml-2 mb-4 flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-shasta-muted transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg">
      <ArrowLeft className="size-4" /> Back
    </button>
  )
}

// ---- title pages -----------------------------------------------------------------------------------------------------

/** The top of a title page: its backdrop (or blurred cover), cover, facts, overview and actions. */
function TitleHeader({ title, compact, facts, actions }: { title: Title; compact?: boolean; facts: (string | ReactNode | null | false | undefined)[]; actions: ReactNode }) {
  const [more, setMore] = useState(false)
  const art = title.backdrop || title.poster
  const long = (title.overview?.length ?? 0) > 320
  return (
    <section className={cn('relative', !compact && '-mx-4 -mt-[4.5rem] sm:-mx-8')}>
      {!compact && art && (
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          <img src={artUrl(art)} crossOrigin={MEDIA_CORS} alt="" className={cn('size-full object-cover', title.backdrop ? 'opacity-50' : 'scale-110 opacity-40 blur-2xl')} />
          <div className="absolute inset-0 bg-gradient-to-t from-shasta-bg via-shasta-bg/75 to-shasta-bg/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-shasta-bg via-shasta-bg/45 to-transparent" />
        </div>
      )}
      <div className={cn('relative flex items-end gap-6 sm:gap-8', compact ? 'pt-6' : 'px-4 pb-6 pt-24 sm:px-8 sm:pt-40')}>
        {title.poster && (
          <img src={artUrl(title.poster)} crossOrigin={MEDIA_CORS} alt="" className={cn('hidden shrink-0 rounded-xl shadow-[0_16px_40px_rgb(0_0_0/0.35)] ring-1 ring-shasta-line sm:block', compact ? 'w-32' : 'w-44 lg:w-52')} />
        )}
        <div className="min-w-0 flex-1 pb-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-shasta-muted">
            {facts.filter(Boolean).map((f, i) => (
              <span key={i} className="flex items-center gap-2">{i > 0 && <span className="text-shasta-faint">·</span>}{f}</span>
            ))}
          </p>
          <h1 className={cn('mt-2 line-clamp-3 font-medium tracking-[-0.02em]', compact ? 'text-2xl leading-8' : 'text-[32px] leading-[1.1] sm:text-[44px]')}>{title.title}</h1>
          {title.genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {title.genres.slice(0, 6).map((g) => <span key={g} className="rounded-md bg-shasta-field/80 px-2 py-0.5 text-xs text-shasta-muted ring-1 ring-shasta-line">{g}</span>)}
            </div>
          )}
          {title.overview && (
            <p className={cn('mt-4 max-w-3xl whitespace-pre-line text-sm leading-6 text-shasta-muted', !more && 'line-clamp-4')}>
              {title.overview}
            </p>
          )}
          {long && <button onClick={() => setMore((m) => !m)} className="mt-1 text-[13px] text-shasta-fg underline-offset-2 hover:underline">{more ? 'Less' : 'More'}</button>}
          {title.studio && <p className="mt-2 text-xs text-shasta-faint">Studio · {title.studio}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </div>
    </section>
  )
}

function ListButton({ title }: { title: Title }) {
  const inList = useWatch((s) => s.inList(title.kind, title.id))
  const toggleList = useWatch((s) => s.toggleList)
  return (
    <button onClick={() => void toggleList(title)} className={cn('sh-press flex h-10 items-center gap-1.5 rounded-[10px] px-4 text-sm', inList ? 'sh-selected' : 'bg-shasta-field ring-1 ring-shasta-line hover:bg-shasta-raised')}>
      <Plus className={cn('size-4 transition-transform duration-150 ease-shasta', inList && 'rotate-45')} /> {inList ? 'In My List' : 'My List'}
    </button>
  )
}

const primaryBtn = 'sh-press flex h-10 items-center gap-2 rounded-[10px] bg-shasta-accent px-5 text-sm font-medium text-shasta-accent-fg hover:brightness-110 disabled:opacity-60'
const secondaryBtn = 'sh-press flex h-10 items-center gap-1.5 rounded-[10px] bg-shasta-field px-4 text-sm ring-1 ring-shasta-line hover:bg-shasta-raised'

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  if (tabs.length === 0) return null
  return (
    <div role="tablist" className="mt-8 flex gap-1 border-b border-shasta-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn('relative h-10 px-3 text-sm transition-colors duration-150 ease-shasta', value === t.key ? 'font-medium text-shasta-fg after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-shasta-fg' : 'text-shasta-muted hover:text-shasta-fg')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Long lists (One Piece, a 1,000-chapter manga) are split into ranges so the page stays light. */
function useRanges<T extends { number: number }>(items: T[], size: number, current: number) {
  const ranges = useMemo(() => {
    const out: { from: number; to: number; items: T[] }[] = []
    for (let i = 0; i < items.length; i += size) {
      const chunk = items.slice(i, i + size)
      out.push({ from: chunk[0].number, to: chunk[chunk.length - 1].number, items: chunk })
    }
    return out
  }, [items, size])
  const [pick, setPick] = useState<number | null>(null)
  const auto = Math.max(0, ranges.findIndex((r) => r.items.some((e) => e.number === current)))
  const idx = pick ?? auto
  return { ranges, idx: Math.min(idx, Math.max(0, ranges.length - 1)), setIdx: setPick }
}

function RangePicker({ ranges, idx, onPick }: { ranges: { from: number; to: number }[]; idx: number; onPick: (i: number) => void }) {
  if (ranges.length < 2) return null
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ranges.map((r, i) => (
        <Chip key={i} on={i === idx} onClick={() => onPick(i)}><span className="font-mono tabular-nums">{r.from}–{r.to}</span></Chip>
      ))}
    </div>
  )
}

function MoreLikeThis({ title, onOpen }: { title: Title; onOpen: (c: Card, play?: boolean) => void }) {
  if (!title.recommendations?.length) return null
  return <div className="mt-6"><CardGrid cards={title.recommendations} onOpen={onOpen} showKind /></div>
}

function CastGrid({ title }: { title: Title }) {
  if (!title.cast?.length) return null
  return (
    <div className="mt-6 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
      {title.cast.map((p, i) => (
        <div key={i} className="text-center">
          {p.image ? <img src={artUrl(p.image)} crossOrigin={MEDIA_CORS} alt="" loading="lazy" className="mx-auto size-20 rounded-full object-cover ring-1 ring-shasta-line" /> : <span className="mx-auto grid size-20 place-items-center rounded-full bg-shasta-field text-lg text-shasta-muted">{p.name.slice(0, 1)}</span>}
          <p className="mt-2 line-clamp-2 text-xs">{p.name}</p>
          <p className="line-clamp-2 text-[11px] text-shasta-faint">{p.role}</p>
        </div>
      ))}
    </div>
  )
}

function Trailer({ videoKey, onClose }: { videoKey: string; onClose: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const url = `https://www.youtube.com/embed/${videoKey}?autoplay=1&rel=0`
    if (!proxy.isReady()) { el.src = url; return }
    const id = proxy.proxySubFrame(el, url)
    return () => proxy.releaseSubFrame(id)
  }, [videoKey])
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <iframe ref={ref} title="Trailer" className="size-full border-0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" />
      <button onClick={onClose} aria-label="Close trailer" className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"><X className="size-4" /></button>
    </div>
  )
}

// ---- film / series / anime page --------------------------------------------------------------------------------------

function VideoDetail({ detail, onBack, onOpen, onTop }: { detail: Detail; onBack: () => void; onOpen: (c: Card, play?: boolean) => void; onTop: () => void }) {
  const [title, setTitle] = useState<Title | null>(null)
  const [sources, setSources] = useState<Candidate[]>([])
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [season, setSeason] = useState(detail.season)
  const [episode, setEpisode] = useState(detail.episode)
  const [playing, setPlaying] = useState(detail.play)
  const [showTrailer, setShowTrailer] = useState(false)
  const [tab, setTab] = useState<'episodes' | 'more' | 'cast'>('episodes')
  // which title the entry's own season has already been seeded for (so a later explicit season pick is respected)
  const seededFor = useRef('')
  const progressFor = useWatch((s) => s.progressFor)
  const setProgress = useWatch((s) => s.setProgress)
  const last = useWatch((s) => s.progress.find((p) => p.kind === detail.kind && p.id === detail.id))

  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setSources([]); setCandidate(null)
    void (async () => {
      try {
        const key = `${detail.kind}:${detail.id}`
        const firstOpen = seededFor.current !== key
        // on first open omit a default season-1 so the server hands back the entry's OWN season (a split AniList
        // entry like "… 2" is season 2), but pass any real season pick straight through
        const passSeason = detail.kind !== 'movie' && (!firstOpen || season > 1)
        const t = await watchApi.title(detail.kind, detail.id, passSeason ? season : undefined)
        if (!live) return
        // a split entry is really season N of its show: open that season so metadata and the stream stay 1:1
        let useSeason = season
        if (firstOpen) {
          seededFor.current = key
          const seed = detail.kind !== 'movie' && t.defaultSeason && t.defaultSeason > 1 ? t.defaultSeason : season
          if (seed !== season) { setSeason(seed); setEpisode(1) }
          useSeason = seed
        }
        setTitle(t)
        const s = await watchApi.sources(detail.kind, detail.id, { season: useSeason, episode })
        if (!live) return
        setSources(s.sources)
        setCandidate(s.sources[0] ?? null)
      } catch (e) {
        if (live) setError(e instanceof WatchError ? e.message : 'Could not load this title.')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [detail.kind, detail.id, season, episode])

  const maxEpisode = useMemo(() => (title?.episodes?.length ? Math.max(...title.episodes.map((e) => e.number)) : title?.totalEpisodes ?? 1), [title])
  const hasNext = episode < maxEpisode
  const isSeries = !!title && title.kind !== 'movie' && (title.totalEpisodes ?? title.episodes?.length ?? 0) > 1
  const startAt = title ? progressFor(detail.kind, detail.id, episode)?.position ?? 0 : 0

  const onProgress = useCallback((position: number, duration: number) => {
    if (title) setProgress({ kind: title.kind, id: title.id, season, episode, title: title.title, poster: title.poster, position, duration })
  }, [title, season, episode, setProgress])

  const play = (s = season, e = episode) => {
    if (s !== season) setSeason(s)
    if (e !== episode) setEpisode(e)
    setShowTrailer(false)
    setPlaying(true)
    onTop()
  }

  const tabs = title ? ([
    isSeries && title.episodes?.length ? { key: 'episodes' as const, label: 'Episodes' } : null,
    title.recommendations?.length ? { key: 'more' as const, label: 'More like this' } : null,
    title.cast?.length ? { key: 'cast' as const, label: 'Cast & crew' } : null,
  ].filter(Boolean) as { key: 'episodes' | 'more' | 'cast'; label: string }[]) : []
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key

  const resumeLabel = last && (last.duration ? last.position / last.duration < 0.95 : true)
    ? (title?.kind === 'movie' ? 'Resume' : `Resume S${last.season} · E${last.episode}`)
    : null

  return (
    <div>
      <BackButton onClick={onBack} />

      {loading && !title && <div className="grid h-60 place-items-center"><Loader2 className="size-6 animate-spin text-shasta-muted" /></div>}
      {error && !title && <p className="text-sm text-shasta-warn">{error}</p>}

      {title && (
        <>
          {showTrailer && title.trailer && <Trailer videoKey={title.trailer.key} onClose={() => setShowTrailer(false)} />}

          {playing && !showTrailer && (
            candidate ? (
              <>
                <Player
                  candidate={candidate}
                  candidates={sources}
                  title={title.title}
                  sub={isSeries ? [`S${season} · E${episode}`, title.episodes?.find((e) => e.number === episode)?.title].filter(Boolean).join(' · ') : undefined}
                  poster={title.backdrop ?? title.poster ?? null}
                  startAt={startAt}
                  nextLabel={hasNext ? 'Next episode' : undefined}
                  onPickSource={setCandidate}
                  onProgress={onProgress}
                  onNext={hasNext ? () => setEpisode((e) => e + 1) : undefined}
                  onClose={() => setPlaying(false)}
                  onFailed={(c) => { if (sources.length < 2) return; const i = sources.findIndex((s) => s.id === c.id); const n = sources[(i + 1) % sources.length]; if (n && n.id !== c.id) setCandidate(n) }}
                />
                {sources.length > 1 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-shasta-faint">Source</span>
                    {sources.map((s) => <Chip key={s.id} on={s.id === candidate.id} onClick={() => setCandidate(s)}>{s.label}</Chip>)}
                  </div>
                )}
              </>
            ) : (
              <SourceWait>
                {/* the title's own art, dimmed, so the wait reads as this title loading rather than a dead black box */}
                {(title.backdrop || title.poster) && (
                  <img src={artUrl(title.backdrop || title.poster)} crossOrigin={MEDIA_CORS} alt="" aria-hidden className={cn('absolute inset-0 size-full object-cover', title.backdrop ? 'opacity-30' : 'scale-110 opacity-25 blur-2xl')} />
                )}
                <div className="relative px-6 text-center">
                  <p className="text-base font-medium text-white">{title.title}</p>
                  {isSeries && <p className="mt-0.5 text-[13px] text-white/60">S{season} · E{episode}{title.episodes?.find((e) => e.number === episode)?.title ? ` · ${title.episodes.find((e) => e.number === episode)!.title}` : ''}</p>}
                  {loading ? <p className="mt-4 flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Finding a source…</p>
                    : <p className="mt-4">No playable source answered right now.{title.trailer && <> <button className="underline underline-offset-2" onClick={() => setShowTrailer(true)}>Watch the trailer</button></>}</p>}
                  {!loading && <button onClick={() => setPlaying(false)} className="mt-3 rounded-lg bg-white/15 px-3 py-1.5 text-[13px] text-white hover:bg-white/25">Back to the title</button>}
                </div>
              </SourceWait>
            )
          )}

          <TitleHeader
            title={title}
            compact={playing || showTrailer}
            facts={[
              ...kindFacts(title),
              title.year ? String(title.year) : null,
              title.runtime ? `${title.runtime} min` : null,
              isSeries && title.totalEpisodes ? `${title.totalEpisodes} episodes` : null,
              title.rating ? <span key="rating" className="flex items-center gap-1 tabular-nums text-amber-500 dark:text-amber-300"><Star className="size-3.5 fill-current" /> {title.rating}%</span> : null,
              statusText(title.status),
            ]}
            actions={
              <>
                {resumeLabel && last ? (
                  <button onClick={() => play(last.season, last.episode)} className={primaryBtn}><Play className="size-4 fill-current" /> {resumeLabel}</button>
                ) : (
                  <button onClick={() => play()} className={primaryBtn}><Play className="size-4 fill-current" /> {isSeries ? `Play S${season} · E${episode}` : 'Play'}</button>
                )}
                {title.trailer && <button onClick={() => { setShowTrailer(true); setPlaying(false); onTop() }} className={secondaryBtn}><Film className="size-4" /> Trailer</button>}
                <ListButton title={title} />
                {last && (
                  <button onClick={() => useWatch.getState().removeProgress(last.kind, last.id, last.episode)} className="ml-1 flex items-center gap-1 text-xs text-shasta-muted hover:text-shasta-fg">
                    <Trash2 className="size-3" /> Remove from Continue watching
                  </button>
                )}
              </>
            }
          />

          <Tabs tabs={tabs} value={activeTab ?? 'episodes'} onChange={setTab} />

          {activeTab === 'episodes' && (
            <EpisodePanel title={title} season={season} episode={episode} onSeason={(s) => { setSeason(s); setEpisode(1) }} onPlay={(e) => play(season, e)} />
          )}
          {activeTab === 'more' && <MoreLikeThis title={title} onOpen={onOpen} />}
          {activeTab === 'cast' && <CastGrid title={title} />}
        </>
      )}
    </div>
  )
}

/** The player-sized box shown while a source is found (or when none answers), capped like the Player itself. */
function SourceWait({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const max = useFitHeight(ref)
  return (
    <div ref={ref} style={{ maxHeight: max }} className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl bg-black text-sm text-white/75">
      {children}
    </div>
  )
}

function EpisodePanel({ title, season, episode, onSeason, onPlay }: { title: Title; season: number; episode: number; onSeason: (s: number) => void; onPlay: (e: number) => void }) {
  const progressFor = useWatch((s) => s.progressFor)
  const episodes = title.episodes ?? []
  const { ranges, idx, setIdx } = useRanges(episodes, 50, episode)
  return (
    <div className="mt-6">
      {title.seasons && title.seasons.length > 1 && (
        // a handful of seasons fit as chips; a long run (One Piece has 30+ arcs) gets one picker, like a TV app
        title.seasons.length <= 6 ? (
          <div className="mb-4 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {title.seasons.map((s) => (
              <Chip key={s.number} on={s.number === season} onClick={() => onSeason(s.number)}>{s.name}</Chip>
            ))}
          </div>
        ) : (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="relative flex max-w-full items-center">
              <span className="sr-only">Season</span>
              <select
                value={season}
                onChange={(e) => onSeason(Number(e.target.value))}
                className="h-9 w-72 max-w-full appearance-none truncate rounded-[10px] bg-shasta-field pl-3 pr-9 text-sm font-medium text-shasta-fg ring-1 ring-shasta-line outline-none hover:bg-shasta-raised focus-visible:ring-2 focus-visible:ring-shasta-accent"
              >
                {title.seasons.map((s) => (
                  <option key={s.number} value={s.number}>{s.name}{s.episodes ? ` (${s.episodes})` : ''}</option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-4 text-shasta-muted" />
            </label>
            <span className="sh-meta text-shasta-faint">{title.seasons.findIndex((s) => s.number === season) + 1} of {title.seasons.length}</span>
          </div>
        )
      )}
      <RangePicker ranges={ranges} idx={idx} onPick={setIdx} />
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {(ranges[idx]?.items ?? []).map((e) => {
          const p = progressFor(title.kind, title.id, e.number)
          const current = e.number === episode
          const watched = !!p && !!p.duration && p.position / p.duration >= 0.9
          return (
            <button
              key={e.number}
              onClick={() => onPlay(e.number)}
              className={cn('group/ep flex items-start gap-3 rounded-xl p-2 text-left transition-colors duration-150 ease-shasta', current ? 'sh-selected' : 'hover:bg-shasta-field')}
            >
              <span className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-shasta-field ring-1 ring-shasta-line sm:w-44">
                {e.still ? <img src={artUrl(e.still)} crossOrigin={MEDIA_CORS} alt="" loading="lazy" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-shasta-faint"><TvIcon className="size-5" /></span>}
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-150 ease-shasta group-hover/ep:opacity-100"><Play className="size-6 fill-white text-white" /></span>
                {p && <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50"><span className="block h-full bg-shasta-accent" style={{ width: `${p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0}%` }} /></span>}
              </span>
              <span className="min-w-0 flex-1 py-0.5">
                <span className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-mono text-shasta-faint tabular-nums">{e.number}</span>
                  <span className="truncate font-medium">{e.title || `Episode ${e.number}`}</span>
                </span>
                {e.overview && <span className="mt-1 line-clamp-2 block text-xs leading-5 text-shasta-muted">{e.overview}</span>}
                {(e.airDate || watched) && (
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-shasta-faint">
                    {e.airDate && <span>{airDateText(e.airDate)}</span>}
                    {watched && <span className="flex items-center gap-1 text-shasta-muted"><Check className="size-3" /> Watched</span>}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- manga / comic / book page ---------------------------------------------------------------------------------------

function ReadDetail({ detail, onBack, onOpen, onTop }: { detail: Detail; onBack: () => void; onOpen: (c: Card, play?: boolean) => void; onTop: () => void }) {
  const [title, setTitle] = useState<Title | null>(null)
  const [chapter, setChapter] = useState(detail.episode || 1)
  const [reading, setReading] = useState(detail.play)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'chapters' | 'more'>('chapters')
  const seeded = useRef('')
  const setProgress = useWatch((s) => s.setProgress)
  const progressFor = useWatch((s) => s.progressFor)
  const last = useWatch((s) => s.progress.find((p) => p.kind === detail.kind && p.id === detail.id))

  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setTitle(null)
    watchApi.title(detail.kind, detail.id)
      .then((t) => {
        if (!live) return
        setTitle(t)
        // resume the last chapter read on this device
        if (seeded.current !== `${t.kind}:${t.id}`) {
          seeded.current = `${t.kind}:${t.id}`
          const lastRead = useWatch.getState().progress.find((p) => p.kind === t.kind && p.id === t.id)
          if (detail.episode <= 1 && lastRead?.episode) setChapter(lastRead.episode)
        }
      })
      .catch((e) => { if (live) setError(e instanceof WatchError ? e.message : 'Could not load this title.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.kind, detail.id])

  const onProgress = useCallback((ch: number, page: number) => {
    if (title) setProgress({ kind: title.kind, id: title.id, season: 1, episode: ch, title: title.title, poster: title.poster, position: page, duration: title.episodes?.length ?? 0, chapter: ch, page })
  }, [title, setProgress])

  const chapters = title?.episodes ?? []
  const read = (n: number) => { setChapter(n); setReading(true); onTop() }

  const tabs = title ? ([
    chapters.length ? { key: 'chapters' as const, label: 'Chapters' } : null,
    title.recommendations?.length ? { key: 'more' as const, label: 'More like this' } : null,
  ].filter(Boolean) as { key: 'chapters' | 'more'; label: string }[]) : []
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key

  return (
    <div>
      <BackButton onClick={onBack} />

      {loading && !title && <div className="grid h-60 place-items-center"><Loader2 className="size-6 animate-spin text-shasta-muted" /></div>}
      {error && <p className="text-sm text-shasta-warn">{error}</p>}

      {title && (
        <>
          {reading && chapters.length > 0 && (
            <Reader title={title} chapter={chapter} startPage={progressFor(title.kind, title.id, chapter)?.page ?? 1} onChapter={(n) => setChapter(n)} onClose={() => setReading(false)} onProgress={onProgress} />
          )}

          <TitleHeader
            title={title}
            compact={reading && chapters.length > 0}
            facts={[
              ...kindFacts(title),
              title.year ? String(title.year) : null,
              chapters.length ? `${chapters.length} chapters` : null,
              title.rating ? <span key="rating" className="flex items-center gap-1 tabular-nums text-amber-500 dark:text-amber-300"><Star className="size-3.5 fill-current" /> {title.rating}%</span> : null,
              statusText(title.status),
            ]}
            actions={
              chapters.length > 0 ? (
                <>
                  {last ? (
                    <button onClick={() => read(last.episode)} className={primaryBtn}><BookOpen className="size-4" /> Continue · Chapter {last.episode}</button>
                  ) : (
                    <button onClick={() => read(chapters[0].number)} className={primaryBtn}><BookOpen className="size-4" /> Start reading</button>
                  )}
                  <ListButton title={title} />
                </>
              ) : (
                <>
                  <span className="rounded-[10px] bg-shasta-field px-3 py-2 text-[13px] text-shasta-muted ring-1 ring-shasta-line">No readable chapters answered right now. The source may be down.</span>
                  <ListButton title={title} />
                </>
              )
            }
          />

          <Tabs tabs={tabs} value={activeTab ?? 'chapters'} onChange={setTab} />
          {activeTab === 'chapters' && <ChapterPanel title={title} chapter={chapter} onRead={read} />}
          {activeTab === 'more' && <MoreLikeThis title={title} onOpen={onOpen} />}
        </>
      )}
    </div>
  )
}

function ChapterPanel({ title, chapter, onRead }: { title: Title; chapter: number; onRead: (n: number) => void }) {
  const progressFor = useWatch((s) => s.progressFor)
  const [newestFirst, setNewestFirst] = useState(false)
  const all = title.episodes ?? []
  const { ranges, idx, setIdx } = useRanges(all, 100, chapter)
  const items = ranges[idx]?.items ?? []
  const shown = newestFirst ? [...items].reverse() : items
  return (
    <div className="mt-6">
      <div className="flex items-start justify-between gap-3">
        <RangePicker ranges={ranges} idx={idx} onPick={setIdx} />
        <button onClick={() => setNewestFirst((v) => !v)} className="ml-auto h-7 shrink-0 rounded-lg px-2.5 text-[13px] text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
          {newestFirst ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((e) => {
          const p = progressFor(title.kind, title.id, e.number)
          return (
            <button
              key={e.number}
              onClick={() => onRead(e.number)}
              className={cn('flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[13px] transition-colors duration-150 ease-shasta', e.number === chapter ? 'sh-selected' : 'hover:bg-shasta-field')}
            >
              <span className="w-10 shrink-0 font-mono text-shasta-faint tabular-nums">{e.number}</span>
              <span className={cn('min-w-0 flex-1 truncate', p && e.number !== chapter && 'text-shasta-muted')}>{e.title || `Chapter ${e.number}`}</span>
              {p ? <span className="shrink-0 text-[11px] text-shasta-faint">Read</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
