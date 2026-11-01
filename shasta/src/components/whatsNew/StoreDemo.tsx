import { Count, Stage, type Act } from '@/stageshow/kit'
import './storeDemo.css'

// What's new "Thank you": the Store's count rolling up past 32,000 (live catalogue, 2026-11-01: 32,785), then the
// real visitor numbers from Shasta's own stats (Umami, all four sites, 2026-10-30 to 2026-11-01). Only people who
// left "Share anonymous usage counts" on are counted, so these are floors, never rounded up.

type Milestone = { n: number; done: boolean }

const script = async (a: Act<Milestone>) => {
  await a.wait(500)
  a.set({ n: 10_000 })
  await a.wait(650)
  a.set({ n: 20_000 })
  await a.wait(650)
  a.set({ n: 32_000, done: true })
}

export function StoreDemo() {
  return (
    <Stage<Milestone> width={520} height={340} initial={{ n: 0, done: false }} poster={{ n: 32_000, done: true }} script={script} play="once" theme="dark" className="sd">
      {(s) => (
        <div className="sd-page">
          <div className="sd-label">Apps and games in the Shasta Store</div>
          <div className="sd-fig">
            <Count value={s.n} duration={650} />+
          </div>
          <div className="sd-kinds" data-show={s.done || undefined}>
            <span><b>800+</b> people in our first 3 days of counting</span>
            <span><b>7 min</b> an average visit</span>
          </div>
        </div>
      )}
    </Stage>
  )
}
