// Shasta Watch — the Reader. Two readers in one: an **image reader** for manga/comics (continuous
// top-down/webtoon scroll, or paged single/double with a left-to-right or right-to-left direction) and a
// **text reader** for books/light novels (typography, width, theme, chapter navigation). Playback uses the same
// proxied-stream plumbing as the video player: every page image and the chapter text come over Shasta's host.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Columns, Download, Gauge, Loader2, Maximize, Minimize, Rows, Settings, Type,
} from 'lucide-react'
import { MEDIA_CORS } from '@/lib/appApi'
import { apiUrl, streamUrl, watchApi, WatchError } from './api'
import type { Kind, ReadPages, ReadText, Title } from './types'
import { cn } from '@/lib/utils'

export interface ReaderProps {
  title: Title
  chapter: number
  startPage?: number
  onChapter: (n: number) => void
  onClose: () => void
  onProgress?: (chapter: number, page: number) => void
}

const isImageKind = (k: Kind) => k === 'manga' || k === 'comic'

export function Reader(props: ReaderProps) {
  return isImageKind(props.title.kind) ? <ImageReader {...props} /> : <TextReader {...props} />
}

// ---- prefs (device-local, like the rest of Watch) -----------------------------------------------------------------

interface Prefs {
  mode: 'vertical' | 'paged'
  direction: 'ltr' | 'rtl'
  fit: 'width' | 'height' | 'original'
  zoom: number
  theme: 'light' | 'sepia' | 'dark'
  serif: boolean
  size: number
  width: number
}
const PREF_KEY = 'shasta-reader-prefs'
const DEFAULT_PREFS: Prefs = { mode: 'vertical', direction: 'rtl', fit: 'width', zoom: 1, theme: 'dark', serif: true, size: 19, width: 680 }

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return DEFAULT_PREFS
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p))
  } catch {
    /* private window */
  }
}

const btn = 'grid size-9 shrink-0 place-items-center rounded-lg text-white/90 transition-colors duration-150 ease-shasta hover:bg-white/15 disabled:opacity-40'
const menu = 'flex h-9 w-full items-center justify-between gap-3 rounded-md px-2.5 text-left text-sm text-white hover:bg-white/10'

// ---- image reader (manga / comics) --------------------------------------------------------------------------------

function ImageReader({ title, chapter, startPage = 1, onChapter, onClose, onProgress }: ReaderProps) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [data, setData] = useState<ReadPages | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(startPage)
  const [showUi, setShowUi] = useState(true)
  const [showSet, setShowSet] = useState(false)
  const [full, setFull] = useState(false)
  const update = (patch: Partial<Prefs>) => setPrefs((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })

  const pages = data?.pages ?? []
  const total = data?.total ?? null
  const atFirst = chapter <= 1
  const atLast = total != null && chapter >= total

  // load the chapter's pages
  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setData(null)
    watchApi.pages(title.kind, title.id, chapter)
      .then((d) => { if (live) { setData(d); setPage(startPage) } })
      .catch((e) => { if (live) setError(e instanceof WatchError ? e.message : 'Could not load this chapter.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [title.kind, title.id, chapter])

  // resume: jump to the saved page once the pages are in
  useLayoutEffect(() => {
    if (loading || !pages.length) return
    if (prefs.mode === 'vertical') {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${startPage}"]`)
      if (el && startPage > 1) el.scrollIntoView({ block: 'start' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, chapter])

  const turn = useCallback((dir: -1 | 1) => {
    if (prefs.mode === 'paged') {
      const step = 1
      const next = page + dir * step
      if (next >= 1 && next <= pages.length) { setPage(next); onProgress?.(chapter, next) }
      else if (dir === 1 && !atLast) onChapter(chapter + 1)
      else if (dir === -1 && !atFirst) onChapter(chapter - 1)
    } else {
      const el = scroller.current
      if (el) el.scrollBy({ top: dir * el.clientHeight * 0.9, behavior: 'smooth' })
    }
  }, [prefs.mode, page, pages.length, chapter, atFirst, atLast, onChapter, onProgress])

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const k = e.key
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); turn(prefs.mode === 'paged' ? (prefs.direction === 'rtl' ? -1 : 1) : 1) }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); turn(prefs.mode === 'paged' ? (prefs.direction === 'rtl' ? 1 : -1) : -1) }
      else if (k === 'f') void toggleFull()
      else if (k === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, prefs.mode, prefs.direction, onClose])

  const toggleFull = useCallback(async () => {
    const el = box.current
    if (!el) return
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
    else await el.requestFullscreen?.().catch(() => undefined)
  }, [])
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  // track the current page while scrolling (vertical): report progress, show the page number
  useEffect(() => {
    if (prefs.mode !== 'vertical' || !pages.length) return
    const el = scroller.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top
        let best = 1
        const imgs = el.querySelectorAll<HTMLElement>('[data-page]')
        for (const img of imgs) {
          if (img.getBoundingClientRect().bottom > top + 8) { best = Number(img.dataset.page); break }
        }
        setPage(best)
        onProgress?.(chapter, best)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [prefs.mode, pages.length, chapter, onProgress])

  const imgSrc = (u: string, referer?: string) => apiUrl(streamUrl(u, referer))

  return (
    <div ref={box} className="relative h-[76vh] min-h-[420px] w-full overflow-hidden rounded-xl bg-black text-white">
      {loading && <div className="grid size-full place-items-center"><Loader2 className="size-8 animate-spin text-white/70" /></div>}
      {error && <div className="grid size-full place-items-center p-6 text-center text-sm text-white/80">{error}</div>}

      {!loading && !error && pages.length > 0 && (
        prefs.mode === 'vertical' ? (
          <div ref={scroller} className="size-full overflow-y-auto" onClick={() => setShowUi((v) => !v)}>
            <div className="mx-auto flex flex-col items-center" style={{ zoom: prefs.zoom }}>
              {pages.map((p, i) => (
                <img
                  key={i}
                  data-page={i + 1}
                  src={imgSrc(p.url, p.referer)}
                  crossOrigin={MEDIA_CORS}
                  alt=""
                  loading={i < 3 ? 'eager' : 'lazy'}
                  className={cn('block bg-neutral-900', prefs.fit === 'width' ? 'w-full max-w-[900px]' : prefs.fit === 'height' ? 'h-[76vh] w-auto' : 'w-auto max-w-none')}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid size-full place-items-center overflow-hidden" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const right = e.clientX - r.left > r.width / 2
            const forward = prefs.direction === 'rtl' ? !right : right
            turn(forward ? 1 : -1)
          }}>
            {(() => {
              const p = pages[page - 1]
              if (!p) return null
              return <img src={imgSrc(p.url, p.referer)} crossOrigin={MEDIA_CORS} alt="" className={cn('select-none', prefs.fit === 'height' ? 'h-full w-auto' : prefs.fit === 'width' ? 'max-h-full w-full object-contain' : 'max-h-none')} style={{ zoom: prefs.zoom }} />
            })()}
          </div>
        )
      )}

      {/* top bar */}
      <div className={cn('absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent p-3 transition-opacity duration-200 ease-shasta', showUi || loading ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        <button className={btn} onClick={onClose} aria-label="Back"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title.title}</p>
          <p className="truncate text-xs text-white/60">{data ? `${data.chapterTitle}` : ''}{total ? ` · ${title.format ?? ''} ${chapter}/${total}` : ''}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className={btn} disabled={atFirst} onClick={() => onChapter(chapter - 1)} aria-label="Previous chapter"><ChevronLeft className="size-5" /></button>
          <button className={btn} disabled={atLast} onClick={() => onChapter(chapter + 1)} aria-label="Next chapter"><ChevronRight className="size-5" /></button>
          <button className={cn(btn, showSet && 'bg-white/15')} onClick={() => setShowSet((v) => !v)} aria-label="Reader settings"><Settings className="size-5" /></button>
          <button className={btn} onClick={() => void toggleFull()} aria-label="Full screen">{full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}</button>
        </div>
      </div>

      {/* bottom: page indicator + progress */}
      {pages.length > 0 && (
        <div className={cn('absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-8 transition-opacity duration-200 ease-shasta', showUi ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
          <span className="font-mono text-xs tabular-nums text-white/80">{prefs.mode === 'vertical' ? page : `${page}`} / {pages.length}</span>
          <div className="h-0.5 flex-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-shasta-accent transition-[width] duration-150" style={{ width: `${(page / pages.length) * 100}%` }} /></div>
        </div>
      )}

      {/* settings */}
      {showSet && (
        <div className="absolute right-3 top-16 w-64 rounded-xl border border-white/10 bg-[#11141c]/95 p-2 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
          <p className="px-2 py-1 text-xs text-white/50">Layout</p>
          <div className="flex gap-1 px-1 pb-2">
            <Seg on={prefs.mode === 'vertical'} onClick={() => update({ mode: 'vertical' })} icon={<Rows className="size-4" />} label="Top-down" />
            <Seg on={prefs.mode === 'paged'} onClick={() => update({ mode: 'paged' })} icon={<Columns className="size-4" />} label="Paged" />
          </div>
          {prefs.mode === 'paged' && (
            <>
              <p className="px-2 py-1 text-xs text-white/50">Direction</p>
              <div className="flex gap-1 px-1 pb-2">
                <Seg on={prefs.direction === 'ltr'} onClick={() => update({ direction: 'ltr' })} label="Left → right" />
                <Seg on={prefs.direction === 'rtl'} onClick={() => update({ direction: 'rtl' })} label="Right → left" />
              </div>
            </>
          )}
          <p className="px-2 py-1 text-xs text-white/50">Fit</p>
          <div className="flex gap-1 px-1 pb-2">
            <Seg on={prefs.fit === 'width'} onClick={() => update({ fit: 'width' })} label="Width" />
            <Seg on={prefs.fit === 'height'} onClick={() => update({ fit: 'height' })} label="Height" />
            <Seg on={prefs.fit === 'original'} onClick={() => update({ fit: 'original' })} label="Original" />
          </div>
          <p className="px-2 py-1 text-xs text-white/50">Zoom · {Math.round(prefs.zoom * 100)}%</p>
          <input type="range" min={0.5} max={2.5} step={0.1} value={prefs.zoom} onChange={(e) => update({ zoom: Number(e.target.value) })} className="mx-2 mb-1 w-[calc(100%-16px)] accent-shasta-accent" />
          <div className="mt-1 border-t border-white/10 pt-1">
            <a className={menu} href={imgSrc(pages[Math.max(0, page - 1)]?.url ?? '', pages[0]?.referer)} target="_blank" rel="noreferrer"><span className="flex items-center gap-2"><Download className="size-4" /> Open page {page}</span></a>
          </div>
        </div>
      )}

      {prefs.mode === 'vertical' && pages.length > 3 && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/70">{prefs.fit === 'width' ? 'Webtoon scroll' : 'Scroll'}</div>
      )}
    </div>
  )
}

function Seg({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon?: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs', on ? 'bg-shasta-accent text-shasta-accent-fg' : 'bg-white/10 text-white/80 hover:bg-white/15')}>
      {icon}{label}
    </button>
  )
}

// ---- text reader (books / light novels) ----------------------------------------------------------------------------

function TextReader({ title, chapter, onChapter, onClose, onProgress }: ReaderProps) {
  const box = useRef<HTMLDivElement>(null)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [data, setData] = useState<ReadText | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showSet, setShowSet] = useState(false)
  const [progress, setProgress] = useState(0)
  const update = (patch: Partial<Prefs>) => setPrefs((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })

  const total = data?.total ?? title.totalEpisodes ?? null
  const idx = useMemo(() => (title.episodes ?? []).findIndex((e) => e.number === chapter), [title.episodes, chapter])
  const atFirst = data?.prev == null
  const atLast = data?.next == null

  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setData(null)
    watchApi.chapter(title.kind, title.id, chapter)
      .then((d) => { if (live) setData(d) })
      .catch((e) => { if (live) setError(e instanceof WatchError ? e.message : 'Could not load this chapter.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [title.kind, title.id, chapter])

  // reset scroll on chapter change; report progress on scroll
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.scrollTop = 0
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const max = el.scrollHeight - el.clientHeight
        setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 1)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [chapter, data])

  useEffect(() => { if (data) onProgress?.(chapter, idx >= 0 ? idx + 1 : 1) }, [data, chapter, idx, onProgress])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' || e.key === ']') { e.preventDefault(); if (!atLast) onChapter(chapter + 1) }
      else if (e.key === 'ArrowLeft' || e.key === '[') { e.preventDefault(); if (!atFirst) onChapter(chapter - 1) }
      else if (e.key === 'ArrowDown') box.current?.scrollBy({ top: 200, behavior: 'smooth' })
      else if (e.key === 'ArrowUp') box.current?.scrollBy({ top: -200, behavior: 'smooth' })
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chapter, atFirst, atLast, onChapter, onClose])

  const theme = { light: 'bg-[#fbfaf7] text-[#22201c]', sepia: 'bg-[#f3e9d6] text-[#3b2f22]', dark: 'bg-[#14141a] text-[#d9d7d2]' }[prefs.theme]

  return (
    <div ref={box} className={cn('relative h-[76vh] min-h-[420px] w-full overflow-y-auto rounded-xl', theme)}>
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-black/10 bg-inherit/95 px-3 py-2 backdrop-blur">
        <button className="grid size-9 place-items-center rounded-lg hover:bg-black/10" onClick={onClose} aria-label="Back"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title.title}</p>
          <p className="truncate text-xs opacity-60">{data?.chapterTitle ?? `Chapter ${chapter}`}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="grid size-9 place-items-center rounded-lg hover:bg-black/10 disabled:opacity-40" disabled={atFirst} onClick={() => onChapter(chapter - 1)} aria-label="Previous chapter"><ChevronLeft className="size-5" /></button>
          <button className="grid size-9 place-items-center rounded-lg hover:bg-black/10 disabled:opacity-40" disabled={atLast} onClick={() => onChapter(chapter + 1)} aria-label="Next chapter"><ChevronRight className="size-5" /></button>
          <button className={cn('grid size-9 place-items-center rounded-lg hover:bg-black/10', showSet && 'bg-black/10')} onClick={() => setShowSet((v) => !v)} aria-label="Reader settings"><Settings className="size-5" /></button>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/10"><div className="h-full bg-shasta-accent" style={{ width: `${progress * 100}%` }} /></div>
      </div>

      {showSet && (
        <div className="sticky top-[52px] z-20 mx-auto mt-2 flex w-fit max-w-[92%] flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-inherit/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
          <span className="opacity-60">Theme</span>
          {(['light', 'sepia', 'dark'] as const).map((t) => (
            <button key={t} onClick={() => update({ theme: t })} className={cn('rounded-md px-2 py-1 capitalize', prefs.theme === t ? 'bg-shasta-accent text-shasta-accent-fg' : 'bg-black/10')}>{t}</button>
          ))}
          <span className="ml-2 opacity-60"><Type className="inline size-4" /> Size</span>
          <input type="range" min={15} max={30} value={prefs.size} onChange={(e) => update({ size: Number(e.target.value) })} className="accent-shasta-accent" />
          <span className="opacity-60"><Gauge className="inline size-4" /> Width</span>
          <input type="range" min={480} max={960} step={20} value={prefs.width} onChange={(e) => update({ width: Number(e.target.value) })} className="accent-shasta-accent" />
          <button onClick={() => update({ serif: !prefs.serif })} className="ml-2 rounded-md bg-black/10 px-2 py-1">{prefs.serif ? 'Serif' : 'Sans'}</button>
        </div>
      )}

      <article
        className={cn('mx-auto px-5 py-8 leading-[1.75]', prefs.serif ? 'font-serif' : 'font-sans')}
        style={{ maxWidth: prefs.width, fontSize: prefs.size }}
      >
        <h1 className="mb-6 text-center text-xl font-semibold">{data?.chapterTitle ?? `Chapter ${chapter}`}</h1>
        {loading && <div className="grid place-items-center py-16"><Loader2 className="size-7 animate-spin opacity-60" /></div>}
        {error && <p className="text-center opacity-80">{error}</p>}
        {data && <div className="reader-body space-y-4 [&_p]:indent-6" dangerouslySetInnerHTML={{ __html: data.html }} />}

        {data && (
          <div className="mt-10 flex items-center justify-between gap-3 border-t border-black/10 pt-6 text-sm">
            <button disabled={atFirst} onClick={() => onChapter(chapter - 1)} className="flex items-center gap-1 rounded-lg px-3 py-2 hover:bg-black/10 disabled:opacity-40"><ChevronLeft className="size-4" /> Previous</button>
            {total && idx >= 0 && <span className="font-mono text-xs opacity-60 tabular-nums">{idx + 1} / {total}</span>}
            <button disabled={atLast} onClick={() => onChapter(chapter + 1)} className="flex items-center gap-1 rounded-lg px-3 py-2 hover:bg-black/10 disabled:opacity-40">Next <ChevronRight className="size-4" /></button>
          </div>
        )}
      </article>
    </div>
  )
}
