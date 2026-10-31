// Halloween 2026 art (lib/seasonal.ts decides when it shows): a jack-o'-lantern, bats, the banner that heads the
// Watch and Store Halloween sections, and the new tab's night scene. Inline SVG + CSS only, nothing is downloaded.
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Pumpkin({ className, lit = true }: { className?: string; lit?: boolean }) {
  return (
    <svg viewBox="0 0 64 60" className={className} aria-hidden>
      <path d="M30 10c0-5 3-9 9-10l1 4c-4 1-6 3-6 7z" fill="#4b7a2c" />
      <ellipse cx="19" cy="36" rx="15" ry="20" fill="#d9601a" />
      <ellipse cx="45" cy="36" rx="15" ry="20" fill="#d9601a" />
      <ellipse cx="32" cy="35" rx="15" ry="23" fill="#f07f24" />
      <ellipse cx="32" cy="35" rx="6" ry="22" fill="#f99a3c" opacity="0.5" />
      {lit && (
        <g className="hw-flicker" fill="#ffd54a">
          <path d="M18 30l6-8 5 8z" />
          <path d="M35 30l5-8 6 8z" />
          <path d="M16 40c5 9 27 9 32 0l-4 2-3-3-3 4-4-4-4 4-3-4-3 3z" />
        </g>
      )}
    </svg>
  )
}

const BAT = 'M0 0c4-6 10-8 14-4 2-4 6-4 8-2 2-3 4-3 6 0 2-2 6-2 8 2 4-4 10-2 14 4-6-2-10 0-12 4-4-3-8-2-10 1-2-2-4-2-6 0-2-3-6-4-10-1C10 0 6-2 0 0z'

export function Bat({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="-2 -10 54 18" className={cn('hw-bat', className)} style={style} aria-hidden>
      <path d={BAT} fill="currentColor" />
    </svg>
  )
}

/** The banner on top of a Halloween section (Watch, Store). Carries its own colours so it works in both themes.
 *  With `onToggle` it is the button that folds the section open and shut. */
export function HalloweenBanner({ title, subtitle, open, onToggle, controls }: { title: string; subtitle: string; open?: boolean; onToggle?: () => void; controls?: string }) {
  const body = (
    <>
      <div className="hw-banner-moon" aria-hidden />
      <Bat className="absolute top-4 right-[22%] w-9 text-black/70" style={{ animationDelay: '-0.3s' }} />
      <Bat className="absolute top-10 right-[30%] w-6 text-black/60" style={{ animationDelay: '-0.7s' }} />
      <Bat className="absolute top-3 right-[38%] w-5 text-black/50" />
      <Pumpkin className="relative size-14 shrink-0 drop-shadow-[0_0_18px_rgb(255_140_40_/_0.55)] sm:size-16" />
      <div className="relative min-w-0 flex-1 text-left">
        <span className="hw-title block">{title}</span>
        <p className="mt-0.5 text-sm text-orange-100/80">{subtitle}</p>
      </div>
      {onToggle && (
        <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-black/35 text-orange-100 ring-1 ring-white/15">
          <ChevronDown className={cn('size-5 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </span>
      )}
    </>
  )
  return onToggle ? (
    <button type="button" className="hw-banner w-full cursor-pointer" aria-expanded={open} aria-controls={controls} onClick={onToggle} title={open ? 'Fold away' : 'Show'}>
      {body}
    </button>
  ) : (
    <div className="hw-banner">{body}</div>
  )
}

const foldKey = (id: string) => `shasta-halloween-folded-${id}`
const readFolded = (id: string) => {
  try {
    return localStorage.getItem(foldKey(id)) === '1'
  } catch {
    return false
  }
}

/** A Halloween section: the banner, then its rows on a faint orange tint. Clicking the banner folds it away (remembered
 *  on this device per section `id`); folded, the rows are not mounted, so they fetch nothing. */
export function HalloweenSection({ id, title, subtitle, children, className }: { id: string; title: string; subtitle: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(() => !readFolded(id))
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      if (next) localStorage.removeItem(foldKey(id))
      else localStorage.setItem(foldKey(id), '1')
    } catch {
      /* storage blocked: it just is not remembered */
    }
  }
  const body = `hw-${id}`
  return (
    <section aria-label={title} className={cn('hw-section', className)}>
      <HalloweenBanner title={title} subtitle={subtitle} open={open} onToggle={toggle} controls={body} />
      {open && (
        <div id={body} className="hw-section-body px-3 pb-4 sm:px-4">
          {children}
        </div>
      )}
    </section>
  )
}

// fixed star field (no randomness: every render, and every visitor, sees the same sky)
const STARS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 397) % 1600, y: (i * 211) % 470, r: 0.6 + ((i * 7) % 10) / 9, d: (i % 7) * 0.6 }))
const BATS = [
  { top: '14%', w: 46, dur: 19, delay: -2 },
  { top: '22%', w: 30, dur: 24, delay: -11 },
  { top: '9%', w: 24, dur: 28, delay: -18 },
  { top: '30%', w: 36, dur: 21, delay: -7 },
  { top: '18%', w: 20, dur: 32, delay: -25 },
]

/** The new tab's Halloween night: moonlit sky, a haunted house, a bare tree, a graveyard, jack-o'-lanterns, bats, fog.
 *  The page can be taller than the window, so the sky sticks to the top and the landscape to the bottom of the view. */
export function HalloweenWallpaper() {
  return (
    <div className="nt-wall hw-wall" aria-hidden>
      <div className="hw-sky">
        <svg className="absolute inset-0 size-full" viewBox="0 0 1600 600" preserveAspectRatio="xMidYMin slice">
          {STARS.map((s, i) => (
            <circle key={i} className="hw-star" cx={s.x} cy={s.y} r={s.r} fill="#fff" style={{ animationDelay: `${s.d}s` }} />
          ))}
        </svg>
        <div className="hw-moon">
          <svg viewBox="0 0 200 200" className="size-full">
            <defs>
              <radialGradient id="hw-moon" cx="0.42" cy="0.4">
                <stop offset="0" stopColor="#fff4d6" />
                <stop offset="0.7" stopColor="#ffd98f" />
                <stop offset="1" stopColor="#f2b35c" />
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="100" fill="url(#hw-moon)" />
            <g fill="#e9a955" opacity="0.35">
              <circle cx="70" cy="76" r="15" />
              <circle cx="128" cy="130" r="21" />
              <circle cx="122" cy="60" r="9" />
              <circle cx="74" cy="140" r="7" />
            </g>
          </svg>
          <div className="hw-cloud" />
        </div>
        {BATS.map((b, i) => (
          <div key={i} className="hw-fly" style={{ top: b.top, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}>
            <Bat className="text-[#0a0510]" style={{ width: b.w, animationDelay: `${b.delay / 10}s` }} />
          </div>
        ))}
      </div>
      <div className="flex-1" />
      <div className="hw-land">
        <svg className="absolute inset-0 size-full" viewBox="0 380 1600 520" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id="hw-horizon" cx="0.5" cy="1" r="0.8">
              <stop offset="0" stopColor="#ff7a1a" stopOpacity="0.32" />
              <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="hw-candle">
              <stop offset="0" stopColor="#ffb347" stopOpacity="0.7" />
              <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect y="380" width="1600" height="520" fill="url(#hw-horizon)" />
          {/* far hills */}
          <path d="M0 690 C 180 610 320 640 470 600 S 760 650 900 620 S 1200 560 1360 610 S 1530 640 1600 600 V900 H0Z" fill="#1c0c27" />
          {/* haunted house on its hill */}
          <g fill="#0d0614">
            <path d="M100 720 C 190 610 380 600 500 720Z" />
            <path d="M200 640 V560 H186 L230 488 L274 560 H260 V600 H300 V556 H288 L340 496 L392 556 H380 V640Z" />
            <rect x="226" y="452" width="8" height="40" />
            <path d="M206 560 H254 L230 520Z" fill="#160a20" />
          </g>
          <g className="hw-window" fill="#ffb347">
            <rect x="218" y="572" width="14" height="20" rx="2" />
            <rect x="320" y="572" width="12" height="16" rx="2" />
            <rect x="346" y="572" width="12" height="16" rx="2" />
            <path d="M332 530 a8 8 0 0 1 16 0 v12 h-16Z" />
          </g>
          <circle className="hw-window" cx="300" cy="580" r="90" fill="url(#hw-candle)" opacity="0.45" />
          {/* bare tree, right */}
          <g fill="none" stroke="#0b0510" strokeLinecap="round">
            <path d="M1420 900 C 1415 800 1430 720 1408 640" strokeWidth="26" />
            <path d="M1410 680 C 1370 640 1330 630 1290 600" strokeWidth="11" />
            <path d="M1330 625 C 1320 600 1300 585 1290 560" strokeWidth="5" />
            <path d="M1412 650 C 1440 600 1480 580 1530 560" strokeWidth="10" />
            <path d="M1490 575 C 1500 545 1520 530 1545 520" strokeWidth="5" />
            <path d="M1408 640 C 1400 590 1410 550 1395 500" strokeWidth="8" />
            <path d="M1398 540 C 1370 520 1360 500 1350 470" strokeWidth="4" />
            <path d="M1290 600 C 1270 595 1255 600 1240 590" strokeWidth="4" />
          </g>
          {/* ground + graveyard */}
          <path d="M0 790 C 260 740 520 770 800 750 S 1340 740 1600 770 V900 H0Z" fill="#08040c" />
          <g fill="#140b1d">
            <path d="M560 770 v-36 a18 18 0 0 1 36 0 v36Z" />
            <path d="M620 772 v-24 a13 13 0 0 1 26 0 v24Z" />
            <path d="M1040 768 v-30 a16 16 0 0 1 32 0 v30Z" />
            <path d="M1112 770 v-14 h-9 v-8 h9 v-10 h8 v10 h9 v8 h-9 v14Z" />
          </g>
        </svg>
        <Pumpkin className="hw-ground-pumpkin" />
        <Pumpkin className="hw-ground-pumpkin hw-ground-pumpkin-2" />
        <Pumpkin className="hw-ground-pumpkin hw-ground-pumpkin-3" />
        <div className="hw-fog" />
        <div className="hw-fog hw-fog-2" />
      </div>
      {/* keep the middle readable behind the search bar */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(48% 42% at 50% 40%, rgb(8 4 14 / 0.55), transparent 100%)' }} />
    </div>
  )
}
