import { useEffect, useState } from 'react'
import { Download, FileArchive, Search } from 'lucide-react'
import { Popover, Stage, Window, type Act } from '@/stageshow/kit'
import { Logo } from '@/components/Logo'
import './installDemo.css'

// shasta://get-app: the one-file install, told as one event (Chrome 150+ on a personal device, the page's own path).
// Beats: "Download Shasta" on the site -> Chrome's download bubble shows shasta.swbn, done -> opening it, Chrome asks
// to confirm ("Install") -> Shasta opens in its own app window, in front of the browser. Played once; the app
// window is the poster. Real strings: Download Shasta, shasta.swbn, 36 MB, Install Shasta?, Install, Shasta. Chrome's dialog is kept to
// its title and buttons: its exact wording is Chrome's, not ours to invent.
// Nothing here is about managed Chromebooks: there the admin decides, and the page says so in its own step.

type S = { pressed: boolean; bubble: boolean; done: boolean; dialog: boolean; app: boolean }

const START: S = { pressed: false, bubble: false, done: false, dialog: false, app: false }
const END: S = { pressed: true, bubble: false, done: true, dialog: false, app: true }

const script = async (a: Act<S>) => {
  await a.wait(900)
  a.mark('download')
  await a.click('get')
  a.set({ pressed: true, bubble: true })
  await a.wait(1100)
  a.set({ done: true })
  await a.wait(700)
  a.mark('open')
  await a.click('file')
  a.set({ bubble: false })
  await a.wait(250)
  a.set({ dialog: true })
  await a.wait(900)
  a.mark('install')
  await a.click('install')
  a.set({ dialog: false })
  await a.wait(300)
  a.set({ app: true })
  await a.wait(500)
  await a.move('rest')
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

export function InstallDemo() {
  const dark = useDark()
  return (
    <Stage<S>
      width={528}
      height={316}
      compact={{ below: 500, width: 358, height: 320 }}
      initial={START}
      poster={END}
      script={script}
      play="once"
      theme={dark ? 'dark' : 'light'}
      cursor={{ at: { wide: { x: 300, y: 250 }, compact: { x: 220, y: 250 } } }}
      className="idm"
    >
      {(s) => {
        return (
          <>
            <Window
              url="edushasta.lol"
              urlShape="pill"
              className="idm-browser"
              receded={s.app}
              toolbar={
                <span className="idm-dl" data-target="dl" data-on={s.bubble || s.done || undefined}>
                  <Download size={14} strokeWidth={2} />
                </span>
              }
            >
              <div className="idm-page">
                <div className="idm-page__title">Get the Shasta app</div>
                <div className="idm-page__line" />
                <div className="idm-page__line idm-page__line--short" />
                <span className="idm-get" data-target="get" data-cursor="pointer">
                  <Download size={14} strokeWidth={2.2} /> Download Shasta
                </span>
              </div>
            </Window>

            {/* Chrome's download bubble, under its toolbar button */}
            <Popover show={s.bubble} origin="top right" className="idm-bubble">
              <span className="idm-file" data-target="file" data-cursor="pointer">
                <span className="idm-file__icon">
                  <FileArchive size={16} strokeWidth={1.8} />
                </span>
                <span className="idm-file__text">
                  <span className="idm-file__name">shasta.swbn</span>
                  <span className="idm-file__meta">
                    <span className="idm-file__state" data-done={s.done || undefined}>
                      <span className="idm-file__progress">
                        <span style={{ transform: `scaleX(${s.bubble ? 1 : 0})` }} />
                      </span>
                      <span className="idm-file__size">36 MB · Done</span>
                    </span>
                  </span>
                </span>
              </span>
            </Popover>

            {/* Chrome asks to confirm the install */}
            <Popover show={s.dialog} origin="top" className="idm-dialog">
              <div className="idm-dialog__head">
                <span className="idm-icon">
                  <Logo className="size-[18px]" />
                </span>
                <span className="idm-dialog__title">Install Shasta?</span>
              </div>
              <div className="idm-dialog__actions">
                <span className="idm-btn">Cancel</span>
                <span className="idm-btn idm-btn--primary" data-target="install" data-cursor="pointer">
                  Install
                </span>
              </div>
            </Popover>

            {/* The installed app: Shasta's own UI in its own window, no address of the site */}
            <div className="idm-appwrap" data-show={s.app || undefined}>
              <Window title="Shasta" className="idm-app">
                <div className="idm-shasta">
                  <div className="idm-omni">
                    <Search size={12} strokeWidth={2.2} />
                    <span>Search or type an address</span>
                  </div>
                  <div className="idm-home">
                    <Logo className="idm-home__logo" />
                    <span className="idm-home__name">Shasta</span>
                    <div className="idm-tiles">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="idm-tile" />
                      ))}
                    </div>
                  </div>
                </div>
              </Window>
            </div>
            <span data-target="rest" className="idm-rest" />
          </>
        )
      }}
    </Stage>
  )
}
