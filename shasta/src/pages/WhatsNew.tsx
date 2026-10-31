import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Activity,
  AppWindow,
  ArrowRight,
  Bot,
  ChevronLeft,
  Compass,
  Download,
  ExternalLink,
  Film,
  FlaskConical,
  Gamepad2,
  Globe,
  Heart,
  Library,
  MessagesSquare,
  ShieldAlert,
  WifiOff,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { buttonVariants } from '@/components/ui/button'
import { DISCORD_INVITE } from '@/lib/supporter'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'

/** One topic per slide; `a`/`b` colour the backdrop and the icon tile while it is showing. */
type Slide = { icon: ReactNode; eyebrow: string; title: string; body: ReactNode; a: string; b: string; cta?: 'community' | 'support' }

/** The latest update's slides, shown right after Welcome so returning people see them first. Replace them (and bump
 *  WHATS_NEW_VERSION in lib/whatsNew.ts) with each update worth announcing. */
const NEW = 'New · Oct 31'

const SLIDES: Slide[] = [
  {
    icon: <Logo className="size-10" />,
    eyebrow: 'Welcome',
    title: 'Welcome to Shasta',
    body: <>A whole browser that runs inside a tab, with a Store of games and apps and an AI that stays on your device.</>,
    a: '#5b6cff',
    b: '#c04dff',
  },
  {
    icon: <Globe />,
    eyebrow: NEW,
    title: 'Shasta has its own address',
    body: (
      <>
        Shasta now lives at <strong className="text-shasta-fg">edushasta.lol</strong>. The old address keeps working, and lighter copies (Shasta Lite) run
        on other hosts too, in case one of them is blocked on your network.
      </>
    ),
    a: '#06b6d4',
    b: '#3b82f6',
  },
  {
    icon: <Heart />,
    eyebrow: NEW,
    title: 'No ads for supporters',
    body: (
      <>
        To pay for its servers, Shasta now shows ads on its own pages (the new tab, the Store, Watch and a bar along the bottom), never inside the sites you
        open. Supporters see none at all: $5 a month on Ko-fi, then <code className="font-mono">/supporter</code> in the Discord. Want to try it?{' '}
        <code className="font-mono">/trial</code> gives you 7 days without ads, free. Codes now also work on older Chromebooks.
      </>
    ),
    a: '#ec4899',
    b: '#f43f5e',
    cta: 'support',
  },
  {
    icon: <Download />,
    eyebrow: NEW,
    title: 'Games that Shasta hosts itself',
    body: (
      <>
        New in the Store: classic open-source games and tools like Hextris, A Dark Room, HexGL and JS Paint, plus dozens of small games, all stored on
        Shasta, so they still load when the original site is blocked. Explore can now show only these downloads or only links, and the Top 10 keeps up with
        what is trending.
      </>
    ),
    a: '#22c55e',
    b: '#84cc16',
  },
  {
    icon: <Film />,
    eyebrow: NEW,
    title: 'Watch got faster',
    body: (
      <>
        Films and shows start sooner, played straight from the source through Shasta. Anime that is split into seasons now plays the season you picked (a
        “Season 2” used to start at season 1).
      </>
    ),
    a: '#f97316',
    b: '#ef4444',
  },
  {
    icon: <Activity />,
    eyebrow: NEW,
    title: 'See who is online',
    body: <>The Trending strip on the new tab now shows how many people are using Shasta right now, on every Shasta address together.</>,
    a: '#8b5cf6',
    b: '#06b6d4',
  },
  {
    icon: <FlaskConical />,
    eyebrow: 'Heads up',
    title: 'Shasta is in beta',
    body: (
      <>
        We are building it in the open, live. Features change, new ones appear and things break, sometimes while you are using it. Updates arrive by
        themselves; when one is ready the main menu says “Restart to update Shasta”. If something looks wrong, tell us in the Discord or use “Report a
        problem” on any Store app.
      </>
    ),
    a: '#f59e0b',
    b: '#ef4444',
  },
  {
    icon: <Compass />,
    eyebrow: 'Browse',
    title: 'The whole web, in a tab',
    body: (
      <>
        Type an address or a search in the bar at the top. Tabs, bookmarks, history and downloads work like any browser, and ads and pop-ups are blocked
        by default. Some sign-ins (Google, Microsoft, passkeys) and CAPTCHAs may not work through the proxy.
      </>
    ),
    a: '#0ea5e9',
    b: '#6366f1',
  },
  {
    icon: <Gamepad2 />,
    eyebrow: 'Store',
    title: 'Thousands of games and apps',
    body: (
      <>
        Sorted by genre. Install one and it gets its own address (like <code className="font-mono">game://name</code>) that you can type into the bar.
        Game mode keeps the keyboard and mouse inside the game.
      </>
    ),
    a: '#22c55e',
    b: '#14b8a6',
  },
  {
    icon: <Library />,
    eyebrow: 'Library',
    title: 'Yours, no account needed',
    body: <>Installed apps, favorites and the storefronts you follow live on this device.</>,
    a: '#f97316',
    b: '#eab308',
  },
  {
    icon: <Bot />,
    eyebrow: 'Shasta AI',
    title: 'An AI that stays on your device',
    body: (
      <>
        Summarize a page, explain a selection, quiz yourself, describe a picture. Your files, pictures, recordings and pages never leave the device. Open it
        with the toolbar button or Ctrl+Shift+K.
      </>
    ),
    a: '#a855f7',
    b: '#ec4899',
  },
  {
    icon: <WifiOff />,
    eyebrow: 'Offline',
    title: 'Opens even without a network',
    body: <>Shasta saves itself on this device, so it still opens when the network is down (Settings → Updates &amp; offline).</>,
    a: '#64748b',
    b: '#0ea5e9',
  },
  {
    icon: <AppWindow />,
    eyebrow: 'Customize',
    title: 'Make it yours',
    body: <>Wallpapers, new tab backgrounds, size and contrast are in Settings. Export your profile to take your bookmarks and settings to another device.</>,
    a: '#ec4899',
    b: '#f97316',
  },
  {
    icon: <ShieldAlert />,
    eyebrow: 'Good to know',
    title: 'Private tabs are not incognito',
    body: (
      <>
        A private tab keeps no history, but sites can still share cookies with your other tabs. The proxy's operator can see which sites you visit, so don't
        do anything through Shasta that you wouldn't do on a shared computer.
      </>
    ),
    a: '#ef4444',
    b: '#64748b',
  },
  {
    icon: <MessagesSquare />,
    eyebrow: 'Community',
    title: 'Join the Discord',
    body: <>Updates are announced there first. Report bugs, ask for games and apps, and talk to the people building Shasta.</>,
    a: '#5865f2',
    b: '#a855f7',
    cta: 'community',
  },
]

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** shasta://whats-new: the tour shown on first open, and the beta notice. A full-screen slideshow, one topic per slide. */
export default function WhatsNewPage() {
  const open = useTabs((s) => s.openInternal)
  const still = useReducedMotion()
  const [viewport, embla] = useEmblaCarousel({ duration: still ? 1 : 28 })
  const [index, setIndex] = useState(0)
  const slide = SLIDES[index]
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
        <span className="tabular-nums">
          {index + 1} / {SLIDES.length}
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
                    <motion.p {...rise(0.24)} className="mt-5 text-base leading-relaxed text-pretty text-shasta-muted sm:text-lg">
                      {s.body}
                    </motion.p>
                    {s.cta === 'support' && (
                      <motion.div {...rise(0.32)} className="mt-7 flex flex-wrap justify-center gap-2">
                        <button className={buttonVariants({ size: 'lg' })} onClick={() => open('support')} tabIndex={on ? 0 : -1}>
                          <Heart /> Remove ads
                        </button>
                        {DISCORD_INVITE && (
                          <a className={buttonVariants({ variant: 'outline', size: 'lg' })} href={DISCORD_INVITE} target="_blank" rel="noreferrer noopener" tabIndex={on ? 0 : -1}>
                            <MessagesSquare /> Free trial in the Discord <ExternalLink />
                          </a>
                        )}
                      </motion.div>
                    )}
                    {s.cta === 'community' && (
                      <motion.div {...rise(0.32)} className="mt-7 flex flex-wrap justify-center gap-2">
                        {DISCORD_INVITE && (
                          <a className={buttonVariants({ size: 'lg' })} href={DISCORD_INVITE} target="_blank" rel="noreferrer noopener" tabIndex={on ? 0 : -1}>
                            <MessagesSquare /> Join the Discord <ExternalLink />
                          </a>
                        )}
                        <button className={buttonVariants({ variant: 'outline', size: 'lg' })} onClick={() => open('store')} tabIndex={on ? 0 : -1}>
                          <Gamepad2 /> Open the Store
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
        <p className="text-xs text-shasta-muted">Use ← → or swipe · Come back any time from the main menu → What's new</p>
      </footer>
    </div>
  )
}
