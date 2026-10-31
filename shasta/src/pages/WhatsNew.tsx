import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Bookmark, ChevronLeft, Film, Smartphone, Sparkles } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { buttonVariants } from '@/components/ui/button'
import { QrImage } from '@/components/DiscordQr'
import { Pumpkin } from '@/components/seasonal/Halloween'
import { claimHalloween, useHalloween } from '@/lib/seasonal'
import { openSaveShasta, phoneAddress } from '@/lib/saveShasta'
import { firstVisit } from '@/lib/whatsNew'
import { useSettings } from '@/stores/settingsStore'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'

/** One topic per slide, ONE short sentence each: people skim this on their way to something else, so keep it to a few
 *  slides (owner feedback 2026-10-31: the 15-slide tour was too long). `a`/`b` colour the backdrop and the icon tile. */
type Slide = { icon: ReactNode; eyebrow: string; title: string; body?: ReactNode; points?: string[]; a: string; b: string; cta?: 'halloween' | 'save' }

/** Only for a browser that has never seen this page. */
const WELCOME: Slide = {
  icon: <Logo className="size-10" />,
  eyebrow: 'Welcome',
  title: 'Welcome to Shasta',
  body: <>A whole browser in a tab, with games, shows and an AI that stays on your device. It's in beta, so things change fast.</>,
  a: '#5b6cff',
  b: '#c04dff',
}

/** The latest update. Replace these (and bump WHATS_NEW_VERSION in lib/whatsNew.ts) with each update worth announcing. */
const UPDATE: Slide[] = [
  {
    icon: <Pumpkin className="size-12" />,
    eyebrow: 'Halloween update',
    title: 'Shasta got spooky',
    body: <>A haunted new tab, plus Halloween picks in Watch and the Store. Here until November 1.</>,
    a: '#f97316',
    b: '#a855f7',
    cta: 'halloween',
  },
  {
    icon: <Smartphone />,
    eyebrow: "Don't lose us",
    title: 'Save Shasta on your phone',
    body: <>Scan this to join our Discord (new links land there if Shasta gets blocked) and add Shasta to your home screen.</>,
    a: '#5865f2',
    b: '#06b6d4',
    cta: 'save',
  },
  {
    icon: <Sparkles />,
    eyebrow: 'Small fixes',
    title: 'A few nice touches',
    points: ["Who's online sits at the top of the new tab. Hover it to see what's popular.", "Fold away the Halloween sections if they're not your thing.", 'Every Discord button now has a QR code for your phone.'],
    a: '#22c55e',
    b: '#14b8a6',
  },
]

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** shasta://whats-new: the latest update (plus a Welcome slide for a first visit), shown once per WHATS_NEW_VERSION. */
export default function WhatsNewPage() {
  const open = useTabs((s) => s.openInternal)
  const still = useReducedMotion()
  const [viewport, embla] = useEmblaCarousel({ duration: still ? 1 : 28 })
  const [index, setIndex] = useState(0)
  const SLIDES = useMemo(() => (firstVisit ? [WELCOME, ...UPDATE] : UPDATE), [])
  const slide = SLIDES[index]
  const halloween = useHalloween()
  const claimed = useSettings((s) => s.settings.claimedWallpapers.includes('halloween'))
  const phoneLink = phoneAddress()
  const last = index === SLIDES.length - 1

  useEffect(() => {
    if (!embla) return
    const onSelect = () => setIndex(embla.selectedScrollSnap())
    onSelect()
    embla.on('select', onSelect).on('reInit', onSelect)
    return () => {
      embla.off('select', onSelect).off('reInit', onSelect)
    }
  }, [embla])

  // the page is mounted only while its tab is in front, so the arrow keys can belong to it (unless someone is typing, e.g. in the address bar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowRight') embla?.scrollNext()
      else if (e.key === 'ArrowLeft') embla?.scrollPrev()
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
    }
  }, [embla])

  return (
    <div
      className="relative isolate flex min-h-full flex-col overflow-hidden text-shasta-fg"
      style={{ '--wn-a': slide.a, '--wn-b': slide.b } as CSSProperties}
    >
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="wn-blob wn-blob-a" />
        <div className="wn-blob wn-blob-b" />
        <div className="wn-grid" />
      </div>

      <header className="flex items-center justify-between px-6 pt-5 text-xs text-shasta-muted">
        <span className="flex items-center gap-2 font-medium">
          <Logo className="size-4" /> Shasta
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-500 uppercase">
            Beta
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums">
            {index + 1} / {SLIDES.length}
          </span>
          {!last && (
            <button className="rounded-full px-2.5 py-1 font-medium hover:bg-shasta-hover hover:text-shasta-fg" onClick={() => open('newtab')}>
              Skip
            </button>
          )}
        </span>
      </header>

      <section aria-roledescription="carousel" aria-label="Shasta tour" className="flex flex-1 flex-col justify-center py-8">
        <div ref={viewport} className="overflow-hidden">
          <div className="flex touch-pan-y">
            {SLIDES.map((s, i) => {
              const on = i === index
              const rise = (delay: number) => ({
                initial: false as const,
                animate: on || still ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 18, filter: 'blur(6px)' },
                transition: { duration: 0.55, delay: on ? delay : 0, ease: [0.22, 1, 0.36, 1] as const },
              })
              return (
                <div
                  key={s.title}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${SLIDES.length}`}
                  aria-hidden={!on}
                  className="flex min-w-0 flex-[0_0_100%] justify-center px-6"
                >
                  <div className="flex max-w-2xl flex-col items-center text-center">
                    <motion.div
                      {...rise(0)}
                      animate={on || still ? { opacity: 1, scale: 1, rotate: 0 } : { opacity: 0, scale: 0.6, rotate: -12 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 18, delay: on ? 0.05 : 0 }}
                      className="wn-glow grid size-20 place-items-center rounded-3xl text-white [&_svg]:size-9"
                      style={{ background: `linear-gradient(135deg, ${s.a}, ${s.b})` }}
                    >
                      {s.icon}
                    </motion.div>
                    <motion.p {...rise(0.1)} className="mt-7 text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: s.a }}>
                      {s.eyebrow}
                    </motion.p>
                    <motion.h1
                      {...rise(0.16)}
                      className="mt-3 bg-clip-text text-4xl font-semibold tracking-tight text-balance text-transparent sm:text-5xl"
                      style={{ backgroundImage: `linear-gradient(120deg, var(--color-shasta-fg) 30%, ${s.a} 70%, ${s.b})` }}
                    >
                      {s.title}
                    </motion.h1>
                    {s.body && (
                      <motion.p {...rise(0.24)} className="mt-5 text-base leading-relaxed text-pretty text-shasta-muted sm:text-lg">
                        {s.body}
                      </motion.p>
                    )}
                    {s.points && (
                      <motion.ul {...rise(0.24)} className="mt-6 grid gap-2 text-left text-sm sm:text-base">
                        {s.points.map((p) => (
                          <li key={p} className="flex items-start gap-2.5 rounded-xl bg-shasta-home/70 px-4 py-2.5 ring-1 ring-shasta-line backdrop-blur">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full" style={{ background: s.a }} />
                            <span className="text-shasta-muted">{p}</span>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                    {s.cta === 'halloween' && (
                      <motion.div {...rise(0.32)} className="mt-7 flex flex-wrap justify-center gap-2">
                        {halloween && !claimed && (
                          <button className={buttonVariants({ size: 'lg' })} onClick={claimHalloween} tabIndex={on ? 0 : -1}>
                            <Pumpkin className="size-5" /> Keep the Halloween background
                          </button>
                        )}
                        <button className={buttonVariants({ variant: 'outline', size: 'lg' })} onClick={() => open('watch')} tabIndex={on ? 0 : -1}>
                          <Film /> Halloween picks on Watch
                        </button>
                      </motion.div>
                    )}
                    {s.cta === 'save' && phoneLink && (
                      <motion.div {...rise(0.32)} className="mt-6 grid justify-items-center gap-3">
                        <QrImage value={phoneLink} label="QR code to open Shasta on your phone" className="size-40 p-1.5 shadow-lg ring-1 ring-shasta-line" />
                        <button className={buttonVariants({ variant: 'outline' })} onClick={() => openSaveShasta()} tabIndex={on ? 0 : -1}>
                          <Bookmark /> Other ways to save it
                        </button>
                      </motion.div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <footer className="flex flex-col items-center gap-4 px-6 pb-8">
        <div className="flex items-center gap-4">
          <button
            className={cn(buttonVariants({ variant: 'outline', size: 'icon-lg' }), 'rounded-full bg-shasta-bg/60 backdrop-blur')}
            onClick={() => embla?.scrollPrev()}
            disabled={index === 0}
            aria-label="Previous"
          >
            <ChevronLeft />
          </button>
          <div className="flex gap-1.5">
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => embla?.scrollTo(i)}
                className={cn('h-2 rounded-full transition-all duration-300', i === index ? 'w-7' : 'w-2 bg-shasta-line hover:bg-shasta-muted')}
                style={i === index ? { background: `linear-gradient(90deg, ${slide.a}, ${slide.b})` } : undefined}
              />
            ))}
          </div>
          <button
            className="wn-glow inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{ background: `linear-gradient(135deg, ${slide.a}, ${slide.b})` }}
            onClick={() => (last ? open('newtab') : embla?.scrollNext())}
          >
            {last ? 'Start browsing' : 'Next'} <ArrowRight className="size-4" />
          </button>
        </div>
        <p className="text-xs text-shasta-muted">← → or swipe · Main menu → What's new to see it again</p>
      </footer>
    </div>
  )
}
