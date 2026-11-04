// Reusable Watch UI: the media card (with hover metadata), a snap carousel, lazily-loaded rows (posters or a numbered
// Top 10), the hero, grids and skeletons. Rows share one cache per session, so the home, the section pages and the
// "Browse" tiles never fetch the same row twice.
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Film, Info, Layers, Play, Plus, Star, Tv as TvIcon } from 'lucide-react'
import { MEDIA_CORS } from '@/lib/appApi'
import { artUrl, watchApi } from './api'
import { useWatch } from './store'
import type { Card, Featured, Kind } from './types'
import { isReadKind } from './types'
import { cn } from '@/lib/utils'

export const ctaFor = (k: Kind) => (isReadKind(k) ? 'Read' : 'Watch')

export const KIND_LABEL: Record<Kind, string> = { anime: 'Anime', movie: 'Film', tv: 'Series', manga: 'Manga', comic: 'Comic', book: 'Book' }
export const KIND_PLURAL: Record<Kind, string> = { anime: 'Anime', movie: 'Films', tv: 'TV series', manga: 'Manga', comic: 'Comics', book: 'Books' }

/** AniList formats arrive as enum names ("Anime · MOVIE", "TV_SHORT"): "Anime · Movie", "TV short". */
const tidyFormat = (s?: string) => s?.replace(/\b([A-Z]{2,})((?:_[A-Z]+)*)\b/g, (m, head: string, rest: string) => (m.length <= 3 && !rest ? m : `${head === 'TV' ? 'TV' : head[0] + head.slice(1).toLowerCase()}${rest.replace(/_/g, ' ').toLowerCase()}`))

export const typeIcon = (kind: Kind) => (kind === 'tv' ? TvIcon : kind === 'manga' || kind === 'comic' ? Layers : kind === 'book' ? BookOpen : Film)

// ---- row data: one cache + in-flight dedupe for the whole session ---------------------------------------------------

const rowCache = new Map<string, Card[]>()
const inflight = new Map<string, Promise<Card[]>>()

export function loadRow(key: string): Promise<Card[]> {
  const hit = rowCache.get(key)
  if (hit) return Promise.resolve(hit)
  let p = inflight.get(key)
  if (!p) {
    p = watchApi
      .row(key)
      .then((d) => {
        rowCache.set(key, d.items)
        return d.items
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/** A row's items. With `near`, the fetch waits until that element is scrolled close (lazy rows). */
export function useRow(key: string | null, near?: RefObject<HTMLElement | null>): { items: Card[] | null; failed: boolean } {
  const [items, setItems] = useState<Card[] | null>(key ? rowCache.get(key) ?? null : null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!key) return
    const cached = rowCache.get(key)
    if (cached) { setItems(cached); return }
    setItems(null)
    setFailed(false)
    let live = true
    const go = () => {
      loadRow(key).then((d) => { if (live) setItems(d) }).catch(() => { if (live) setFailed(true) })
    }
    const el = near?.current
    if (!near || !el) { go(); return () => { live = false } }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      go()
    }, { rootMargin: '500px 0px' })
    io.observe(el)
    return () => { live = false; io.disconnect() }
  }, [key, near])

  return { items, failed }
}

/** The first of several rows that has any items (a source can be down: Books falls back from web novels to classics). */
export function useFirstFilledRow(keys: string[]): { key: string | null; items: Card[] | null; done: boolean } {
  const sig = keys.join('|')
  const [state, setState] = useState<{ sig: string; key: string | null; items: Card[] | null; done: boolean }>({ sig: '', key: null, items: null, done: false })
  useEffect(() => {
    let live = true
    void (async () => {
      for (const k of sig ? sig.split('|') : []) {
        const items = await loadRow(k).catch(() => [] as Card[])
        if (!live) return
        if (items.length) { setState({ sig, key: k, items, done: true }); return }
      }
      if (live) setState({ sig, key: null, items: null, done: true })
    })()
    return () => { live = false }
  }, [sig])
  return state.sig === sig ? { key: state.key, items: state.items, done: state.done } : { key: null, items: null, done: !sig }
}

// ---- cards -----------------------------------------------------------------------------------------------------------

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('w-[136px] shrink-0 sm:w-[156px] lg:w-[176px]', className)}>
      <div className="aspect-[2/3] animate-pulse rounded-lg bg-shasta-field" />
      <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-shasta-field" />
      <div className="mt-1 h-2.5 w-1/3 animate-pulse rounded bg-shasta-field" />
    </div>
  )
}

export function MediaCard({
  card,
  onOpen,
  progress,
  fixed,
  showKind,
}: {
  card: Card
  onOpen: (card: Card, play?: boolean) => void
  progress?: number
  /** inside a fixed-width carousel cell */
  fixed?: boolean
  /** label the kind on the poster (rows and results that mix films, anime, manga...) */
  showKind?: boolean
}) {
  const inList = useWatch((s) => s.inList(card.kind, card.id))
  const toggleList = useWatch((s) => s.toggleList)
  const TypeIcon = typeIcon(card.kind)
  return (
    <div className={cn('group/card relative', fixed && 'w-[136px] shrink-0 snap-start sm:w-[156px] lg:w-[176px]')}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-shasta-field ring-1 ring-shasta-line transition-shadow duration-150 ease-shasta group-hover/card:ring-shasta-fg/25">
        <button data-card onClick={() => onOpen(card)} className="block size-full text-left focus-visible:outline-offset-[-2px]" aria-label={`${card.title} details`}>
          {card.poster ? (
            <img src={artUrl(card.poster)} crossOrigin={MEDIA_CORS} loading="lazy" alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-shasta-muted"><TypeIcon className="size-7" /></span>
          )}
        </button>

        {showKind && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[11px] leading-4 text-white">
            {KIND_LABEL[card.kind]}
          </span>
        )}
        {card.score > 0 && (
          <span className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[11px] leading-4 tabular-nums text-amber-300">
            <Star className="size-3 fill-amber-300" /> {card.score}
          </span>
        )}
        {progress != null && progress > 0.02 && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <span className="block h-full bg-shasta-accent" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        )}

        {/* extra metadata + actions: pass-through overlay (clicks reach the poster), actions tappable; shown always on touch */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/30 to-transparent p-2 transition-opacity duration-200 md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100">
          {card.overview && <p className="mb-1 line-clamp-3 text-[11px] leading-snug text-white/85">{card.overview}</p>}
          {card.genres && card.genres.length > 0 && <p className="mb-1.5 truncate text-[11px] text-white/60">{card.genres.join(' · ')}</p>}
          <div className="pointer-events-auto flex gap-1">
            <button onClick={() => onOpen(card, true)} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-shasta-accent px-2 py-1 text-[11px] font-medium text-shasta-accent-fg transition-[filter] duration-150 ease-shasta hover:brightness-110">
              {isReadKind(card.kind) ? <BookOpen className="size-3" /> : <Play className="size-3 fill-current" />} {ctaFor(card.kind)}
            </button>
            <button
              onClick={() => void toggleList(card)}
              aria-label={inList ? 'Remove from My List' : 'Add to My List'}
              className="grid size-6 shrink-0 place-items-center rounded-md bg-white/15 text-white hover:bg-white/25"
            >
              <Plus className={cn('size-3.5 transition-transform duration-150 ease-shasta', inList && 'rotate-45')} />
            </button>
          </div>
        </div>
      </div>
      <button onClick={() => onOpen(card)} className="mt-2 block w-full min-w-0 text-left">
        <p className="truncate text-xs font-medium">{card.title}</p>
        <p className="mt-0.5 truncate text-xs text-shasta-faint">{[card.year, tidyFormat(card.subtitle)].filter(Boolean).join(' · ')}</p>
      </button>
    </div>
  )
}

/** A numbered Top 10 tile: an outlined rank beside the poster. */
function RankCard({ card, rank, onOpen }: { card: Card; rank: number; onOpen: (c: Card, play?: boolean) => void }) {
  const TypeIcon = typeIcon(card.kind)
  return (
    <button
      data-card
      onClick={() => onOpen(card)}
      title={card.title}
      aria-label={`${rank}. ${card.title}`}
      className={cn('group/rank relative flex h-[188px] shrink-0 snap-start items-end sm:h-[212px]', rank === 10 ? 'w-[250px] sm:w-[284px]' : 'w-[200px] sm:w-[226px]')}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[-6px] left-0 select-none text-[148px] leading-none font-semibold tracking-[-0.09em] text-shasta-bg [-webkit-text-stroke:2px_var(--color-shasta-faint)] transition-[-webkit-text-stroke-color] duration-150 ease-shasta group-hover/rank:[-webkit-text-stroke-color:var(--color-shasta-muted)] sm:text-[168px]"
      >
        {rank}
      </span>
      <span className="relative ml-auto aspect-[2/3] h-full overflow-hidden rounded-lg bg-shasta-field ring-1 ring-shasta-line transition-shadow duration-150 ease-shasta group-hover/rank:ring-shasta-fg/25">
        {card.poster ? (
          <img src={artUrl(card.poster)} crossOrigin={MEDIA_CORS} loading="lazy" alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-shasta-muted"><TypeIcon className="size-7" /></span>
        )}
        <span className="absolute left-1.5 top-1.5 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[11px] leading-4 text-white">{KIND_LABEL[card.kind]}</span>
      </span>
    </button>
  )
}

function ArrowButton({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}
      className={cn(
        'absolute top-[42%] z-30 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-shasta-line bg-shasta-chrome text-shasta-fg opacity-0 shadow-[0_4px_12px_rgb(0_0_0/0.25)] transition-[opacity,background-color] duration-150 ease-shasta hover:bg-shasta-raised group-hover/row:opacity-100 focus-visible:opacity-100 md:grid',
        dir < 0 ? '-left-3' : '-right-3',
      )}
    >
      <Icon className="size-5" />
    </button>
  )
}

export function Scroller({ children, gap = 'gap-3' }: { children: ReactNode; gap?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = useCallback((dir: number) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: 'smooth' })
  }, [])
  return (
    <div className="group/row relative">
      <div
        ref={ref}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); scroll(1) }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); scroll(-1) }
        }}
        role="region"
        className={cn('flex overflow-x-auto scroll-smooth px-1 pb-2 pt-1 snap-x snap-mandatory outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', gap)}
      >
        {children}
      </div>
      <ArrowButton dir={-1} onClick={() => scroll(-1)} />
      <ArrowButton dir={1} onClick={() => scroll(1)} />
    </div>
  )
}

/** Section heading used by every row: title, optional quiet subtitle, optional "See all". */
export function RowHeading({ title, subtitle, icon, onSeeAll }: { title: string; subtitle?: string; icon?: ReactNode; onSeeAll?: () => void }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 px-1">
      <h2 className="flex min-w-0 items-baseline gap-2 text-base font-medium text-shasta-fg">
        {icon && <span className="self-center text-shasta-faint">{icon}</span>}
        <span className="truncate">{title}</span>
        {subtitle && <span className="hidden truncate text-[13px] font-normal text-shasta-faint sm:inline">{subtitle}</span>}
      </h2>
      {onSeeAll && (
        <button onClick={onSeeAll} className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[13px] text-shasta-muted transition-colors duration-150 ease-shasta hover:text-shasta-fg">
          See all <ChevronRight className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden px-1 pt-1">
      {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  )
}

/** A discovery row, fetched once it is scrolled near; drops itself if the source returned nothing. */
export function RowSection({
  rowKey,
  title,
  onOpen,
  onSeeAll,
  variant = 'poster',
  showKind,
}: {
  rowKey: string
  title: string
  onOpen: (c: Card, play?: boolean) => void
  onSeeAll?: (key: string, title: string) => void
  variant?: 'poster' | 'top10'
  showKind?: boolean
}) {
  const box = useRef<HTMLElement>(null)
  const { items, failed } = useRow(rowKey, box)
  if (items && items.length === 0) return null
  if (failed && !items) return null

  return (
    <section ref={box} className="mt-9">
      <RowHeading title={title} onSeeAll={onSeeAll && items && items.length > 8 ? () => onSeeAll(rowKey, title) : undefined} />
      {!items ? (
        <RowSkeleton />
      ) : variant === 'top10' ? (
        <Scroller gap="gap-1">
          {items.slice(0, 10).map((c, i) => <RankCard key={`${c.kind}:${c.id}`} card={c} rank={i + 1} onOpen={onOpen} />)}
        </Scroller>
      ) : (
        <Scroller>
          {items.map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={onOpen} showKind={showKind} fixed />)}
        </Scroller>
      )}
    </section>
  )
}

/** A responsive poster grid (search, My List, "See all"). */
export function CardGrid({ cards, onOpen, showKind, progressOf }: { cards: Card[]; onOpen: (c: Card, play?: boolean) => void; showKind?: boolean; progressOf?: (c: Card) => number | undefined }) {
  const box = useRef<HTMLDivElement>(null)
  // arrow keys move between posters like a TV grid
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const cards = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('button[data-card]') ?? [])
    const idx = cards.indexOf(document.activeElement as HTMLButtonElement)
    if (idx < 0) return
    e.preventDefault()
    const first = cards[0]?.getBoundingClientRect().top
    const cols = Math.max(1, cards.filter((c) => c.getBoundingClientRect().top === first).length)
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : -cols
    cards[Math.max(0, Math.min(cards.length - 1, idx + step))]?.focus()
  }
  return (
    <div ref={box} onKeyDown={onKeyDown} className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8">
      {cards.map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={onOpen} showKind={showKind} progress={progressOf?.(c)} />)}
    </div>
  )
}

// ---- hero -----------------------------------------------------------------------------------------------------------

export function Hero({ items, onOpen }: { items: Featured[]; onOpen: (c: Card, play?: boolean) => void }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const inList = useWatch((s) => (items[i] ? s.inList(items[i].kind, items[i].id) : false))
  const toggleList = useWatch((s) => s.toggleList)
  const active = items[i]

  useEffect(() => {
    if (paused || items.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 8000)
    return () => clearInterval(t)
  }, [paused, items.length])

  useEffect(() => { if (i >= items.length) setI(0) }, [items.length, i])
  if (!active) return null

  return (
    <section
      className="relative -mx-4 sm:mx-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      aria-roledescription="carousel"
    >
      <div className="relative h-[46vh] min-h-[340px] w-full overflow-hidden bg-black sm:h-[58vh] sm:max-h-[640px] sm:rounded-2xl">
        {items.map((f, idx) => {
          const wide = !!f.backdrop
          return (
            <div key={`${f.kind}:${f.id}`} className={cn('absolute inset-0 transition-opacity duration-700 ease-shasta', idx === i ? 'opacity-100' : 'opacity-0')} aria-hidden={idx !== i}>
              {wide ? (
                <img src={artUrl(f.backdrop)} crossOrigin={MEDIA_CORS} alt="" className="size-full object-cover" fetchPriority={idx === 0 ? 'high' : 'low'} loading={idx === 0 ? 'eager' : 'lazy'} />
              ) : f.poster ? (
                // comics and books have only a cover: a blurred cover fills the frame and the cover itself stands on the right
                <>
                  <img src={artUrl(f.poster)} crossOrigin={MEDIA_CORS} alt="" className="size-full scale-110 object-cover opacity-60 blur-2xl" loading="lazy" />
                  <img src={artUrl(f.poster)} crossOrigin={MEDIA_CORS} alt="" className="absolute right-[8%] top-1/2 hidden h-[78%] -translate-y-1/2 rounded-lg shadow-[0_24px_60px_rgb(0_0_0/0.5)] ring-1 ring-white/10 md:block" loading="lazy" />
                </>
              ) : null}
            </div>
          )
        })}
        {/* black-based overlays so white text stays legible on any backdrop; strong at the bottom, soft on the left */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/25 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 w-full px-6 pb-9 sm:px-10 sm:pb-11">
          <p className="text-[13px] text-white/75">
            <span className="text-white">{active.reason}</span>
            <span className="text-white/50"> · </span>
            {KIND_LABEL[active.kind]}
          </p>
          {active.logo ? (
            <img src={artUrl(active.logo)} crossOrigin={MEDIA_CORS} alt={active.title} className="mt-3 h-12 w-auto max-w-[70%] object-contain object-left sm:h-16" />
          ) : (
            <h1 className="mt-2 line-clamp-2 max-w-2xl text-3xl leading-tight font-medium tracking-[-0.02em] text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.5)] sm:text-[44px]">{active.title}</h1>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/75">
            {active.year && <span>{active.year}</span>}
            {active.rating ? <span className="flex items-center gap-1 tabular-nums text-amber-300"><Star className="size-3.5 fill-amber-300" /> {active.rating}%</span> : null}
            {active.genres.length > 0 && <span>{active.genres.slice(0, 3).join(' · ')}</span>}
          </p>
          {active.overview && <p className="mt-3 max-w-xl line-clamp-3 text-sm leading-6 text-white/80">{active.overview}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button onClick={() => onOpen(active, true)} className="sh-press flex h-11 items-center gap-2 rounded-[10px] bg-shasta-accent px-5 text-sm font-medium text-shasta-accent-fg hover:brightness-110">
              {isReadKind(active.kind) ? <BookOpen className="size-4" /> : <Play className="size-4 fill-current" />} {ctaFor(active.kind)}
            </button>
            <button onClick={() => onOpen(active)} className="sh-press flex h-11 items-center gap-2 rounded-[10px] bg-white/12 px-5 text-sm font-medium text-white ring-1 ring-white/20 hover:bg-white/20">
              <Info className="size-4" /> Details
            </button>
            <button
              onClick={() => void toggleList(active)}
              aria-label={inList ? 'Remove from My List' : 'Add to My List'}
              className="sh-press grid size-11 place-items-center rounded-[10px] text-white/85 ring-1 ring-white/20 hover:bg-white/12 hover:text-white"
            >
              <Plus className={cn('size-4 transition-transform duration-150 ease-shasta', inList && 'rotate-45')} />
            </button>
          </div>
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-4 right-6 flex gap-1.5 sm:right-10">
          {items.map((f, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Featured ${idx + 1}: ${f.title}`}
              aria-current={idx === i}
              className={cn('h-1 w-5 rounded-full transition-colors duration-150 ease-shasta', idx === i ? 'bg-white' : 'bg-white/30 hover:bg-white/60')}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** Hero items built from a row (section pages): the first few titles that have any art. */
export function featuredFromRow(items: Card[], label: string, n = 5): Featured[] {
  return items
    .filter((c) => c.backdrop || c.poster)
    .slice(0, n)
    .map((c, i) => ({
      ...c,
      overview: c.overview ?? '',
      genres: c.genres ?? [],
      backdrop: c.backdrop ?? '',
      rating: c.score || null,
      logo: null,
      reason: `#${i + 1} in ${label}`,
    }))
}
