// Watch search, modelled on the Store's: a box with instant suggestions (the fast sources answer in ~150 ms), and a
// results page that fills in source by source instead of waiting for the slowest (a book site can take seconds),
// with a top result, counts to narrow down, a sort, and an empty state that offers something to try.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Info, Loader2, Play, Plus, Search, SearchX, Star, X } from 'lucide-react'
import { MEDIA_CORS } from '@/lib/appApi'
import { cn } from '@/lib/utils'
import { artUrl, watchApi, WatchError } from './api'
import { CardGrid, ctaFor, KIND_LABEL, KIND_PLURAL, loadRow, typeIcon } from './components'
import { mergeRanked, type Ranked } from './rank'
import { useWatch } from './store'
import type { Card, Kind, Scope } from './types'
import { isReadKind } from './types'

// ---- the box ---------------------------------------------------------------------------------------------------------

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const meta = (c: Card) => [KIND_LABEL[c.kind], c.year].filter(Boolean).join(' · ')

export function SearchBox({ committed, scope, onSubmit, onOpen }: { committed: string; scope: Scope; onSubmit: (q: string) => void; onOpen: (c: Card) => void }) {
  const [text, setText] = useState(committed)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [items, setItems] = useState<Card[]>([])
  const [loading, setLoading] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const q = useDebounced(text.trim(), 120)

  useEffect(() => { setText(committed) }, [committed])

  useEffect(() => {
    if (!open || q.length < 2) { setItems([]); return }
    const ctl = new AbortController()
    setLoading(true)
    watchApi.suggest(q, ctl.signal)
      .then((d) => { setItems(d.results); setActive(-1) })
      .catch(() => undefined)
      .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    return () => ctl.abort()
  }, [q, open])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // within a section, its own kind first (the results page narrows to it too)
  const shown = useMemo(() => (scope === 'all' ? items : [...items].sort((a, b) => Number(b.kind === scope) - Number(a.kind === scope))), [items, scope])

  const submit = () => {
    setOpen(false)
    input.current?.blur()
    onSubmit(text.trim())
  }
  const pick = (c: Card) => {
    setOpen(false)
    input.current?.blur()
    onOpen(c)
  }

  return (
    // on a phone the list spans the header (the box sits beside My List); from sm up it hangs under the box
    <div ref={box} className="sm:relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (active >= 0 && shown[active]) pick(shown[active])
          else submit()
        }}
        className="flex h-9 w-44 items-center gap-2 rounded-[10px] border border-shasta-line bg-shasta-field px-3 transition-[width,border-color] duration-200 ease-shasta focus-within:w-64 focus-within:border-shasta-accent sm:w-52 lg:w-64 lg:focus-within:w-80"
      >
        {loading && open ? <Loader2 className="size-4 shrink-0 animate-spin text-shasta-faint" aria-hidden /> : <Search className="size-4 shrink-0 text-shasta-faint" aria-hidden />}
        <input
          ref={input}
          role="combobox"
          aria-label="Search films, TV, anime, manga, comics and books"
          aria-expanded={open && shown.length > 0}
          aria-controls="watch-suggest"
          aria-activedescendant={active >= 0 ? `watch-suggest-${active}` : undefined}
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)) }
            else if (e.key === 'Escape') { if (open && text) setOpen(false); else { setText(''); onSubmit('') } }
          }}
          placeholder={scope === 'all' ? 'Search titles' : `Search ${KIND_PLURAL[scope].toLowerCase()}`}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-shasta-faint"
        />
        {text && (
          <button type="button" aria-label="Clear search" onClick={() => { setText(''); setOpen(false); onSubmit('') }} className="text-shasta-muted hover:text-shasta-fg">
            <X className="size-4" />
          </button>
        )}
      </form>

      {open && q.length >= 2 && (
        <ul id="watch-suggest" role="listbox" className="absolute inset-x-4 top-full z-50 mt-1 overflow-hidden sm:inset-x-auto sm:right-0 sm:top-11 sm:mt-0 sm:w-[26rem] rounded-xl bg-popover p-1 shadow-xl ring-1 ring-shasta-line">
          {shown.map((c, i) => {
            const Icon = typeIcon(c.kind)
            return (
              <li key={`${c.kind}:${c.id}`} id={`watch-suggest-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c)}
                  className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm', i === active && 'bg-shasta-hover')}
                >
                  <span className="grid h-12 w-8 shrink-0 place-items-center overflow-hidden rounded bg-shasta-field ring-1 ring-shasta-line">
                    {c.poster ? <img src={artUrl(c.poster)} crossOrigin={MEDIA_CORS} alt="" className="size-full object-cover" /> : <Icon className="size-3.5 text-shasta-faint" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="block truncate text-xs text-shasta-faint">{meta(c)}</span>
                  </span>
                  {c.score > 0 && <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-shasta-faint"><Star className="size-3" /> {c.score}</span>}
                </button>
              </li>
            )
          })}
          {!loading && shown.length === 0 && <li className="px-3 py-2 text-sm text-shasta-faint">No quick matches. Press Enter to search everything.</li>}
          <li>
            <button type="button" onClick={submit} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
              <Search className="size-3.5" /> {shown.length ? 'See all results for' : 'Search for'} “{text.trim()}”
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

// ---- the results page ------------------------------------------------------------------------------------------------

/** Each source on its own request, so a slow one never holds the page. `movie` answers films and TV together. */
const SOURCES: { type: Kind; label: string; read?: boolean }[] = [
  { type: 'movie', label: 'films and TV' },
  { type: 'anime', label: 'anime' },
  { type: 'manga', label: 'manga', read: true },
  { type: 'comic', label: 'comics', read: true },
  { type: 'book', label: 'books', read: true },
]
const FAST: Kind[] = ['movie', 'anime', 'manga']
const KIND_ORDER: Kind[] = ['movie', 'tv', 'anime', 'manga', 'comic', 'book']
const SORTS = [['best', 'Best match'], ['rating', 'Highest rated'], ['newest', 'Newest']] as const
type Sort = (typeof SORTS)[number][0]
type Group = 'all' | 'watch' | 'read'

export function SearchResults({ query, scope, read, onOpen, onSearch }: { query: string; scope: Scope; read: boolean; onOpen: (c: Card, play?: boolean) => void; onSearch: (q: string) => void }) {
  const [lists, setLists] = useState<Partial<Record<Kind, Card[]>>>({})
  const [pending, setPending] = useState<Kind[]>([])
  const [failed, setFailed] = useState('')
  const [kind, setKind] = useState<Kind | null>(scope === 'all' ? null : scope)
  const [group, setGroup] = useState<Group>('all')
  const [sort, setSort] = useState<Sort>('best')

  useEffect(() => {
    setKind(scope === 'all' ? null : scope)
    setGroup('all')
    setSort('best')
    setFailed('')
    setLists({})
    const sources = SOURCES.filter((s) => read || !s.read)
    setPending(sources.map((s) => s.type))
    const ctl = new AbortController()
    for (const s of sources) {
      watchApi.search(query, s.type, ctl.signal)
        .then((d) => setLists((cur) => ({ ...cur, [s.type]: d.results })))
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return
          setLists((cur) => ({ ...cur, [s.type]: [] }))
          if (e instanceof WatchError && e.status === 0) setFailed(e.message)
        })
        .finally(() => { if (!ctl.signal.aborted) setPending((p) => p.filter((t) => t !== s.type)) })
    }
    return () => ctl.abort()
  }, [query, scope, read])

  const ranked = useMemo(() => mergeRanked(query, KIND_ORDER.map((k) => lists[k] ?? [])), [query, lists])
  const counts = useMemo(() => {
    const by: Partial<Record<Kind, number>> = {}
    for (const r of ranked) by[r.card.kind] = (by[r.card.kind] ?? 0) + 1
    return by
  }, [ranked])
  const watchCount = (counts.movie ?? 0) + (counts.tv ?? 0) + (counts.anime ?? 0)
  const readCount = (counts.manga ?? 0) + (counts.comic ?? 0) + (counts.book ?? 0)

  const filtered = useMemo(() => {
    let list: Ranked[] = ranked
    if (group !== 'all') list = list.filter((r) => isReadKind(r.card.kind) === (group === 'read'))
    if (kind) list = list.filter((r) => r.card.kind === kind)
    if (sort === 'rating') list = [...list].sort((a, b) => b.card.score - a.card.score)
    else if (sort === 'newest') list = [...list].sort((a, b) => (b.card.year ?? 0) - (a.card.year ?? 0))
    return list
  }, [ranked, group, kind, sort])

  const fastDone = FAST.every((t) => !pending.includes(t))
  const done = pending.length === 0
  // a clear best match gets its own card, but only once the quick sources are in (so it does not jump around)
  const top = sort === 'best' && fastDone && filtered[0] && filtered[0].rank >= 0.85 ? filtered[0].card : null
  const rest = top ? filtered.slice(1).map((r) => r.card) : filtered.map((r) => r.card)
  const waitingFor = SOURCES.filter((s) => pending.includes(s.type)).map((s) => s.label)

  const kinds = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0 && (group === 'all' || isReadKind(k) === (group === 'read')))

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="sh-title break-words">“{query}”</h1>
          <p className="mt-1 flex min-h-5 items-center gap-2 text-sm text-shasta-muted tabular-nums" aria-live="polite">
            {ranked.length > 0 && <span>{ranked.length} {ranked.length === 1 ? 'result' : 'results'}</span>}
            {!done && (
              <span className="flex items-center gap-1.5 text-shasta-faint">
                <Loader2 className="size-3.5 animate-spin" /> Searching {waitingFor.join(', ')}…
              </span>
            )}
          </p>
        </div>
        {ranked.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-shasta-muted">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-lg bg-shasta-field px-3 text-sm text-shasta-fg ring-1 ring-shasta-line outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>

      {ranked.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 px-1">
          {read && (
            <Segmented
              value={group}
              onChange={(g) => { setGroup(g); setKind(null) }}
              options={[['all', 'All', ranked.length], ['watch', 'Watch', watchCount], ['read', 'Read', readCount]]}
            />
          )}
          {kinds.length > 1 && <span aria-hidden className="mx-1 hidden h-5 w-px bg-shasta-line sm:block" />}
          {kinds.length > 1 && kinds.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(kind === k ? null : k)}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-[color,background-color,box-shadow] duration-150 ease-shasta', kind === k ? 'sh-selected' : 'bg-shasta-field text-shasta-muted ring-1 ring-shasta-line hover:text-shasta-fg')}
            >
              {KIND_PLURAL[k]} <span className="font-mono text-xs text-shasta-faint tabular-nums">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}

      {ranked.length === 0 && !done ? (
        <ResultSkeletons />
      ) : ranked.length === 0 ? (
        <Empty query={query} error={failed} onSearch={onSearch} />
      ) : filtered.length === 0 ? (
        <p className="px-1 py-10 text-center text-sm text-shasta-muted">Nothing in this filter{!done && ' yet'}.</p>
      ) : (
        <>
          {top && <TopResult card={top} onOpen={onOpen} />}
          {top && rest.length > 0 && <h2 className="mb-3 px-1 text-sm font-medium text-shasta-muted">More results</h2>}
          <CardGrid cards={rest} onOpen={onOpen} showKind={!kind} />
        </>
      )}
    </section>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string, number][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-[10px] bg-shasta-field p-0.5" role="group" aria-label="Watch, read or both">
      {options.map(([v, l, n]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          disabled={n === 0 && value !== v}
          onClick={() => onChange(v)}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-[color,background-color,box-shadow] duration-150 ease-shasta disabled:opacity-40', value === v ? 'sh-selected' : 'text-shasta-muted hover:text-shasta-fg')}
        >
          {l} <span className="font-mono text-xs text-shasta-faint tabular-nums">{n}</span>
        </button>
      ))}
    </div>
  )
}

/** The one result the words clearly asked for: its art, what it is, and its actions right there. */
function TopResult({ card, onOpen }: { card: Card; onOpen: (c: Card, play?: boolean) => void }) {
  const inList = useWatch((s) => s.inList(card.kind, card.id))
  const toggleList = useWatch((s) => s.toggleList)
  const wide = card.backdrop || card.poster
  const reading = isReadKind(card.kind)
  return (
    <article aria-label={`Top result: ${card.title}`} className="relative mb-8 overflow-hidden rounded-2xl bg-shasta-field ring-1 ring-shasta-line">
      {wide && (
        <div aria-hidden className="absolute inset-0">
          <img src={artUrl(wide)} crossOrigin={MEDIA_CORS} alt="" className={cn('size-full object-cover', card.backdrop ? 'opacity-45' : 'scale-110 opacity-35 blur-2xl')} />
          <div className="absolute inset-0 bg-gradient-to-r from-shasta-field via-shasta-field/85 to-shasta-field/20" />
        </div>
      )}
      <div className="relative flex gap-5 p-5 sm:gap-6 sm:p-6">
        <button onClick={() => onOpen(card)} className="w-24 shrink-0 overflow-hidden rounded-lg ring-1 ring-shasta-line sm:w-32" aria-label={`${card.title} details`}>
          {card.poster ? <img src={artUrl(card.poster)} crossOrigin={MEDIA_CORS} alt="" className="aspect-[2/3] w-full object-cover" /> : <span className="grid aspect-[2/3] place-items-center bg-shasta-raised text-shasta-faint">{KIND_LABEL[card.kind]}</span>}
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-xs text-shasta-faint">Top result</p>
          <h2 className="mt-1 line-clamp-2 text-2xl leading-8 font-medium tracking-[-0.01em]">
            <button onClick={() => onOpen(card)} className="text-left hover:underline hover:underline-offset-4">{card.title}</button>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-shasta-muted">
            <span>{KIND_LABEL[card.kind]}</span>
            {card.year && <><span className="text-shasta-faint">·</span><span>{card.year}</span></>}
            {card.score > 0 && <><span className="text-shasta-faint">·</span><span className="flex items-center gap-1 tabular-nums text-amber-500 dark:text-amber-300"><Star className="size-3.5 fill-current" /> {card.score}</span></>}
            {card.genres && card.genres.length > 0 && <><span className="text-shasta-faint">·</span><span>{card.genres.slice(0, 3).join(', ')}</span></>}
          </p>
          {card.overview && <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-shasta-muted">{card.overview}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
            <button onClick={() => onOpen(card, true)} className="sh-press flex h-10 items-center gap-2 rounded-[10px] bg-shasta-accent px-5 text-sm font-medium text-shasta-accent-fg hover:brightness-110">
              {reading ? <BookOpen className="size-4" /> : <Play className="size-4 fill-current" />} {ctaFor(card.kind)}
            </button>
            <button onClick={() => onOpen(card)} className="sh-press flex h-10 items-center gap-1.5 rounded-[10px] bg-shasta-bg/60 px-4 text-sm ring-1 ring-shasta-line hover:bg-shasta-raised">
              <Info className="size-4" /> Details
            </button>
            <button onClick={() => void toggleList(card)} aria-label={inList ? 'Remove from My List' : 'Add to My List'} className={cn('sh-press grid size-10 place-items-center rounded-[10px] ring-1 ring-shasta-line', inList ? 'sh-selected' : 'bg-shasta-bg/60 hover:bg-shasta-raised')}>
              <Plus className={cn('size-4 transition-transform duration-150 ease-shasta', inList && 'rotate-45')} />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function ResultSkeletons() {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] animate-pulse rounded-lg bg-shasta-field" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-shasta-field" />
          <div className="mt-1 h-2.5 w-1/3 animate-pulse rounded bg-shasta-field" />
        </div>
      ))}
    </div>
  )
}

/** Nothing matched: say so, and offer what is trending right now to try instead. */
function Empty({ query, error, onSearch }: { query: string; error: string; onSearch: (q: string) => void }) {
  const [tries, setTries] = useState<string[]>([])
  useEffect(() => {
    void loadRow('all:trending').then((items) => setTries([...new Set(items.map((c) => c.title))].slice(0, 6))).catch(() => undefined)
  }, [])
  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <span className="mb-4 grid size-11 place-items-center rounded-full bg-shasta-field text-shasta-muted ring-1 ring-shasta-line"><SearchX className="size-5" /></span>
      <h2 className="sh-heading">{error ? 'Search did not answer' : `Nothing matches “${query}”`}</h2>
      <p className="mt-1 max-w-md text-sm text-shasta-muted">
        {error || 'Try fewer words, another spelling, or an anime’s English or romaji name.'}
      </p>
      {tries.length > 0 && (
        <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
          <span className="w-full text-xs text-shasta-faint">Trending right now</span>
          {tries.map((t) => (
            <button key={t} type="button" onClick={() => onSearch(t)} className="inline-flex h-8 items-center rounded-lg bg-shasta-field px-3 text-sm text-shasta-muted ring-1 ring-shasta-line transition-colors duration-150 ease-shasta hover:text-shasta-fg">
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
