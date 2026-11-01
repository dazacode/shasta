import { Ban, Search } from 'lucide-react'
import { LockScreen, Notification, Phone, Roll, Stage, WALLPAPER, Window, type Act } from '@/stageshow/kit'
import { Logo } from '@/components/Logo'
import './saveDemo.css'

// Save Shasta: why join the Discord. One event across two devices. A school computer's address bar shows Shasta's
// address blocked; the student's phone (on its lock screen) gets a Discord notification from Shasta's #new-links
// channel; the computer goes to the new link and Shasta is back. The addresses are `.example` on purpose (a reserved
// name): the demo shows what happens, it never claims what the next address will be. Played once; the payoff holds.
// Real strings: the block line, the notification, Shasta and its search box.

type S = { note: boolean; moved: boolean }

const START: S = { note: false, moved: false }

const script = async (a: Act<S>) => {
  await a.wait(1500)
  a.mark('note')
  a.set({ note: true })
  await a.wait(2400)
  a.mark('moved')
  a.set({ moved: true })
  await a.wait(600)
}

/** Discord's mark (Simple Icons, CC0), white on Discord's blurple, as its app icon draws it. */
function DiscordIcon() {
  return (
    <span className="sd-discord">
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#fff"
          d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
        />
      </svg>
    </span>
  )
}

export default function SaveDemo({ dark }: { dark: boolean }) {
  return (
    <Stage<S>
      width={464}
      height={300}
      compact={{ below: 440, width: 310, height: 300 }}
      initial={START}
      poster={{ note: true, moved: false }}
      script={script}
      play="once"
      theme={dark ? 'dark' : 'light'}
      className="sd"
    >
      {(s, _rect, layout) => (
        <>
          <Window
            url={
              <>
                <Roll>{s.moved ? 'new-link' : 'old-link'}</Roll>.example
              </>
            }
            urlShape="pill"
            className="sd-window"
          >
            <div className="sd-page" data-moved={s.moved || undefined}>
              <div className="sd-blocked" aria-hidden={s.moved}>
                <span className="sd-blocked__icon">
                  <Ban />
                </span>
                <span className="sd-blocked__text">
                  <span className="sd-blocked__title">This site is blocked</span>
                  <span className="sd-blocked__sub">Your network doesn't allow this address.</span>
                </span>
              </div>
              <div className="sd-shasta" aria-hidden={!s.moved}>
                <span className="sd-shasta__name">
                  <Logo className="sd-shasta__logo" /> Shasta
                </span>
                <span className="sd-shasta__search">
                  <Search /> Search now
                </span>
              </div>
            </div>
          </Window>

          <Phone width={layout === 'compact' ? 286 : 300} frame="pro" dark wallpaper={WALLPAPER} className="sd-phone">
            <LockScreen size="satellite" stack="top" clock={false}>
              <div className="sd-note" data-show={s.note || undefined}>
                <Notification icon={<DiscordIcon />} title="Shasta · #new-links" body="Shasta has a new link. Use this one if the old one is blocked." />
              </div>
            </LockScreen>
          </Phone>
        </>
      )}
    </Stage>
  )
}
