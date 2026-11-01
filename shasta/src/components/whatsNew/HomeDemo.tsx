import { Stage, type Act } from '@/stageshow/kit'
import './homeDemo.css'

// What's new "Your new tab": a small night new tab (index.css .nt + .home-*). Four widgets settle into the grid one
// by one, then the pointer flips the "Search bar" switch and the search bar folds away, leaving the widgets.
// Real strings only: what a student would actually see on a Monday morning.

type Home = { n: number; search: boolean }

const script = async (a: Act<Home>) => {
  await a.wait(500)
  for (let n = 1; n <= 4; n++) {
    a.set({ n })
    await a.wait(320)
  }
  await a.wait(900)
  await a.move('toggle')
  await a.click('toggle')
  a.set({ search: false })
  await a.wait(900)
  await a.move({ x: 470, y: 340 })
}

export function HomeDemo() {
  return (
    <Stage<Home>
      width={520}
      height={392}
      initial={{ n: 0, search: true }}
      poster={{ n: 4, search: false }}
      script={script}
      play="once"
      theme="dark"
      cursor={{ at: { x: 500, y: 330 }, style: 'arrow' }}
      className="hd"
    >
      {(s) => (
        <div className="hd-page">
          <div className="hd-top">
            <span className="hd-switch" data-target="toggle" data-cursor="pointer" data-on={s.search || undefined}>
              Search bar <i aria-hidden />
            </span>
          </div>
          <div className="hd-fold" data-open={s.search || undefined}>
            <div>
              <div className="hd-search">Search or type a web address</div>
            </div>
          </div>
          <div className="hd-grid">
            <div className="hd-card hd-m" data-show={s.n >= 1 || undefined}>
              <p className="hd-label">Now</p>
              <p className="hd-title">Biology</p>
              <p className="hd-sub">23 min left · ends 9:40</p>
              <span className="hd-bar"><b style={{ width: '54%' }} /></span>
            </div>
            <div className="hd-card" data-show={s.n >= 2 || undefined}>
              <p className="hd-label">Focus</p>
              <p className="hd-fig">25:00</p>
            </div>
            <div className="hd-card" data-show={s.n >= 3 || undefined}>
              <p className="hd-label">Thanksgiving</p>
              <p className="hd-fig">
                20 <small>days</small>
              </p>
            </div>
            <div className="hd-card hd-m" data-show={s.n >= 4 || undefined}>
              <p className="hd-label">To-do list</p>
              <p className="hd-todo"><span /> Finish the essay outline</p>
              <p className="hd-todo"><span /> Return library books</p>
            </div>
            <div className="hd-card hd-m hd-paper" data-show={s.n >= 4 || undefined}>
              Bio quiz Friday, chapters 4 and 5
            </div>
          </div>
        </div>
      )}
    </Stage>
  )
}
