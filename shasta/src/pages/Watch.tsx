// Shasta Watch (shasta://watch): a Netflix/Crunchyroll-style discovery experience built entirely from live API data —
// a featured hero, lazy discovery rows, search, My List and Continue watching. Rows come from the server registry
// (/api/watch/home), and playback uses the existing Watch player + proxied sources.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Clock, Film, ListVideo, Loader2, Play, Plus, RotateCcw, Search, Star, Trash2, Tv as TvIcon, X } from 'lucide-react'
import { MEDIA_CORS } from '@/lib/appApi'
import * as proxy from '@/proxy/scramjetAdapter'
import { artUrl, watchApi, WatchError } from '@/watch/api'
import { Hero, MediaCard, RowSection, Scroller, SkeletonCard } from '@/watch/components'
import { Player } from '@/watch/Player'
import { useWatch } from '@/watch/store'
import type { Candidate, Card, Featured, Kind, Row, Scope, Title } from '@/watch/types'
import { cn } from '@/lib/utils'
import { AdSlot } from '@/components/ads/AdSlot'
import { useHalloweenLook } from '@/lib/seasonal'
import { HalloweenSection } from '@/components/seasonal/Halloween'

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'anime', label: 'Anime' },
  { key: 'movie', label: 'Films' },
  { key: 'tv', label: 'TV' },
]

export function Watch({ tabId, initial }: { tabId: string; initial: string }) {
  void tabId
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [tmdb, setTmdb] = useState(true)
  const [scope, setScope] = useState<Scope>('all')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [featured, setFeatured] = useState<Featured[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)
  // seasonal shelves come from the server tagged with a section; they are drawn as one block, and only while it is
  // still Halloween here (the server drops them a little later, on its own clock)
  const halloween = useHalloweenLook()
  const spooky = useMemo(() => (halloween ? (rows ?? []).filter((r) => r.section === 'halloween') : []), [rows, halloween])
  const plainRows = useMemo(() => (rows ?? []).filter((r) => !r.section), [rows])
  const [detail, setDetail] = useState<{ kind: Kind; id: string; season: number; episode: number; play: boolean } | null>(null)

  const progress = useWatch((s) => s.progress)
  const list = useWatch((s) => s.list)
  const [becauseRecs, setBecauseRecs] = useState<{ title: string; items: Card[] } | null>(null)
  const [forYou, setForYou] = useState<Card[]>([])

  const open = useCallback((c: Card, play = false) => setDetail({ kind: c.kind, id: c.id, season: 1, episode: 1, play }), [])

  useEffect(() => {
    setEnabled(true)
    void watchApi.check().then((c) => { setEnabled(c.enabled); setTmdb(c.tmdb) }).catch(() => setEnabled(false))
    void watchApi.featured().then((d) => setFeatured(d.items)).catch(() => undefined)
    const m = /^(anime|movie|tv):([A-Za-z0-9-]+)(?::(\d+))?(?::(\d+))?$/.exec(initial ?? '')
    if (m) setDetail({ kind: m[1] as Kind, id: m[2], season: Number(m[3]) || 1, episode: Number(m[4]) || 1, play: false })
  }, [initial])

  // discovery rows for the chosen scope (server decides which; client renders generically)
  useEffect(() => {
    if (enabled === false) return
    let live = true
    setRows(null)
    void watchApi.home(scope).then((d) => live && setRows(d.rows)).catch(() => live && setRows([]))
    return () => { live = false }
  }, [scope, enabled])

  // debounced search
  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); setSearchError(''); return }
    setSearching(true)
    setSearchError('')
    const ctl = new AbortController()
    const t = setTimeout(() => {
      watchApi.search(q, scope === 'all' ? undefined : scope, ctl.signal)
        .then((r) => setResults(r.results))
        .catch((e) => { if ((e as Error).name !== 'AbortError') setSearchError(e instanceof WatchError ? e.message : 'Search failed.') })
        .finally(() => setSearching(false))
    }, 320)
    return () => { clearTimeout(t); ctl.abort() }
  }, [query, scope])

  // "Because you watched" + "Recommended for You" from the real watch history (recommendations per title)
  useEffect(() => {
    if (scope !== 'all' || query.trim() || progress.length === 0) { setBecauseRecs(null); setForYou([]); return }
    let live = true
    const recent = progress.slice(0, 3)
    void Promise.all(recent.map((p) => watchApi.title(p.kind, p.id).catch(() => null))).then((titles) => {
      if (!live) return
      const withRecs = titles.filter((t): t is NonNullable<typeof t> => !!t && !!t.recommendations?.length)
      if (!withRecs.length) return
      const first = withRecs[0]
      const seen = new Set<string>()
      const merged: Card[] = []
      for (const t of withRecs) for (const c of t.recommendations ?? []) {
        const k = `${c.kind}:${c.id}`
        if (seen.has(k)) continue
        seen.add(k)
        merged.push(c)
      }
      setBecauseRecs({ title: first.title, items: first.recommendations ?? [] })
      setForYou(merged.slice(0, 22))
    })
    return () => { live = false }
  }, [progress, scope, query])

  if (enabled === false) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-shasta-muted">
        <div><Film className="mx-auto mb-3 size-8" /><p>Watch is turned off on this server.</p></div>
      </div>
    )
  }

  if (detail) {
    return <DetailView detail={detail} onClose={() => setDetail(null)} onNavigate={(kind, id, season, episode) => setDetail({ kind, id, season, episode, play: true })} />
  }

  const q = query.trim()
  return (
    <div className="mx-auto w-full max-w-6xl pb-16">
      {/* header */}
      <header className="sticky top-0 z-30 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-white/5 bg-shasta-bg/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Film className="size-5 text-shasta-accent" /> Watch</h1>
        <div className="relative order-3 w-full sm:order-2 sm:ml-auto sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-shasta-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
            placeholder="Search anime, films and TV…"
            role="searchbox"
            spellCheck={false}
            className="h-10 w-full rounded-xl border border-white/10 bg-shasta-field pl-9 pr-9 text-sm outline-none focus:border-shasta-accent"
          />
          {searching ? <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-shasta-muted" /> : query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-shasta-muted hover:text-shasta-fg"><X className="size-4" /></button>
          )}
        </div>
        <div className="order-2 flex gap-1 sm:order-3">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              aria-pressed={scope === s.key}
              className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition', scope === s.key ? 'bg-shasta-accent text-white' : 'bg-shasta-field text-shasta-muted hover:text-shasta-fg')}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {!tmdb && (
        <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">Films and TV need a TMDB key on the server; showing anime only.</p>
      )}

      {q ? (
        <SearchResults
          query={q}
          results={results}
          searching={searching}
          error={searchError}
          onOpen={open}
        />
      ) : (
        <>
          {scope === 'all' && featured.length > 0 && <Hero items={featured} onOpen={open} />}

          <AdSlot className="my-5" minHeight={110} />

          {/* personalized: only when there is real device data */}
          {progress.length > 0 && (
            <Rail title="Continue watching" icon={<Clock className="size-4" />}>
              {progress.slice(0, 12).map((p) => (
                <MediaCard
                  key={`${p.kind}:${p.id}:${p.episode}`}
                  card={{ kind: p.kind, id: p.id, title: p.title, year: null, poster: p.poster, score: 0, subtitle: p.episode > 1 ? `E${p.episode}` : undefined }}
                  progress={p.duration ? p.position / p.duration : 0}
                  onOpen={() => setDetail({ kind: p.kind, id: p.id, season: p.season, episode: p.episode, play: true })}
                  fixed
                />
              ))}
            </Rail>
          )}

          {spooky.length > 0 && (
            <HalloweenSection id="watch" title="Halloween at Shasta Watch" subtitle="Horror films, Halloween specials and spooky anime. Here until November 1.">
              {spooky.map((r) => <RowSection key={r.key} rowKey={r.key} title={r.title} onOpen={open} />)}
            </HalloweenSection>
          )}

          {list.length > 0 && (
            <Rail title="My List" icon={<ListVideo className="size-4" />}>
              {list.slice(0, 18).map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={open} fixed />)}
            </Rail>
          )}

          {becauseRecs && becauseRecs.items.length > 0 && (
            <Rail title={`Because you watched ${becauseRecs.title}`}>
              {becauseRecs.items.slice(0, 18).map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={open} fixed />)}
            </Rail>
          )}

          {forYou.length > 0 && (
            <Rail title="Recommended for You" subtitle="From your watch history on this device">
              {forYou.map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={open} fixed />)}
            </Rail>
          )}

          {/* discovery rows: server-registered, lazily fetched, empties hidden */}
          {rows === null ? (
            <div className="mt-8 space-y-8">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i}>
                  <div className="mb-3 h-4 w-40 animate-pulse rounded bg-shasta-field" />
                  <div className="flex gap-3 overflow-hidden">{Array.from({ length: 7 }, (_, j) => <SkeletonCard key={j} />)}</div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {plainRows.map((r) => <RowSection key={r.key} rowKey={r.key} title={r.title} onOpen={open} />)}
              {rows.length === 0 && <p className="mt-8 text-center text-sm text-shasta-muted">No rows answered right now. Try again in a moment.</p>}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Rail({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-1 flex items-center gap-2 px-1 text-sm font-semibold tracking-tight text-shasta-fg sm:text-base">
        {icon}{title}{subtitle && <span className="text-xs font-normal text-shasta-muted">· {subtitle}</span>}
      </h2>
      <Scroller>{children}</Scroller>
    </section>
  )
}

function SearchResults({ query, results, searching, error, onOpen }: { query: string; results: Card[]; searching: boolean; error: string; onOpen: (c: Card, play?: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const cards = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('button[data-card]') ?? [])
    const idx = cards.indexOf(document.activeElement as HTMLButtonElement)
    if (idx < 0) return
    e.preventDefault()
    const cols = Math.max(2, Math.floor((box.current?.clientWidth ?? 640) / 170))
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : -cols
    cards[Math.max(0, Math.min(cards.length - 1, idx + step))]?.focus()
  }
  return (
    <section ref={box} onKeyDown={onKeyDown} className="mt-2">
      <p className="mb-3 px-1 text-sm text-shasta-muted">
        {searching ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Searching…</span> : error ? error : `${results.length} result${results.length === 1 ? '' : 's'} for “${query}”`}
      </p>
      {!searching && !error && results.length === 0 && <p className="px-1 text-sm text-shasta-muted">Nothing matched. Try another spelling, or the anime's English or romaji name.</p>}
      <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-6">
        {results.map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={onOpen} />)}
      </div>
    </section>
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

function DetailView({ detail, onClose, onNavigate }: { detail: { kind: Kind; id: string; season: number; episode: number; play: boolean }; onClose: () => void; onNavigate: (kind: Kind, id: string, season: number, episode: number) => void }) {
  const [title, setTitle] = useState<Title | null>(null)
  const [sources, setSources] = useState<Candidate[]>([])
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [season, setSeason] = useState(detail.season)
  const [episode, setEpisode] = useState(detail.episode)
  const [showTrailer, setShowTrailer] = useState(false)
  const autoPlayed = useRef(false)
  // which title the entry's own season has already been seeded for (so a later explicit season pick is respected)
  const seededFor = useRef('')
  const inList = useWatch((s) => !!title && s.inList(title.kind, title.id))
  const toggleList = useWatch((s) => s.toggleList)
  const progressFor = useWatch((s) => s.progressFor)
  const setProgress = useWatch((s) => s.setProgress)

  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setTitle(null); setSources([]); setCandidate(null); autoPlayed.current = false
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

  const startAt = title ? progressFor(detail.kind, detail.id, episode)?.position ?? 0 : 0

  const nextEpisode = useCallback(() => {
    if (!title) return
    const max = title.episodes?.length ? Math.max(...title.episodes.map((e) => e.number)) : title.totalEpisodes ?? 1
    if (episode >= max) return
    setEpisode((e) => e + 1)
  }, [title, episode])
  const hasNext = useMemo(() => {
    if (!title) return false
    const max = title.episodes?.length ? Math.max(...title.episodes.map((e) => e.number)) : title.totalEpisodes ?? 1
    return episode < max
  }, [title, episode])

  const onProgress = useCallback((position: number, duration: number) => {
    if (title) setProgress({ kind: title.kind, id: title.id, season, episode, title: title.title, poster: title.poster, position, duration })
  }, [title, season, episode, setProgress])

  useEffect(() => {
    const t = title
    if (!t || !sources.length || !detail.play || autoPlayed.current) return
    autoPlayed.current = true
    if (t.kind === 'movie') { setShowTrailer(false); return }
  }, [title, sources, detail.play])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      <button onClick={onClose} className="mb-3 flex items-center gap-1.5 text-sm text-shasta-muted hover:text-shasta-fg"><ArrowLeft className="size-4" /> Back</button>

      {loading && !title && <div className="grid h-40 place-items-center"><Loader2 className="size-6 animate-spin text-shasta-muted" /></div>}
      {error && <p className="text-sm text-shasta-warn">{error}</p>}

      {title && (
        <>
          {showTrailer && title.trailer && <div className="mb-4"><Trailer videoKey={title.trailer.key} onClose={() => setShowTrailer(false)} /></div>}
          {!showTrailer && candidate && (
            <Player
              candidate={candidate}
              candidates={sources}
              title={title.title}
              sub={title.kind === 'movie' || (title.totalEpisodes ?? 0) <= 1 ? undefined : `S${season}E${episode}`}
              poster={title.backdrop ?? title.poster ?? null}
              startAt={startAt}
              nextLabel={hasNext ? 'Next episode' : undefined}
              onPickSource={setCandidate}
              onProgress={onProgress}
              onNext={hasNext ? nextEpisode : undefined}
              onClose={onClose}
              onFailed={(c) => { if (sources.length < 2) return; const i = sources.findIndex((s) => s.id === c.id); const n = sources[(i + 1) % sources.length]; if (n && n.id !== c.id) setCandidate(n) }}
            />
          )}
          {!candidate && !error && !loading && <p className="mb-4 rounded-lg bg-shasta-field px-3 py-2 text-sm text-shasta-muted">Discovery only right now — no playable source answered. {title.trailer && <button className="underline" onClick={() => setShowTrailer(true)}>Watch the trailer.</button>}</p>}

          <div className="mt-4 flex flex-col gap-5 sm:flex-row">
            <div className="w-full shrink-0 sm:w-44">
              {title.poster && <img src={artUrl(title.poster)} crossOrigin={MEDIA_CORS} alt="" className="hidden w-full rounded-xl ring-1 ring-white/10 sm:block" />}
              <div className="mt-3 flex flex-wrap gap-2">
                {candidate && <button onClick={() => setShowTrailer(false)} className="flex items-center gap-1.5 rounded-lg bg-shasta-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"><Play className="size-3.5 fill-white" /> Play</button>}
                {title.trailer && <button onClick={() => setShowTrailer((v) => !v)} className="rounded-lg bg-shasta-field px-3 py-1.5 text-xs font-medium hover:text-shasta-fg">Trailer</button>}
                <button onClick={() => void toggleList(title)} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium', inList ? 'bg-shasta-accent/15 text-shasta-accent' : 'bg-shasta-field hover:text-shasta-fg')}>
                  <Plus className={cn('size-3.5 transition-transform', inList && 'rotate-45')} /> {inList ? 'In My List' : 'My List'}
                </button>
              </div>
              {sources.length > 1 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-medium text-shasta-muted">Sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sources.map((s) => (
                      <button key={s.id} onClick={() => setCandidate(s)} className={cn('rounded-full px-2.5 py-1 text-[11px] transition', s.id === candidate?.id ? 'bg-shasta-accent text-white' : 'bg-shasta-field text-shasta-muted hover:text-shasta-fg')}>{s.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold sm:text-2xl">{title.title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-shasta-muted">
                {title.year && <span>{title.year}</span>}
                {title.format && <span>· {title.format}</span>}
                {title.runtime ? <span>· {title.runtime} min</span> : null}
                {title.rating ? <span className="flex items-center gap-1 text-amber-400"><Star className="size-3 fill-amber-400" /> {title.rating}%</span> : null}
                {title.status && <span className="uppercase">· {title.status.replace(/_/g, ' ')}</span>}
              </p>
              {title.genres.length > 0 && <p className="mt-2 flex flex-wrap gap-1.5">{title.genres.map((g) => <span key={g} className="rounded-full bg-shasta-field px-2 py-0.5 text-[11px] text-shasta-muted">{g}</span>)}</p>}
              {title.overview && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-shasta-muted">{title.overview}</p>}
              {title.studio && <p className="mt-2 text-xs text-shasta-muted">Studio · {title.studio}</p>}

              {(title.kind === 'tv' || title.kind === 'anime') && title.seasons && title.seasons.length > 0 && (
                <select value={season} onChange={(e) => { const s = Number(e.target.value); setSeason(s); setEpisode(1) }} className="mt-4 h-9 rounded-lg border border-white/10 bg-shasta-field px-2 text-sm">
                  {title.seasons.map((s) => <option key={s.number} value={s.number}>{s.name} ({s.episodes})</option>)}
                </select>
              )}

              {title.episodes && title.episodes.length > 0 && (
                <div className="mt-4 grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                  {title.episodes.map((e) => {
                    const p = progressFor(detail.kind, detail.id, e.number)
                    return (
                      <button key={e.number} onClick={() => { setEpisode(e.number); setShowTrailer(false) }} className={cn('flex items-center gap-3 rounded-lg border p-2 text-left text-xs transition', e.number === episode ? 'border-shasta-accent bg-shasta-field' : 'border-white/10 hover:bg-shasta-field')}>
                        {e.still ? <img src={artUrl(e.still)} crossOrigin={MEDIA_CORS} alt="" loading="lazy" className="h-12 w-20 shrink-0 rounded object-cover" /> : <span className="grid h-12 w-20 shrink-0 place-items-center rounded bg-shasta-field"><TvIcon className="size-4" /></span>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{e.number}. {e.title}</span>
                          {p && <span className="mt-1 block h-0.5 w-full bg-white/10"><span className="block h-full bg-shasta-accent" style={{ width: `${p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0}%` }} /></span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {title.cast && title.cast.length > 0 && (
                <div className="mt-6">
                  <h2 className="mb-2 text-sm font-semibold">Cast & staff</h2>
                  <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {title.cast.map((p, i) => (
                      <div key={i} className="w-20 shrink-0 text-center">
                        {p.image ? <img src={artUrl(p.image)} crossOrigin={MEDIA_CORS} alt="" loading="lazy" className="mx-auto size-20 rounded-full object-cover ring-1 ring-white/10" /> : <span className="mx-auto grid size-20 place-items-center rounded-full bg-shasta-field"><Clock className="size-5 text-shasta-muted" /></span>}
                        <p className="mt-1 line-clamp-2 text-[11px] font-medium">{p.name}</p>
                        <p className="line-clamp-2 text-[10px] text-shasta-muted">{p.role}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {title.recommendations && title.recommendations.length > 0 && (
                <div className="mt-6">
                  <h2 className="mb-2 text-sm font-semibold">More like this</h2>
                  <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {title.recommendations.map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={(x) => onNavigate(x.kind, x.id, 1, 1)} fixed />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {detail.play && !candidate && !loading && sources.length > 0 && <p className="mt-2 text-xs text-shasta-muted"><RotateCcw className="mr-1 inline size-3" /> Sources are loading…</p>}
      {progressFor(detail.kind, detail.id, episode) && (
        <button onClick={() => { const p = progressFor(detail.kind, detail.id, episode); if (p) useWatch.getState().removeProgress(p.kind, p.id, p.episode) }} className="mt-4 flex items-center gap-1 text-xs text-shasta-muted hover:text-shasta-fg">
          <Trash2 className="size-3" /> Remove from Continue watching
        </button>
      )}
    </div>
  )
}
