import { useEffect, useState } from 'react'
import { Badge, Bar, Caret, Prompt, States, Window, Stage, type Act } from '@/stageshow/kit'
import './publishDemo.css'

// Store -> Publish: what publishing looks like. A terminal runs `shasta publish ./my-game`; the lines are the real CLI's
// own output for a new contributor (server/cli/shasta.ts publish(): "Created …", "Version … drafted.", printReport's
// file count, then ok() "… is waiting for the owner's review."), shortened to one package. The listing then appears
// as a Store card marked In review, and turns Published once the owner approves it: a new contributor starts without
// can_publish, so the first release is always reviewed. Real strings: the command, the four lines, the name, the badge.

type S = { cmd: string; typing: boolean; lines: number; card: boolean; live: boolean }

const START: S = { cmd: '', typing: false, lines: 0, card: false, live: false }
const END: S = { cmd: 'shasta publish ./my-game', typing: false, lines: 4, card: true, live: true }

const LINES: { text: string; tone?: 'dim' | 'ok' }[] = [
  { text: 'Created Star Hopper.' },
  { text: 'Version 1.0.0 drafted.' },
  { text: '  48 files, 12.4 MB', tone: 'dim' },
  { text: "✓ Star Hopper 1.0.0 is waiting for the owner's review.", tone: 'ok' },
]

const script = async (a: Act<S>) => {
  await a.wait(900)
  a.put({ typing: true })
  await a.type('cmd', END.cmd, { interval: 45 })
  await a.wait(350)
  a.put({ typing: false })
  // the CLI checks the package, creates the app, drafts the version, uploads, then submits
  for (const [i, gap] of [700, 420, 520, 650].entries()) {
    await a.wait(gap)
    a.put({ lines: i + 1 })
  }
  a.mark('listed')
  await a.wait(250)
  a.set({ card: true })
  await a.wait(2200)
  a.mark('approved')
  a.set({ live: true })
  await a.wait(2400)
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

export function PublishDemo() {
  const dark = useDark()
  return (
    <Stage<S>
      width={640}
      height={300}
      compact={{ below: 600, width: 358, height: 360 }}
      initial={START}
      poster={END}
      script={script}
      play="once"
      theme={dark ? 'dark' : 'light'}
      className="pbd"
    >
      {(s) => (
        <>
          <Window chrome="terminal" title="my-game — zsh" className="pbd-term">
            <div className="ss-term pbd-lines">
              <Prompt path="~">
                {s.cmd}
                {s.lines === 0 && <Caret still={s.typing} />}
              </Prompt>
              {LINES.map((l, i) => (
                <div key={i} className={`pbd-line ${l.tone ?? ''}`} data-on={i < s.lines || undefined}>
                  {l.text}
                </div>
              ))}
              <Prompt path="~" className="pbd-line" data-on={s.lines === LINES.length || undefined}>
                <Caret />
              </Prompt>
            </div>
          </Window>

          {/* the listing as the Store shows it */}
          <div className="pbd-card" data-on={s.card || undefined}>
            <span className="pbd-art" aria-hidden />
            <span className="pbd-text">
              <span className="pbd-name">Star Hopper</span>
              <Bar w={84} h={6} tone={2} />
            </span>
            <States
              value={s.live ? 'live' : 'review'}
              align="end"
              states={{
                review: (
                  <Badge tone="warning" dot>
                    In review
                  </Badge>
                ),
                live: (
                  <Badge tone="success" dot>
                    Published
                  </Badge>
                ),
              }}
            />
          </div>
        </>
      )}
    </Stage>
  )
}
