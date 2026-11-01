import { useEffect, useState } from 'react'
import { ChevronRight, QrCode } from 'lucide-react'
import { Bar, Collapse, Count, Popover, Stage, type Act } from '@/stageshow/kit'
import { QrImage } from '@/components/DiscordQr'
import { SeasonBanner } from '@/components/seasonal/Season'
import { activeEvent, nextEvent } from '@/lib/events'
import { DISCORD_INVITE } from '@/lib/supporter'
import './fixesDemo.css'

// What's new "Small fixes" as a bento of three tiles, one per fix, each its own Stage with its caption as page text
// under it (stageshow references/bento.md). The tiles take turns so only one thing moves at a time:
//   1. hero, the new tab's "N online" pill (components/LivePulse.tsx): the count ticks, the pointer hovers, the
//      popular list opens under it;
//   2. a Discord "Scan with phone" button (components/DiscordQr.tsx) pressed, its real QR rising under it;
//   3. the Store's holiday section (components/seasonal/Season.tsx, the real banner of the holiday on now or next) folded away, the next shelf
//      moving up into its place.
// Real strings only where the eye lands: the count, the popover's headings and two Store names, the button, the banner.

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

/* ── 1. Who's online ── */

type Online = { n: number; open: boolean }

const onlineScript = async (a: Act<Online>) => {
  await a.wait(500)
  a.set({ n: 284 })
  await a.wait(700)
  await a.move({ at: 'pill', x: 0.88, y: 0.75 })
  a.set({ open: true })
}

function OnlineTile({ dark }: { dark: boolean }) {
  return (
    <Stage<Online>
      width={392}
      height={206}
      initial={{ n: 283, open: false }}
      poster={{ n: 284, open: true }}
      script={onlineScript}
      play="once"
      theme={dark ? 'dark' : 'light'}
      cursor={{ at: { x: 330, y: 150 }, style: 'arrow' }}
      className="fx3-online"
    >
      {(s) => (
        <>
          <div className="fx3-center">
            <span className="fx3-pill" data-target="pill" data-cursor="pointer">
              <span className="fx3-pill__dot" />
              <span className="fx3-pill__n">
                <Count value={s.n} duration={500} /> online
              </span>
            </span>
          </div>
          <Popover show={s.open} origin="top" className="fx3-pop">
            <p className="fx3-pop__head">
              <b>
                <Count value={s.n} duration={500} />
              </b>{' '}
              Shasta windows open right now
            </p>
            <p className="fx3-pop__label">Popular in the Store</p>
            {['Clumsy Bird', 'Hextris'].map((name, i) => (
              <span key={name} className="fx3-row">
                <Bar w={20} h={20} r={6} tone={i ? 2 : 3} />
                {name}
              </span>
            ))}
          </Popover>
        </>
      )}
    </Stage>
  )
}

/* ── 2. Discord QR ── */

type Qr = { open: boolean }

const qrScript = async (a: Act<Qr>) => {
  await a.wait(2900)
  await a.move('scan')
  await a.click('scan')
  a.set({ open: true })
  await a.wait(500)
  await a.move({ x: 178, y: 196 })
}

function QrTile({ dark }: { dark: boolean }) {
  return (
    <Stage<Qr>
      width={196}
      height={206}
      initial={{ open: false }}
      poster={{ open: true }}
      script={qrScript}
      play="once"
      theme={dark ? 'dark' : 'light'}
      cursor={{ at: { x: 230, y: 240 }, style: 'arrow' }}
      className="fx3-qr"
    >
      {(s) => (
        <>
          <div className="fx3-center fx3-center--btn">
            <span className="fx3-btn" data-target="scan" data-cursor="pointer" data-open={s.open || undefined}>
              <QrCode size={16} aria-hidden /> Scan with phone
            </span>
          </div>
          <Popover show={s.open} origin="top" className="fx3-qrcard">
            <QrImage value={DISCORD_INVITE ?? 'https://discord.gg/ye4A2skv6H'} label="QR code to join the Shasta Discord" className="fx3-qrcode" />
          </Popover>
        </>
      )}
    </Stage>
  )
}

/* ── 3. Fold away a holiday section ── */

type Fold = { open: boolean }

const foldScript = async (a: Act<Fold>) => {
  await a.wait(4700)
  await a.move('banner')
  await a.click('banner')
  a.set({ open: false })
  await a.wait(700)
  await a.move(a.layout === 'compact' ? { x: 330, y: 150 } : { x: 560, y: 150 })
}

function Shelf({ count }: { count: number }) {
  return (
    <div className="fx3-shelf">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="fx3-tile">
          <Bar w="100%" h={40} r={10} tone={i % 2 ? 2 : 1} />
        </span>
      ))}
    </div>
  )
}

function FoldTile({ dark }: { dark: boolean }) {
  // the holiday on now, else the next one: the tile never shows a holiday that is over
  const id = (activeEvent()?.event ?? nextEvent()?.event)?.id ?? 'winter'
  return (
    <Stage<Fold>
      width={600}
      height={176}
      compact={{ below: 500, width: 358, height: 176 }}
      initial={{ open: true }}
      poster={{ open: false }}
      script={foldScript}
      play="once"
      theme={dark ? 'dark' : 'light'}
      cursor={{ at: { wide: { x: 640, y: 210 }, compact: { x: 400, y: 210 } }, style: 'arrow' }}
      className="fx3-fold"
    >
      {(s, _rect, layout) => {
        const count = layout === 'compact' ? 3 : 5
        return (
          <div className="fx3-page">
            <section className="ev-section fx3-section">
              <div data-target="banner" data-cursor="pointer" className="fx3-banner">
                <SeasonBanner id={id} title="Holiday picks in the Store" subtitle="Games for the break, under one banner." open={s.open} onToggle={() => undefined} />
              </div>
              <Collapse open={s.open}>
                <div className="fx3-section__body">
                  <Shelf count={count} />
                </div>
              </Collapse>
            </section>
            <p className="fx3-shelf__title" data-show={!s.open || undefined}>
              Recently added <ChevronRight aria-hidden />
            </p>
            <Shelf count={count} />
          </div>
        )
      }}
    </Stage>
  )
}

/** The three small fixes of this update, each a tile with its own picture and one line. Decorative (`aria-hidden`
 *  pictures, `inert` so nothing inside can be focused); the captions carry the words for everybody. */
export function FixesDemo() {
  const dark = useDark()
  return (
    <div className="fx3">
      <div className="fx3-grid">
        <figure className="fx3-cell fx3-cell--hero">
          <div className="fx3-pic" aria-hidden inert>
            <OnlineTile dark={dark} />
          </div>
          <figcaption>
            <b>Who's online.</b> Hover it to see what's popular.
          </figcaption>
        </figure>
        <figure className="fx3-cell">
          <div className="fx3-pic" aria-hidden inert>
            <QrTile dark={dark} />
          </div>
          <figcaption>
            <b>Discord QR codes.</b> Join from your phone.
          </figcaption>
        </figure>
        <figure className="fx3-cell fx3-cell--wide">
          <div className="fx3-pic" aria-hidden inert>
            <FoldTile dark={dark} />
          </div>
          <figcaption>
            <b>Fold holiday sections away.</b> One click on the banner, remembered on this device.
          </figcaption>
        </figure>
      </div>
    </div>
  )
}
