import { AudioLines, Film, Library, Pause, RotateCcw, RotateCw, SkipBack, SkipForward, Store, Volume2, X } from 'lucide-react'
import { Bar, Collapse, Popover, Stage, Swap, Window, type Act } from '@/stageshow/kit'
import './mediaDemo.css'

// What's new "See what's playing" (stageshow, pinned bottom bleed: Shasta's window inset top, left and right, off the
// bottom, so its lights and the toolbar's end with the media hub both stay whole). A song starts in the tab: the hub button appears,
// the "Now playing" banner drops from it with the page's own title and artist (components/browser/MediaHub.tsx), the
// pointer opens it and the same surface unfolds into the controls, then Next skips to the following track.
// Real strings: the tab, the address, the banner, the song, its artist, the times. The page behind is filler.

type Media = { playing: boolean; open: boolean; track: 0 | 1 }

const TRACKS = [
  { title: 'Thriller', artist: 'Michael Jackson · Thriller', at: '1:12', left: '-4:46', pos: 20 },
  { title: 'Billie Jean', artist: 'Michael Jackson · Thriller', at: '0:00', left: '-4:54', pos: 0 },
]

const script = async (a: Act<Media>) => {
  await a.wait(700)
  a.set({ playing: true })
  await a.wait(1500)
  await a.move('banner')
  await a.click('banner')
  a.set({ open: true })
  await a.wait(1300)
  await a.move('next')
  await a.click('next')
  a.set({ track: 1 })
  await a.wait(500)
  await a.move({ x: 150, y: 300 })
}

export function MediaDemo() {
  return (
    <Stage<Media>
      width={520}
      height={340}
      initial={{ playing: false, open: false, track: 0 }}
      poster={{ playing: true, open: true, track: 1 }}
      script={script}
      play="once"
      theme="dark"
      cursor={{ at: { x: 170, y: 290 }, style: 'arrow' }}
      className="md"
    >
      {(s) => {
        const t = TRACKS[s.track]
        return (
          <>
            <Window
              className="md-win"
              tabs={[<Swap id={s.playing ? 'p' : 'i'}>{s.playing ? 'Thriller | YouTube Music' : 'YouTube Music'}</Swap>]}
              nav
              url="music.youtube.com/watch"
              urlShape="pill"
              toolbar={
                <span className="md-tools">
                  <Store />
                  <Library />
                  <Film />
                  <span className="md-hub" data-on={s.playing || undefined} data-open={s.open || undefined}>
                    <AudioLines />
                  </span>
                </span>
              }
            >
              <div className="md-body">
                <div className="md-cover" />
                <div className="md-queue">
                  <Bar w="40%" />
                  {[62, 48, 70, 54].map((w) => (
                    <div key={w} className="md-q">
                      <span className="md-qart" />
                      <Bar w={`${w}%`} />
                    </div>
                  ))}
                </div>
              </div>
            </Window>

            <Popover show={s.playing} origin="top right" className="md-pop" data-target="banner" data-cursor={s.open ? undefined : 'pointer'}>
              <Collapse open={s.open}>
                <div className="md-src">
                  <span className="md-fav" />
                  music.youtube.com
                  <X className="md-x" />
                </div>
              </Collapse>
              <div className="md-row">
                <span className="md-art" />
                <span className="md-text">
                  <Collapse open={!s.open}>
                    <span className="md-eyebrow">Now playing</span>
                  </Collapse>
                  <Swap id={s.track} className="md-song">
                    {t.title}
                  </Swap>
                  <span className="md-artist">{t.artist}</span>
                </span>
              </div>
              <Collapse open={s.open}>
                <div className="md-ctl">
                  <span className="md-seek">
                    <b style={{ width: `${t.pos}%` }} />
                  </span>
                  <div className="md-times">
                    <Swap id={`a${s.track}`}>{t.at}</Swap>
                    <Swap id={`b${s.track}`}>{t.left}</Swap>
                  </div>
                  <div className="md-buttons">
                    <Volume2 />
                    <span className="md-mid">
                      <SkipBack />
                      <RotateCcw />
                      <span className="md-play">
                        <Pause />
                      </span>
                      <RotateCw />
                      <span className="md-next" data-target="next" data-cursor="pointer">
                        <SkipForward />
                      </span>
                    </span>
                    <span className="md-spacer" />
                  </div>
                </div>
              </Collapse>
            </Popover>
          </>
        )
      }}
    </Stage>
  )
}
