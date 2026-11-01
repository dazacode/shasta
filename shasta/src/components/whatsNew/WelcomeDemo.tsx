import { useEffect, useState, type ReactNode } from 'react'
import { Film, Gamepad2, Library, Plus, Sparkles, Store } from 'lucide-react'
import { Bar, Roll, Stage, Stream, Swap, Window, type Act } from '@/stageshow/kit'
import { Logo } from '@/components/Logo'
import './welcomeDemo.css'

// What's new, Welcome slide: "a whole browser in a tab, with games, shows and an AI that stays on your device", told
// in Shasta's own window (its tab strip, toolbar icons and colours: the --sh-* tokens, so it follows the theme).
// Beats: the new tab -> a game tile opens game://clumsy-bird; "+" opens a second tab -> the Watch tile opens
// shasta://watch; the toolbar's Shasta AI button opens the side panel, a suggested question is asked and answered,
// "Runs on this device" under it. Played once; the payoff (Watch + the answered panel) holds.
// Real strings: the tab titles, the addresses, the tile names, "Trending now", the question and answer.

type Page = 'new' | 'game' | 'watch'
type S = { tab2: boolean; active: 0 | 1; one: Page; two: Page; ai: boolean; asked: boolean; words: number }

const START: S = { tab2: false, active: 0, one: 'new', two: 'new', ai: false, asked: false, words: 0 }
const ANSWER = 'Plants use sunlight to turn water and air into sugar, and give off oxygen.'
const END: S = { tab2: true, active: 1, one: 'game', two: 'watch', ai: true, asked: true, words: ANSWER.split(' ').length }

const script = async (a: Act<S>) => {
  await a.wait(1100)
  a.mark('game')
  await a.click('tile-game')
  a.set({ one: 'game' })
  await a.wait(1700)
  a.mark('tab')
  await a.click('plus')
  a.set({ tab2: true, active: 1 })
  await a.wait(900)
  a.mark('watch')
  await a.click('tile-watch')
  a.set({ two: 'watch' })
  await a.wait(1500)
  a.mark('ai')
  await a.click('ai')
  a.set({ ai: true })
  await a.wait(900)
  a.mark('ask')
  await a.click('ask')
  a.set({ asked: true })
  await a.wait(700)
  const n = ANSWER.split(' ').length
  for (let i = 1; i <= n; i++) {
    a.put({ words: i })
    await a.wait(90)
  }
  await a.wait(400)
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

const TITLE: Record<Page, string> = { new: 'New Tab', game: 'Clumsy Bird', watch: 'Watch' }
const URL: Record<Page, string> = { new: '', game: 'game://clumsy-bird', watch: 'shasta://watch' }
const ICON: Record<Page, ReactNode> = {
  new: <Logo className="wd-fav" />,
  game: <Gamepad2 className="wd-fav" />,
  watch: <Film className="wd-fav" />,
}

function Tab({ page, on, hidden }: { page: Page; on: boolean; hidden?: boolean }) {
  return (
    <span className="wd-tab" data-on={on || undefined} data-hidden={hidden || undefined}>
      <Swap id={page} className="wd-favbox">
        {ICON[page]}
      </Swap>
      <Roll>{TITLE[page]}</Roll>
    </span>
  )
}

function NewTabPage({ tiles }: { tiles: 'game' | 'watch' }) {
  return (
    <div className="wd-newtab">
      <div className="wd-brand">
        <Logo className="wd-logo" />
        <span>Shasta</span>
      </div>
      <div className="wd-search">Search or enter a URL</div>
      <div className="wd-tiles">
        <span className="wd-tile" data-target={tiles === 'game' ? 'tile-game' : undefined} data-cursor="pointer">
          <span className="wd-tile__icon wd-tile__icon--bird">
            <span className="wd-minibird" />
          </span>
          <span className="wd-tile__name">Clumsy Bird</span>
        </span>
        <span className="wd-tile" data-target={tiles === 'watch' ? 'tile-watch' : undefined} data-cursor="pointer">
          <span className="wd-tile__icon wd-tile__icon--watch">
            <Film />
          </span>
          <span className="wd-tile__name">Watch</span>
        </span>
        {[44, 36, 40].map((w, i) => (
          <span key={i} className="wd-tile">
            <span className="wd-tile__icon" />
            <Bar w={w} h={5} tone={2} />
          </span>
        ))}
      </div>
    </div>
  )
}

function GamePage() {
  return (
    <div className="wd-game">
      <span className="wd-pipe" style={{ left: 250, top: 0, height: 70 }} />
      <span className="wd-pipe" style={{ left: 250, top: 170, bottom: 0 }} />
      <span className="wd-pipe" style={{ left: 420, top: 0, height: 120 }} />
      <span className="wd-pipe" style={{ left: 420, top: 220, bottom: 0 }} />
      <div className="wd-ground" />
      <span className="wd-bird">
        <span className="wd-bird__eye" />
        <span className="wd-bird__beak" />
      </span>
    </div>
  )
}

const POSTERS = ['#3b2f6b,#7b4bb3', '#1f4e5f,#3fa7a0', '#6b2f2f,#d0643c', '#2f3f6b,#5b7bd0', '#4a5a2f,#a3b84b', '#5f2f55,#c0508f']

function WatchPage() {
  return (
    <div className="wd-watch">
      <div className="wd-hero">
        <Bar w={120} h={12} r={4} tone={5} className="wd-hero__title" />
        <Bar w={180} h={6} tone={3} />
      </div>
      <div className="wd-row">
        <span className="wd-row__label">Trending now</span>
        <div className="wd-posters">
          {POSTERS.map((g, i) => (
            <span key={i} className="wd-poster" style={{ background: `linear-gradient(160deg, ${g.split(',')[0]}, ${g.split(',')[1]})` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function WelcomeDemo() {
  const dark = useDark()
  return (
    <Stage<S>
      width={600}
      height={360}
      compact={{ below: 560, width: 358, height: 380 }}
      initial={START}
      poster={END}
      script={script}
      play="once"
      theme={dark ? 'dark' : 'light'}
      cursor={{ at: { wide: { x: 300, y: 300 }, compact: { x: 180, y: 320 } }, style: 'real' }}
      className="wd"
    >
      {(s) => {
        const page = s.active === 0 ? s.one : s.two
        return (
          <Window
            className="wd-window"
            nav
            urlShape="pill"
            tabs={[
              <Tab key="1" page={s.one} on={s.active === 0} />,
              <Tab key="2" page={s.two} on={s.active === 1} hidden={!s.tab2} />,
              <span key="+" className="wd-plus" data-target="plus" data-cursor="pointer">
                <Plus />
              </span>,
            ]}
            url={
              <span className="wd-url" data-empty={!URL[page] || undefined}>
                <Roll>{URL[page] || 'Search or enter a URL'}</Roll>
              </span>
            }
            toolbar={
              <span className="wd-tools">
                <Store />
                <Library />
                <Film />
                <span className="wd-ai-btn" data-target="ai" data-cursor="pointer" data-on={s.ai || undefined}>
                  <Sparkles />
                </span>
              </span>
            }
          >
            <div className="wd-body" data-ai={s.ai || undefined}>
              <div className="wd-page" data-show={page === 'new' || undefined}>
                <NewTabPage tiles={s.active === 0 ? 'game' : 'watch'} />
              </div>
              <div className="wd-page" data-show={page === 'game' || undefined}>
                <GamePage />
              </div>
              <div className="wd-page" data-show={page === 'watch' || undefined}>
                <WatchPage />
              </div>
            </div>
            <aside className="wd-panel" data-open={s.ai || undefined}>
              <div className="wd-panel__head">
                <Sparkles />
                Shasta AI
              </div>
              <div className="wd-panel__thread">
                <span className="wd-ask" data-target="ask" data-cursor="pointer" data-asked={s.asked || undefined}>
                  Explain photosynthesis in one line
                </span>
                <p className="wd-answer" data-show={s.asked || undefined}>
                  <Stream text={ANSWER} count={s.words} />
                </p>
              </div>
              <div className="wd-panel__foot" data-show={s.words > 0 || undefined}>
                Runs on this device
              </div>
            </aside>
            <span className="wd-rest" data-target="rest" />
          </Window>
        )
      }}
    </Stage>
  )
}
