import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { Count, Phone, Stage, Swap, Window, type Act } from '@/stageshow/kit'
import { QrImage } from '@/components/DiscordQr'
import './phonePadDemo.css'

// What's new: "Your phone is the controller". A device pair, told as one event:
// a Store game (Clumsy Bird, a real package in the Store) shows the QR card the game splash shows (components/game/
// PhonePadCard.tsx), the phone joins as Player 1 (the card folds into the player chip), then two taps on the phone's
// A button flap the bird through the first pipe and the score rolls to 1. Played once; the payoff holds.
// The phone screen is Shasta's own controller page (src/pad/), redrawn at its real colours in iOS points.
// Real strings: the card's two lines, Player 1, the score. Everything else is the game or the pad's own labels.
// variant 'card' is the short strip shown above the real "Use your phone as a controller" button (PhonePadCard): no QR
// in it (an icon tile instead), so it never reads as a second code to scan beside the real one.

type S = { joined: boolean; bird: number; tilt: number; world: number; score: number; tween: 'up' | 'down' | 'none' }

const START: S = { joined: false, bird: 0, tilt: 0, world: 0, score: 0, tween: 'none' }
const END: S = { joined: true, bird: -34, tilt: -14, world: 250, score: 1, tween: 'none' }

type Variant = 'slide' | 'card'
const REST: Record<Variant, { wide: { x: number; y: number }; compact: { x: number; y: number } }> = {
  slide: { wide: { x: 470, y: 160 }, compact: { x: 280, y: 200 } },
  card: { wide: { x: 440, y: 110 }, compact: { x: 290, y: 110 } },
}

const scriptFor = (variant: Variant) => async (a: Act<S>) => {
  await a.wait(1600)
  a.mark('join')
  a.set({ joined: true })
  await a.wait(1300)
  // two flaps: each tap lifts the bird, the world scrolls on, the bird sinks a little before the next
  for (let i = 0; i < 2; i++) {
    a.mark(`flap-${i}`)
    await a.click('pad-a')
    a.put({ tween: 'up', bird: i === 0 ? -40 : -50, tilt: -18, world: i === 0 ? 90 : 220 })
    await a.wait(420)
    a.put({ tween: 'down', bird: i === 0 ? -18 : -34, tilt: 8, world: i === 0 ? 150 : 250 })
    await a.wait(i === 0 ? 520 : 200)
  }
  a.mark('score')
  a.put({ score: 1, tilt: -14 })
  await a.wait(700)
  await a.move(REST[variant])
}

/** Shasta's own light/dark switch is the `dark` class on <html> (hooks/useAppearance.ts). */
function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const obs = new MutationObserver(() => setDark(root.classList.contains('dark')))
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => {
      obs.disconnect()
    }
  }, [])
  return dark
}

/** A pipe pair: the gap is where the bird flies through. */
function Pipes({ x, gap }: { x: number; gap: number }) {
  return (
    <div className="ppd-pipes" style={{ left: x }}>
      <span className="ppd-pipe ppd-pipe--top" style={{ height: gap }} />
      <span className="ppd-pipe ppd-pipe--bottom" style={{ top: gap + 96 }} />
    </div>
  )
}

const SIZES: Record<Variant, { width: number; height: number; compact: { below: number; width: number; height: number } }> = {
  slide: { width: 600, height: 360, compact: { below: 560, width: 358, height: 380 } },
  card: { width: 520, height: 236, compact: { below: 440, width: 358, height: 236 } },
}
const scripts = { slide: scriptFor('slide'), card: scriptFor('card') }

/** `qr`: the QR drawn on the game's card (What's new). Without it the card shows an icon tile. `theme` overrides
 *  Shasta's own light/dark (the game splash is always dark). */
export function PhonePadDemo({ qr, theme, variant = 'slide' }: { qr?: string; theme?: 'light' | 'dark'; variant?: Variant }) {
  const dark = useDark()
  const size = SIZES[variant]
  return (
    <Stage<S>
      width={size.width}
      height={size.height}
      compact={size.compact}
      initial={START}
      poster={END}
      script={scripts[variant]}
      play="once"
      theme={theme ?? (dark ? 'dark' : 'light')}
      cursor={{ at: REST[variant], style: 'touch' }}
      className={variant === 'card' ? 'ppd ppd--card' : 'ppd'}
    >
      {(s, _rect, layout) => (
        <>
          <Window url="game://clumsy-bird" urlShape="pill" className="ppd-window">
            <div className="ppd-game" data-tween={s.tween}>
              <div className="ppd-world" style={{ transform: `translateX(${-s.world}px)` }}>
                <Pipes x={290} gap={58} />
                <Pipes x={490} gap={96} />
              </div>
              <div className="ppd-ground" />
              <span className="ppd-bird" style={{ transform: `translateY(${s.bird}px) rotate(${s.tilt}deg)` }}>
                <span className="ppd-bird__eye" />
                <span className="ppd-bird__beak" />
                <span className="ppd-bird__wing" />
              </span>
              <span className="ppd-score" data-joined={s.joined || undefined}>
                <Count value={s.score} duration={420} />
              </span>

              {/* The splash's QR card folds into the player chip once the phone joins */}
              <div className="ppd-card" data-joined={s.joined || undefined}>
                <div className="ppd-card__scan" aria-hidden={s.joined}>
                  {qr ? (
                    <QrImage value={qr} label="QR code: Shasta's phone controller page" className="ppd-qr" />
                  ) : (
                    <span className="ppd-tile" aria-hidden>
                      <Smartphone />
                    </span>
                  )}
                  <span className="ppd-card__text">
                    <span className="ppd-card__title">{variant === 'card' ? 'Play with your phone' : 'Use your phone as a controller'}</span>
                    {variant === 'slide' && <span className="ppd-card__sub">Scan a code with its camera. No app, no account.</span>}
                  </span>
                </div>
                <div className="ppd-card__chip" aria-hidden={!s.joined}>
                  <span className="ppd-dot" /> Player 1 · phone
                </div>
              </div>
            </div>
          </Window>

          <Phone width={variant === 'card' ? (layout === 'compact' ? 150 : 200) : layout === 'compact' ? 184 : 224} frame="pro" dark wallpaper="#0b0c12" className="ppd-phone">
            <div className="ppd-pad" data-joined={s.joined || undefined}>
              <div className="ppd-bar">
                <span className="ppd-badge">P1</span>
                <span className="ppd-title">
                  Player 1
                  <small>
                    <Swap id={s.joined ? 'on' : 'off'}>{s.joined ? 'Connected' : 'Joining…'}</Swap>
                  </small>
                </span>
                <span className="ppd-live" />
              </div>
              {variant === 'slide' && (
                <div className="ppd-mid">
                  <span className="ppd-small">Select</span>
                  <span className="ppd-small">Start</span>
                </div>
              )}
              <div className="ppd-controls">
                <div className="ppd-dpad">
                  <span className="ppd-arm ppd-arm--up" />
                  <span className="ppd-arm ppd-arm--left" />
                  <span className="ppd-arm ppd-arm--right" />
                  <span className="ppd-arm ppd-arm--down" />
                </div>
                <div className="ppd-face">
                  <span className="ppd-btn ppd-btn--y">Y</span>
                  <span className="ppd-btn ppd-btn--x">X</span>
                  <span className="ppd-btn ppd-btn--b">B</span>
                  <span className="ppd-btn ppd-btn--a" data-target="pad-a">
                    A
                  </span>
                </div>
              </div>
            </div>
          </Phone>
        </>
      )}
    </Stage>
  )
}
