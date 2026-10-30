// Reusable Watch UI: the media card (with hover metadata), a snap carousel, a lazily-loaded row, the hero, skeletons.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Film, Info, Play, Plus, Star, Tv as TvIcon, Volume2, VolumeX } from 'lucide-react'
import { MEDIA_CORS } from '@/lib/appApi'
import { watchApi } from './api'
import { useWatch } from './store'
import type { Card, Featured } from './types'
import { cn } from '@/lib/utils'

// rows are fetched once per session and shared by every mount (dedupe + no refetch on scope switch back)
const rowCache = new Map<string, Card[]>()

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('w-[136px] shrink-0 sm:w-[156px] lg:w-[176px]', className)}>
      <div className="aspect-[2/3] animate-pulse rounded-lg bg-shasta-field" />
      <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-shasta-field" />
      <div className="mt-1 h-2.5 w-1/3 animate-pulse rounded bg-shasta-field" />
    </div>
  )
}

const typeIcon = (kind: Card['kind']) => (kind === 'tv' ? TvIcon : Film)

export function MediaCard({
  card,
  onOpen,
  progress,
  fixed,
}: {
  card: Card
  onOpen: (card: Card, play?: boolean) => void
  progress?: number
  /** inside a fixed-width carousel cell */
  fixed?: boolean
}) {
  const inList = useWatch((s) => s.inList(card.kind, card.id))
  const toggleList = useWatch((s) => s.toggleList)
  const TypeIcon = typeIcon(card.kind)
  return (
    <div className={cn('group/card relative', fixed && 'w-[136px] shrink-0 snap-start sm:w-[156px] lg:w-[176px]')}>
      {/* transform only: hover never reflows the grid */}
      <div className="transition-transform duration-200 ease-out group-hover/card:z-20 group-hover/card:scale-[1.04]">
        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-shasta-field ring-1 ring-white/5">
          <button data-card onClick={() => onOpen(card)} className="block size-full text-left" aria-label={`${card.title} details`}>
            {card.poster ? (
              <img src={card.poster} crossOrigin={MEDIA_CORS} loading="lazy" alt="" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-shasta-muted"><TypeIcon className="size-7" /></span>
            )}
          </button>

          {card.badge && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              {card.badge}
            </span>
          )}
          {card.score > 0 && (
            <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-amber-300 backdrop-blur">
              <Star className="size-2.5 fill-amber-300" /> {card.score}
            </span>
          )}
          {progress != null && progress > 0.02 && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
              <span className="block h-full bg-shasta-accent" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </span>
          )}

          {/* extra metadata + actions: pass-through overlay (clicks reach the poster), actions tappable; shown always on touch */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/30 to-transparent p-2 transition-opacity duration-200 md:opacity-0 md:group-hover/card:opacity-100">
            {card.overview && <p className="mb-1 line-clamp-3 text-[11px] leading-snug text-white/85">{card.overview}</p>}
            {card.genres && card.genres.length > 0 && <p className="mb-1.5 truncate text-[10px] text-white/60">{card.genres.join(' · ')}</p>}
            <div className="pointer-events-auto flex gap-1">
              <button onClick={() => onOpen(card, true)} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-shasta-accent px-1.5 py-1 text-[11px] font-medium text-white hover:brightness-110">
                <Play className="size-3 fill-white" /> Watch
              </button>
              <button
                onClick={() => void toggleList(card)}
                aria-label={inList ? 'Remove from My List' : 'Add to My List'}
                className="grid size-6 shrink-0 place-items-center rounded-md bg-white/15 text-white hover:bg-white/25"
              >
                <Plus className={cn('size-3.5 transition-transform', inList && 'rotate-45 text-shasta-accent')} />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-start gap-1">
          <button onClick={() => onOpen(card)} className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-medium">{card.title}</p>
            <p className="truncate text-[11px] text-shasta-muted">{[card.year, card.subtitle].filter(Boolean).join(' · ')}</p>
          </button>
        </div>
      </div>
    </div>
  )
}

function ArrowButton({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}
      className={cn(
        'absolute top-[38%] z-30 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-shasta-chrome/90 text-shasta-fg shadow-lg backdrop-blur transition hover:bg-shasta-hover md:grid',
        dir < 0 ? '-left-3' : '-right-3',
      )}
    >
      <Icon className="size-5" />
    </button>
  )
}

export function Scroller({ children }: { children: ReactNode }) {
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
        className="flex gap-3 overflow-x-auto scroll-smooth px-1 pb-2 pt-1 snap-x snap-mandatory outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <ArrowButton dir={-1} onClick={() => scroll(-1)} />
      <ArrowButton dir={1} onClick={() => scroll(1)} />
    </div>
  )
}

/** A discovery row. The scroll container aligns to the page padding so cards are never clipped, and the row only
 *  fetches once it is scrolled near (lazy), then drops itself if the source returned nothing. */
export function RowSection({ rowKey, title, onOpen }: { rowKey: string; title: string; onOpen: (c: Card, play?: boolean) => void }) {
  const [items, setItems] = useState<Card[] | null>(rowCache.get(rowKey) ?? null)
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLElement>(null)

  useEffect(() => {
    if (items) return
    const el = box.current
    if (!el) return
    const ctl = new AbortController()
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        watchApi
          .row(rowKey, ctl.signal)
          .then((d) => {
            rowCache.set(rowKey, d.items)
            setItems(d.items)
          })
          .catch((e) => {
            if ((e as Error).name !== 'AbortError') setFailed(true)
          })
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      ctl.abort()
    }
  }, [rowKey, items])

  const data = items ?? rowCache.get(rowKey)
  if (data && data.length === 0) return null
  if (failed && !data) return null

  return (
    <section ref={box} className="mt-6">
      <h2 className="mb-1 px-1 text-sm font-semibold tracking-tight text-shasta-fg sm:text-base">{title}</h2>
      {!data ? (
        <div className="flex gap-3 overflow-hidden px-1 pt-1">
          {Array.from({ length: 7 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <Scroller>
          {data.map((c) => <MediaCard key={`${c.kind}:${c.id}`} card={c} onOpen={onOpen} fixed />)}
        </Scroller>
      )}
    </section>
  )
}

export function Hero({ items, onOpen }: { items: Featured[]; onOpen: (c: Card, play?: boolean) => void }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(true)
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
      className="relative -mx-4 sm:-mx-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      aria-roledescription="carousel"
    >
      <div className="relative h-[46vh] min-h-[320px] w-full overflow-hidden sm:h-[56vh]">
        {items.map((f, idx) => (
          <div key={`${f.kind}:${f.id}`} className={cn('absolute inset-0 transition-opacity duration-700', idx === i ? 'opacity-100' : 'opacity-0')} aria-hidden={idx !== i}>
            <img src={f.backdrop} crossOrigin={MEDIA_CORS} alt="" className="size-full object-cover" fetchPriority={idx === 0 ? 'high' : 'low'} loading={idx === 0 ? 'eager' : 'lazy'} />
          </div>
        ))}
        {/* black-based overlays so white text stays legible on any backdrop; strong at the bottom, soft on the left */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-6xl px-4 pb-7 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-shasta-accent/90 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">{active.reason}</span>
            <span className="text-[11px] uppercase tracking-wide text-white/70">{active.kind === 'anime' ? 'Anime' : active.kind === 'tv' ? 'Series' : 'Film'}</span>
          </div>
          {active.logo ? (
            <img src={active.logo} crossOrigin={MEDIA_CORS} alt={active.title} className="mt-2 h-12 w-auto max-w-[70%] object-contain object-left drop-shadow-lg sm:h-16" />
          ) : (
            <h1 className="mt-1 max-w-2xl text-2xl font-bold text-white drop-shadow-lg sm:text-4xl">{active.title}</h1>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/85">
            {active.year && <span>{active.year}</span>}
            {active.rating ? <span className="flex items-center gap-1 text-amber-300"><Star className="size-3 fill-amber-300" /> {active.rating}%</span> : null}
            {active.genres.slice(0, 3).map((g) => <span key={g} className="rounded-full bg-white/15 px-2 py-0.5">{g}</span>)}
          </p>
          <p className="mt-2 max-w-2xl line-clamp-3 text-sm leading-relaxed text-white/85">{active.overview}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => onOpen(active, true)} className="flex items-center gap-2 rounded-lg bg-shasta-accent px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:brightness-110">
              <Play className="size-4 fill-white" /> Watch Now
            </button>
            <button onClick={() => onOpen(active)} className="flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25">
              <Info className="size-4" /> View Details
            </button>
            <button onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute hero' : 'Mute hero'} className="grid size-9 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20">
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-3 right-4 flex gap-1.5 sm:right-6">
          {items.map((f, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Featured ${idx + 1}: ${f.title}`}
              aria-current={idx === i}
              className={cn('h-1.5 rounded-full transition-all', idx === i ? 'w-6 bg-shasta-accent' : 'w-3 bg-white/40 hover:bg-white/70')}
            />
          ))}
        </div>
      )}
    </section>
  )
}
