import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { appPath, useStoreNav } from './nav'
import { AppAction, AppIcon } from './components'
import type { AppCard } from './types'
import { MEDIA_CORS } from '@/lib/appApi'

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

/** below this width a banner would be stretched across the hero: it is shown as a framed poster instead */
const SHARP_WIDTH = 1000

/**
 * The slide's artwork. Big, wide art fills the hero. Small, portrait or missing art (most imported games only have a
 * small thumbnail) would look blurry stretched, so it becomes a blurred backdrop of itself with the sharp image framed
 * at its natural size on the right; with no art at all, the app's icon plays that part.
 */
function HeroArt({ app }: { app: AppCard }) {
  const [mode, setMode] = useState<'cover' | 'poster' | 'unknown'>(app.bannerUrl ? 'unknown' : 'poster')
  const src = app.bannerUrl ?? app.iconUrl
  if (!src) return null
  const art = (cls: string, extra?: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img crossOrigin={MEDIA_CORS} src={src} alt="" draggable={false} decoding="async" fetchPriority="high" className={cls} {...extra} />
  )
  if (mode !== 'poster')
    return art(cn('absolute inset-0 size-full object-cover transition-opacity duration-300', mode === 'unknown' && 'opacity-0'), {
      onLoad: (e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
        setMode(w >= SHARP_WIDTH && w > h * 1.3 ? 'cover' : 'poster')
      },
      onError: () => setMode('poster'),
    })
  const icon = !app.bannerUrl
  return (
    <>
      {art('absolute inset-0 size-full scale-125 object-cover opacity-70 blur-2xl saturate-150')}
      <div className="absolute inset-0 bg-black/25" aria-hidden />
      <div className="absolute inset-y-0 right-0 hidden w-[44%] items-center justify-center px-12 pt-16 pb-28 md:flex" aria-hidden>
        {art(cn('max-h-full max-w-full shadow-2xl ring-1 ring-white/20', icon ? 'aspect-square w-56 rounded-[22%] object-cover' : 'rounded-2xl object-contain'))}
      </div>
    </>
  )
}

/** Featured carousel: the apps the owner picked. Rotates slowly, stops while hovered or focused. */
export function Hero({ apps }: { apps: AppCard[] }) {
  const { go } = useStoreNav()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const n = apps.length
  useEffect(() => {
    if (n < 2 || paused || reduced) return
    const t = setInterval(() => setI((x) => (x + 1) % n), 7000)
    return () => clearInterval(t)
  }, [n, paused, reduced])
  useEffect(() => {
    setI((x) => Math.min(x, Math.max(n - 1, 0)))
  }, [n])
  const app = apps[i]
  // warm the next slide's artwork so the rotation never shows an empty frame
  const next = n > 1 ? apps[(i + 1) % n] : null
  useEffect(() => {
    if (!next?.bannerUrl) return
    const img = new Image()
    img.crossOrigin = MEDIA_CORS ?? null
    img.src = next.bannerUrl
  }, [next?.bannerUrl])
  if (!app) return null

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative mb-8 overflow-hidden rounded-3xl ring-1 ring-shasta-line"
    >
      <div
        className="relative flex min-h-72 flex-col justify-end gap-3 overflow-hidden p-6 sm:min-h-[26rem] sm:p-10"
        style={{ backgroundColor: `oklch(0.34 0.09 ${hue(app.name)})` }}
      >
        {/* <img>, not CSS backgrounds: only an image element can load in CORS mode, which the installed app needs */}
        <HeroArt key={app.id} app={app} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" aria-hidden />
        <span className="relative w-fit rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase backdrop-blur">Featured</span>
        <div className="relative flex flex-wrap items-end gap-4 text-white">
          <AppIcon app={app} size={96} eager className="shadow-2xl ring-2 ring-white/25" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-3xl font-bold tracking-tight sm:text-5xl">{app.name}</h2>
            <p className="mt-2 line-clamp-2 max-w-xl text-sm text-white/85 sm:text-base">{app.summary}</p>
            <p className="mt-1 text-xs text-white/70">{[app.developer, app.genres?.length ? app.genres.slice(0, 2).map((g) => g.name).join(', ') : app.category?.name].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="h-10 rounded-full px-5" onClick={() => go(appPath(app.slug))}>Details</Button>
            <AppAction app={app} size="lg" />
          </div>
        </div>
      </div>
      {n > 1 && (
        <>
          <button aria-label="Previous featured app" onClick={() => setI((i - 1 + n) % n)} className="absolute top-1/2 left-3 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white hover:bg-black/65">
            <ChevronLeft className="size-5" />
          </button>
          <button aria-label="Next featured app" onClick={() => setI((i + 1) % n)} className="absolute top-1/2 right-3 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white hover:bg-black/65">
            <ChevronRight className="size-5" />
          </button>
          <div className="absolute top-4 right-5 hidden gap-2 sm:flex" role="tablist" aria-label="Choose a featured app">
            {apps.map((a, k) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={k === i}
                aria-label={a.name}
                onClick={() => setI(k)}
                className={cn('overflow-hidden rounded-xl ring-2 transition-all', k === i ? 'scale-110 opacity-100 ring-white' : 'opacity-60 ring-transparent hover:opacity-100')}
              >
                <AppIcon app={a} size={36} />
              </button>
            ))}
          </div>
          <div className="absolute top-4 right-5 flex gap-1.5 sm:hidden" aria-hidden>
            {apps.map((a, k) => <span key={a.id} className={cn('h-1.5 rounded-full transition-all', k === i ? 'w-6 bg-white' : 'w-1.5 bg-white/50')} />)}
          </div>
        </>
      )}
    </section>
  )
}
