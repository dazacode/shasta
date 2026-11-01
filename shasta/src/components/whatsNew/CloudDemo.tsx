import { Check, Loader2 } from 'lucide-react'
import { Bar, Stage, Swap, Window, type Act } from '@/stageshow/kit'
import { BASE } from '@/lib/edition'
import './cloudDemo.css'

// What's new "Cloud gaming is here" (stageshow, corner bleed: Shasta's window inset top and left, off the right and
// bottom). The Store's Cloud shelf with three real covers from it (public/whatsnew/cloud-*.webp, the Store's own art
// for those apps, shrunk); the pointer opens Hogwarts Legacy and the tab becomes the game launcher
// (components/game/GameSplash.tsx: its real steps Connecting, Loading, Starting), which ends streaming.
// Real strings: the tab, the address, the shelf, the game, its steps, the status.

type Cloud = { open: boolean; at: 0 | 1 | 2 | 3 }

const COVERS = ['hogwarts', 'doom', 'halo'] as const
const STEPS = ['Connecting', 'Loading', 'Starting']
const cover = (n: string) => `${BASE}whatsnew/cloud-${n}.webp`

const script = async (a: Act<Cloud>) => {
  await a.wait(700)
  await a.move('game')
  await a.click('game')
  a.set({ open: true })
  for (const at of [1, 2, 3] as const) {
    await a.wait(850)
    a.set({ at })
  }
  await a.move({ x: 440, y: 268 })
}

export function CloudDemo() {
  return (
    <Stage<Cloud>
      width={520}
      height={340}
      initial={{ open: false, at: 0 }}
      poster={{ open: true, at: 3 }}
      script={script}
      play="once"
      theme="dark"
      cursor={{ at: { x: 470, y: 300 }, style: 'arrow' }}
      className="cd"
    >
      {(s) => (
        <Window
          className="cd-win"
          tabs={[<Swap id={s.open ? 'g' : 's'}>{s.open ? 'Hogwarts Legacy (Cloud)' : 'Shasta Store'}</Swap>]}
          nav
          url={<Swap id={s.open ? 'g' : 's'}>{s.open ? 'game://hogwarts-legacy' : 'shasta://store'}</Swap>}
          urlShape="pill"
        >
          <div className="cd-store" data-hide={s.open || undefined}>
            <div className="cd-head">
              <span className="cd-h">Cloud games</span>
              <Bar w={64} tone={4} />
            </div>
            <div className="cd-shelf">
              {COVERS.map((n, i) => (
                <div key={n} className="cd-tile" data-target={i === 0 ? 'game' : undefined} data-cursor={i === 0 ? 'pointer' : undefined}>
                  <img src={cover(n)} alt="" draggable={false} />
                </div>
              ))}
              <div className="cd-tile cd-blank" />
            </div>
          </div>

          <div className="cd-splash" data-show={s.open || undefined}>
            <img className="cd-cover" src={cover('hogwarts')} alt="" draggable={false} />
            <div className="cd-info">
              <div className="cd-name">Hogwarts Legacy (Cloud)</div>
              <div className="cd-slug">game://hogwarts-legacy</div>
              <ol className="cd-steps">
                {STEPS.map((label, i) => (
                  <li key={label} data-done={i < s.at || undefined} data-now={i === s.at || undefined}>
                    <span className="cd-dot">
                      <Check className="cd-ok" />
                      <Loader2 className="cd-spin" />
                    </span>
                    {label}
                  </li>
                ))}
              </ol>
              <span className="cd-progress">
                <b style={{ transform: `scaleX(${Math.max(0.08, s.at / STEPS.length)})` }} />
              </span>
              <div className="cd-status">
                <Swap id={s.at === 3 ? 'live' : 'wait'}>{s.at === 3 ? 'Streaming from a gaming PC' : 'Finding a cloud server…'}</Swap>
              </div>
            </div>
          </div>
        </Window>
      )}
    </Stage>
  )
}
