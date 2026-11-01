import { useEffect, useState } from 'react'
import { Bar, Fly, Stage, Swap, Window, type Act } from '@/stageshow/kit'
import './libraryDemo.css'

// shasta://library, empty: how a game gets here. A device pair inside one Shasta window: the Store listing of Hextris
// (a real open-source package in the Store) on the left, the Library as a card on its right edge. Install is pressed,
// the icon flies into the Library's empty slot, the button becomes Open; a click on the new tile opens game://hextris
// in the window. Installs are local (no account), so nothing signs in. Played once; the payoff (the game open,
// the Library holding it) stays.
// Real strings: Hextris, its developer, Install/Open, Library, the count line, the two addresses.

type S = { busy: boolean; installed: boolean; fly: boolean; landed: boolean; game: boolean }

const START: S = { busy: false, installed: false, fly: false, landed: false, game: false }
const END: S = { busy: false, installed: true, fly: false, landed: true, game: true }

const script = async (a: Act<S>) => {
  await a.wait(900)
  a.mark('install')
  await a.click('install')
  a.set({ busy: true })
  await a.wait(650)
  a.mark('fly')
  a.set({ busy: false, installed: true, fly: true })
  await a.wait(800)
  a.set({ landed: true })
  await a.wait(900)
  a.mark('open')
  await a.click('lib-tile')
  a.set({ game: true })
  await a.wait(600)
  await a.move('rest')
}

/** Hextris's look: a dark hexagon ringed by the game's four block colours. Drawn, since the Store's real art is
 *  remote; it stands for the app's icon here, not a mark of Shasta's. */
function Hex({ size, game }: { size: number; game?: boolean }) {
  const ring = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#e74c3c', '#3498db']
  const pts = (r: number) => Array.from({ length: 6 }, (_, i) => {
    const t = (Math.PI / 3) * i - Math.PI / 2
    return [50 + r * Math.cos(t), 50 + r * Math.sin(t)]
  })
  const outer = pts(40)
  const inner = pts(26)
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className={game ? 'ld-hex ld-hex--game' : 'ld-hex'}>
      {ring.map((c, i) => {
        const j = (i + 1) % 6
        const d = `M${outer[i]}L${outer[j]}L${inner[j]}L${inner[i]}Z`
        return <path key={i} d={d} fill={c} stroke="#2c3e50" strokeWidth="1.5" strokeLinejoin="round" />
      })}
      <path d={`M${inner.map((p) => p.join(' ')).join('L')}Z`} fill="#2c3e50" />
    </svg>
  )
}

function Icon({ size }: { size: number }) {
  return (
    <span className="ld-icon" style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}>
      <Hex size={size * 0.78} />
    </span>
  )
}

/** Shasta's light/dark switch is the `dark` class on <html> (hooks/useAppearance.ts). */
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

export function LibraryDemo() {
  const dark = useDark()
  return (
    <Stage<S>
      width={600}
      height={340}
      compact={{ below: 560, width: 358, height: 400 }}
      initial={START}
      poster={END}
      script={script}
      play="once"
      theme={dark ? 'dark' : 'light'}
      cursor={{ at: { wide: { x: 300, y: 300 }, compact: { x: 180, y: 330 } } }}
      className="ld"
    >
      {(s, rect) => (
        <>
          <Window url={<Swap id={s.game ? 'g' : 's'}>{s.game ? 'game://hextris' : 'shasta://store#/app/hextris'}</Swap>} urlShape="pill" className="ld-window">
            <div className="ld-page">
              <div className="ld-head">
                <span data-target="src-icon"><Icon size={76} /></span>
                <div className="ld-meta">
                  <div className="ld-name">Hextris</div>
                  <div className="ld-dev">Logan Engstrom</div>
                  <div className="ld-lines">
                    <Bar w={190} h={6} tone={2} />
                    <Bar w={140} h={6} tone={2} />
                  </div>
                  <div className="ld-actions">
                    <span className="ld-btn" data-kind={s.installed ? 'open' : s.busy ? 'busy' : 'install'} data-target="install" data-cursor="pointer">
                      <Swap id={s.installed ? 'open' : s.busy ? 'busy' : 'install'}>{s.installed ? 'Open' : s.busy ? 'Working…' : 'Install'}</Swap>
                    </span>
                    <span className="ld-ghost"><Bar w={58} h={6} tone={2} /></span>
                  </div>
                </div>
              </div>
              <div className="ld-shots">
                <span />
                <span />
                <span />
              </div>
              {/* the game, opened from the Library: the page under it stays, so it reads as the same tab navigating */}
              <div className="ld-game" data-on={s.game || undefined}>
                <Hex size={150} game />
                <span className="ld-score">0</span>
              </div>
            </div>
          </Window>

          <div className="ld-lib">
            <div className="ld-lib__title">Library</div>
            <div className="ld-lib__sub">
              <Swap id={s.landed ? 1 : 0}>{s.landed ? '1 installed app on this device' : 'Nothing installed yet'}</Swap>
            </div>
            <div className="ld-lib__grid">
              <span className="ld-tile" data-target="lib-tile" data-cursor="pointer" data-landed={s.landed || undefined}>
                <span className="ld-slot" data-target="slot" />
                <span className="ld-tile__icon" data-target="lib-icon">
                  <Icon size={52} />
                </span>
                <span className="ld-tile__name">Hextris</span>
              </span>
              <span className="ld-tile ld-tile--filler"><span className="ld-slot ld-slot--quiet" /></span>
            </div>
          </div>

          {!s.landed && (
            <Fly from={rect('src-icon')} to={rect('lib-icon')} go={s.fly} held duration={750} className="ld-fly">
              <Icon size={76} />
            </Fly>
          )}
          <span data-target="rest" className="ld-rest" />
        </>
      )}
    </Stage>
  )
}

export default LibraryDemo
