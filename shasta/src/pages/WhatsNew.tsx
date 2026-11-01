import { useEffect, useMemo, useState, type ReactNode } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, AudioLines, Bookmark, ChevronLeft, Cloud, Gamepad2, Heart, Laptop, Smartphone, Sparkles } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { buttonVariants } from '@/components/ui/button'
import { QrImage } from '@/components/DiscordQr'
import { openSaveShasta, phoneAddress } from '@/lib/saveShasta'
import { firstVisit } from '@/lib/whatsNew'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'
import SaveDemo from '@/components/demos/SaveDemo'
import { WelcomeDemo } from '@/components/whatsNew/WelcomeDemo'
import { CloudDemo } from '@/components/whatsNew/CloudDemo'
import { HomeDemo } from '@/components/whatsNew/HomeDemo'
import { MediaDemo } from '@/components/whatsNew/MediaDemo'
import { StoreDemo } from '@/components/whatsNew/StoreDemo'
import { PhonePadDemo } from '@/components/whatsNew/PhonePadDemo'
import { controllerOrigin } from '@/lib/phonePad'
import { useDark } from '@/components/whatsNew/useDark'

/** One topic per slide, ONE short sentence each: people skim this on their way to something else, so keep it to a few
 *  slides (owner feedback 2026-10-31: the 15-slide tour was too long). Colour: ONE solid accent per slide, used only for the
 *  eyebrow and the bullet dots (default = Shasta's own accent). No gradient text, glow blobs, dot grids or two-colour
 *  gradient buttons (2026-10-31: people called that look "AI"); the demos carry the colour. */
type Slide = { icon: ReactNode; demo?: ReactNode; eyebrow: string; title: string; body?: ReactNode; points?: string[]; accent?: string; cta?: 'save' }

/** Only for a browser that has never seen this page. */
const WELCOME: Slide = {
  icon: <Logo className="size-10" />,
  demo: <WelcomeDemo />,
  eyebrow: 'Shasta',
  title: 'A whole browser in one tab',
  body: <>Games, shows and an AI that stays on your device. It's in beta, so things change fast.</>,
}

/** The latest update. Replace these (and bump WHATS_NEW_VERSION in lib/whatsNew.ts) with each update worth announcing.
 *  2026-11-01 (owner picked the topics, order is ours): the big new thing first, then games, then the rest, and the
 *  thank-you right before the one thing we ask (save Shasta), so the ask lands last. */
const UPDATE: Slide[] = [
  {
    icon: <Cloud />,
    // a Cloud title picked from the Store and its stream starting (components/whatsNew/CloudDemo.tsx)
    demo: <CloudDemo />,
    eyebrow: 'New',
    title: 'Cloud gaming is here',
    body: <>Play 200+ big PC games streamed from a gaming PC, with nothing to download. More are on the way.</>,
  },
  {
    icon: <Laptop />,
    // honest scope (CLAUDE.md "Memory64 games on Chrome < 133"): games built for newer Chrome now start on older
    // school Chromebooks, but a game that needs more graphics power than the computer has still cannot run
    eyebrow: 'Faster games',
    title: 'Big games on school Chromebooks',
    body: <>More big games now start on older school Chromebooks, and Shasta tells you when one can't.</>,
  },
  {
    icon: <Gamepad2 />,
    // the phone controller joining a game (components/whatsNew/PhonePadDemo.tsx)
    demo: <PhonePadDemo qr={`${controllerOrigin() ?? location.origin}/pad.html`} />,
    eyebrow: 'Game mode',
    title: 'Play your way',
    body: <>Remap the keys of any game, plug in a USB or Bluetooth controller, or scan the code and use your phone.</>,
  },
  {
    icon: <AudioLines />,
    // the Now playing banner dropping from the toolbar, then the controls (components/whatsNew/MediaDemo.tsx)
    demo: <MediaDemo />,
    eyebrow: 'New',
    title: 'See what\'s playing',
    body: <>Play music or a video in any tab and the toolbar shows the song, with play, skip and seek in one place.</>,
  },
  {
    icon: <Sparkles />,
    // the redesign and the new tab are one story (owner, 2026-11-01): the widgets settling in, then the search bar
    // switched off (components/whatsNew/HomeDemo.tsx); the sentence carries the rest of this update's UI work
    demo: <HomeDemo />,
    eyebrow: 'Redesigned',
    title: 'A calmer Shasta, made yours',
    body: <>Clearer text and calmer colours everywhere, a new tab you build from widgets, and holiday looks with real photos.</>,
  },
  {
    icon: <Heart />,
    // the Store's count past 32,000 and the real visitor numbers (components/whatsNew/StoreDemo.tsx)
    demo: <StoreDemo />,
    eyebrow: 'Thank you',
    title: '32,000 apps and games, and you',
    body: <>The Store passed 32,000 apps and games, and more than 800 of you found Shasta in its first three days of counting.</>,
  },
  {
    icon: <Smartphone />,
    demo: <SaveSlideDemo />,
    eyebrow: "Don't lose us",
    title: 'Scan the code and bookmark us',
    body: <>Scan this to join our Discord (new links land there if Shasta gets blocked), then bookmark this site in your browser's own bookmarks.</>,
    cta: 'save',
  },
]

/** The Save slide's demo (components/demos/SaveDemo.tsx, also in the Save Shasta dialog): why the Discord matters. */
function SaveSlideDemo() {
  const dark = useDark()
  return <SaveDemo dark={dark} />
}

/** Two columns (demo beside the words) from this width up; below it the slide stacks and the demos use their phone layout. */
const SIDE = '(min-width: 768px)'
/** a small keycap, like the toolbar tooltips' shortcut hint */
const KEY = 'grid h-5 min-w-5 place-items-center rounded-[4px] border border-shasta-line bg-shasta-field px-1 font-mono text-[11px] leading-none text-shasta-muted'
function useSide() {
  const [side, setSide] = useState(() => matchMedia(SIDE).matches)
  useEffect(() => {
    const mq = matchMedia(SIDE)
    const on = () => setSide(mq.matches)
    mq.addEventListener('change', on)
    return () => {
      mq.removeEventListener('change', on)
    }
  }, [])
  return side
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** shasta://whats-new: the latest update (plus a Welcome slide for a first visit), shown once per WHATS_NEW_VERSION. */
export default function WhatsNewPage() {
  const open = useTabs((s) => s.openInternal)
  const still = useReducedMotion()
  const [viewport, embla] = useEmblaCarousel({ duration: still ? 1 : 28 })
  const [index, setIndex] = useState(0)
  const SLIDES = useMemo(() => (firstVisit ? [WELCOME, ...UPDATE] : UPDATE), [])
  const phoneLink = phoneAddress()
  const last = index === SLIDES.length - 1
  const side = useSide()

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
    <div className="relative isolate flex min-h-full flex-col overflow-clip bg-shasta-bg text-shasta-fg">

      <header className="flex items-center justify-between px-6 pt-3 [@media(min-height:760px)]:pt-5 text-xs text-shasta-muted">
        <span className="flex items-center gap-2 font-medium">
          <Logo className="size-4" /> Shasta
          <span className="sh-meta">Beta</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="font-mono tabular-nums text-shasta-faint">
            {index + 1} / {SLIDES.length}
          </span>
          {!last && (
            <button className="h-7 rounded-lg px-2.5 font-medium transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg" onClick={() => open('newtab')}>
              Skip
            </button>
          )}
        </span>
      </header>

      <section aria-roledescription="carousel" aria-label="Shasta tour" className="flex flex-1 flex-col justify-center py-2 [@media(min-height:760px)]:py-8">
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
                  <div
                    className={cn(
                      'flex flex-col items-center text-center',
                      // with a demo: side by side on a wide screen (a 600px demo over the words does not fit a Chromebook's height)
                      s.demo ? 'w-full max-w-6xl md:flex-row md:items-center md:gap-10 md:text-left lg:gap-14' : 'max-w-2xl',
                    )}
                  >
                    {s.demo ? (
                      // mounted only while in front, so the demo plays from its start each time the slide is shown
                      <motion.div
                        {...rise(0)}
                        // side by side: the demo keeps its wide composition, scaled to the height that is left (a Chromebook
                        // window minus the toolbar, the ad bar and this page's header and buttons); stacked: its phone layout
                        data-ss-wide={side || undefined}
                        className="-mb-2 w-[600px] min-w-0 max-w-[min(100%,max(300px,calc((100dvh-600px)*1.67)))] shrink-0 md:mb-0 md:max-w-[min(56%,max(300px,calc((100dvh-420px)*1.67)))]"
                      >
                        {on && s.demo}
                      </motion.div>
                    ) : (
                      <motion.div
                        {...rise(0)}
                        animate={on || still ? { opacity: 1, scale: 1, rotate: 0 } : { opacity: 0, scale: 0.94, rotate: 0 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: on ? 0.05 : 0 }}
                        className="grid size-20 place-items-center rounded-2xl bg-shasta-home text-shasta-muted ring-1 ring-shasta-line [&_svg]:size-8 [&_svg]:stroke-[1.5]"
                      >
                        {s.icon}
                      </motion.div>
                    )}
                    <div className={cn('flex min-w-0 flex-col items-center', s.demo && 'md:flex-1 md:items-start')}>
                    <motion.p {...rise(0.1)} className={cn('mt-8 text-sm font-medium', !s.accent && 'text-shasta-accent')} style={s.accent ? { color: s.accent } : undefined}>
                      {s.eyebrow}
                    </motion.p>
                    <motion.h1
                      {...rise(0.16)}
                      className="sh-display mt-3 text-balance text-shasta-fg"
                    >
                      {s.title}
                    </motion.h1>
                    {s.body && (
                      <motion.p {...rise(0.24)} className="mt-5 max-w-[36rem] text-base leading-relaxed text-pretty text-shasta-muted sm:text-lg">
                        {s.body}
                      </motion.p>
                    )}
                    {s.points && (
                      <motion.ul {...rise(0.24)} className="mt-5 grid gap-1.5 text-left text-sm">
                        {s.points.map((p) => (
                          <li key={p} className="flex items-center gap-3 rounded-lg bg-shasta-home px-3.5 py-2 ring-1 ring-shasta-line">
                            <span className={cn('size-1.5 shrink-0 rounded-full', !s.accent && 'bg-shasta-accent')} style={s.accent ? { background: s.accent } : undefined} />
                            <span className="text-shasta-muted">{p}</span>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                    {s.cta === 'save' && phoneLink && (
                      <motion.div {...rise(0.32)} className="mt-6 flex items-center gap-4 text-left">
                        <QrImage value={phoneLink} label="QR code to open Shasta on your phone" className="size-28 shrink-0 p-1.5 shadow-lg ring-1 ring-shasta-line" />
                        <div className="grid justify-items-start gap-2">
                          <p className="text-sm text-shasta-muted">Point your phone's camera here.</p>
                          <button className={buttonVariants({ variant: 'outline' })} onClick={() => openSaveShasta()} tabIndex={on ? 0 : -1}>
                            <Bookmark /> Other ways to save it
                          </button>
                        </div>
                      </motion.div>
                    )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <footer className="sticky bottom-0 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-shasta-bg from-60% to-transparent px-6 pt-4 pb-4 [@media(min-height:760px)]:pb-8">
        <div className="flex items-center gap-4">
          <button
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), 'rounded-lg text-shasta-muted')}
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
                className={cn('h-1.5 rounded-full transition-colors duration-150 ease-shasta', i === index ? 'w-6 bg-shasta-fg' : 'w-1.5 bg-shasta-line hover:bg-shasta-faint')}
              />
            ))}
          </div>
          <button
            className="sh-press inline-flex h-10 items-center gap-2 rounded-lg bg-shasta-fg px-4 text-sm font-medium text-shasta-bg shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:opacity-90"
            onClick={() => (last ? open('newtab') : embla?.scrollNext())}
          >
            {last ? 'Start browsing' : 'Next'} <ArrowRight className="size-4" />
          </button>
        </div>
        <p className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-shasta-faint [@media(max-height:700px)]:hidden">
          <kbd className={KEY}>←</kbd><kbd className={KEY}>→</kbd> or swipe <span aria-hidden>·</span> Main menu, then What's new, shows it again
        </p>
      </footer>
    </div>
  )
}
