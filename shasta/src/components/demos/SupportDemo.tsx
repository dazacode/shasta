import { useEffect, useState } from 'react'
import { Avatar, Bar, Collapse, Field, Fly, Stage, States, Window, type Act, type Rect } from '@/stageshow/kit'
import './supportDemo.css'

// shasta://support: the Supporter path as one event. Hero = a Shasta new tab with its advert; satellites = the
// Discord chat (left) and Shasta's own "Add a code" field (Settings -> Supporter, lower right).
// 1. Ko-fi's Discord integration gives you the Supporter role (Shasta never sees the payment).
// 2. You run /supporter; the bot answers with a code only you can see.
// 3. Copy -> the code lands in Shasta's field -> Redeem -> Code added.
// 4. Payoff: the new tab's advert folds away and the Supporter pill appears. Played once; the payoff holds.
// Real strings: the role, the command, the code, the field, the result, "Ad". The rest is filler.
// The code is an example (SHASTA-DEMO-0000-0000), never one that was issued.

type S = { role: boolean; cmd: string; sent: boolean; reply: boolean; lift: boolean; go: boolean; pasted: boolean; redeem: 'idle' | 'busy' | 'done'; adFree: boolean }

const CODE = 'SHASTA-DEMO-0000-0000'
const START: S = { role: false, cmd: '', sent: false, reply: false, lift: false, go: false, pasted: false, redeem: 'idle', adFree: false }
const END: S = { role: true, cmd: '', sent: true, reply: true, lift: false, go: false, pasted: true, redeem: 'done', adFree: true }

const script = async (a: Act<S>) => {
  await a.wait(900)
  a.mark('role')
  a.set({ role: true })
  await a.wait(1300)
  a.mark('command')
  await a.click('composer')
  await a.type('cmd', '/supporter')
  await a.wait(250)
  await a.key('Enter')
  a.set({ sent: true, cmd: '' })
  await a.wait(500)
  a.mark('reply')
  a.set({ reply: true })
  await a.wait(1500)
  a.mark('copy')
  await a.click('copy')
  a.set({ lift: true })
  await a.wait(220)
  a.set({ go: true })
  await a.wait(760)
  a.set({ pasted: true, lift: false, go: false })
  await a.wait(500)
  a.mark('redeem')
  await a.click('redeem')
  a.set({ redeem: 'busy' })
  await a.wait(900)
  a.set({ redeem: 'done' })
  await a.wait(600)
  a.mark('ad-free')
  a.set({ adFree: true })
  await a.wait(1200)
  await a.move('rest')
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

function Heart() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
      <path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21Z" />
    </svg>
  )
}

/** Where the carried code lands: on the field's own text line (its 10px inset), at the code's own size, so it never grows. */
function landing(src: Rect, field: Rect): Rect {
  return { x: field.x + 10, y: field.y + (field.height - src.height) / 2, width: src.width, height: src.height }
}

export function SupportDemo() {
  const dark = useDark()
  return (
    <Stage<S>
      width={640}
      height={380}
      compact={{ below: 600, width: 358, height: 560 }}
      initial={START}
      poster={END}
      script={script}
      play="once"
      theme={dark ? 'dark' : 'light'}
      cursor={{ at: { wide: { x: 360, y: 120 }, compact: { x: 300, y: 150 } }, style: 'real' }}
      className="spd"
    >
      {(s, rect) => (
        <>
          <span className="spd-rest" data-target="rest" />
          <Window url="shasta://newtab" urlShape="pill" className="spd-window">
            <div className="spd-tab">
              <span className="spd-pill" data-on={s.adFree || undefined}>
                <Heart /> Supporter
              </span>
              <div className="spd-col">
              <div className="spd-search">
                <Bar w={120} h={6} tone={2} />
              </div>
              <Collapse open={!s.adFree} className="spd-adwrap">
                <div className="spd-ad">
                  <span className="spd-ad__label">Ad</span>
                  <span className="spd-ad__art" />
                  <span className="spd-ad__lines">
                    <Bar w={130} h={7} tone={3} />
                    <Bar w={96} h={6} tone={2} />
                  </span>
                </div>
              </Collapse>
              <div className="spd-tiles">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="spd-tile">
                    <span className="spd-tile__icon" />
                    <Bar w={[30, 36, 26, 34, 28][i]} h={5} tone={2} />
                  </span>
                ))}
              </div>
              </div>
            </div>
          </Window>

          {/* The Discord chat: plain, no logo (the kit has no Discord mark) */}
          <div className="spd-chat">
            <div className="spd-chat__head">
              <span className="spd-chat__app">Discord</span>
              <span className="spd-chat__sep">·</span>
              <span className="spd-chat__chan">Shasta</span>
            </div>
            <div className="spd-me">
              <Avatar name="You" size={28} />
              <span className="spd-me__text">
                <span className="spd-me__name">you</span>
                <span className="spd-role" data-on={s.role || undefined}>
                  <span className="spd-role__dot" /> Supporter
                </span>
              </span>
              <span className="spd-me__via" data-on={s.role || undefined}>role from Ko-fi</span>
            </div>
            <div className="spd-feed">
              <Collapse open={s.sent} reveal="drop" from="below">
                <div className="spd-msg spd-msg--me">
                  <span className="spd-slash">/supporter</span>
                </div>
              </Collapse>
              <Collapse open={s.reply} reveal="drop" from="below">
                <div className="spd-msg spd-msg--bot">
                  <span className="spd-only">Only you can see this</span>
                  <span className="spd-code">
                    <span className="spd-code__text" data-target="code-src" data-gone={s.lift || s.pasted || undefined}>
                      {CODE}
                    </span>
                    <span className="spd-copy" data-target="copy" data-cursor="pointer">
                      Copy
                    </span>
                  </span>
                </div>
              </Collapse>
            </div>
            <div className="spd-composer" data-target="composer" data-cursor="ibeam">
              {s.cmd ? <span className="spd-composer__text">{s.cmd}</span> : <span className="spd-composer__ph">Message #shasta</span>}
            </div>
          </div>

          {/* Shasta: Settings -> Supporter -> Add a code */}
          <div className="spd-code-card">
            <span className="spd-card__title">Add a code</span>
            <div className="spd-card__row">
              <Field value={s.pasted ? CODE : ''} placeholder="SHASTA-XXXX-XXXX-XXXX" className="spd-field" box={{ 'data-target': 'field' }} />
              <span className="spd-redeem" data-target="redeem" data-cursor="pointer" data-state={s.redeem}>
                <States value={s.redeem} states={{ idle: 'Redeem', busy: 'Checking…', done: 'Added' }} />
              </span>
            </div>
          </div>

          {s.lift && (
            <Fly from={rect('code-src')} to={landing(rect('code-src'), rect('field'))} go={s.go} held duration={700} className="spd-fly">
              <span className="spd-fly__chip">{CODE}</span>
            </Fly>
          )}
        </>
      )}
    </Stage>
  )
}
