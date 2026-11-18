// GSAP for the browser's own pages (new tab). GSAP is imported on demand, so the first paint never waits for it and a browser
// that never opens a new tab never downloads it. The Shasuta-side kit is shasuta/gsapKit.ts (its own chunk, never imported here).
// Nothing moves under "Reduce animations" (html[data-motion=reduced], which also follows the device) or if GSAP fails to load.

const calm = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches

/** True when the intro will play: the page hides its pieces (CSS `[data-flair=pending]`) until it starts, so nothing flashes. */
export const flairWanted = () => !calm()

type Gsap = typeof import('gsap').gsap

/**
 * The new tab's hero arriving: the logo drops in, the greeting and the headline rise word by word through masks, the search bar
 * widens from the middle, the hint and the ridge settle. Then the ridge drifts a little with the pointer. Returns a cleanup.
 * Always clears `data-flair` on `hero`, even when it does not play.
 */
export function heroIn(hero: HTMLElement): () => void {
  let dead = false
  let undo = () => {}
  const reveal = () => hero.removeAttribute('data-flair')
  if (calm()) {
    reveal()
    return undo
  }
  void (async () => {
    try {
      const [{ gsap }, { SplitText }] = await Promise.all([import('gsap'), import('gsap/SplitText')])
      if (dead) return
      gsap.registerPlugin(SplitText)
      gsap.config({ nullTargetWarn: false })
      undo = play(gsap, SplitText, hero)
    } catch {
      /* GSAP did not load: the page simply appears */
    } finally {
      reveal()
    }
  })()
  return () => {
    dead = true
    undo()
    reveal()
  }
}

function play(gsap: Gsap, SplitText: typeof import('gsap/SplitText').SplitText, hero: HTMLElement): () => void {
  const q = <T extends HTMLElement>(s: string) => hero.querySelector<T>(s)
  const logo = q('.nt-logo')
  const greet = q('.nt-greet')
  const title = q('.nt-title')
  const search = q('.nt-search')
  const hint = q('.nt-hint')
  const ridge = q<HTMLElement>('.nt-ridge') ?? (hero.querySelector('.nt-ridge') as unknown as HTMLElement | null)
  const splits: InstanceType<typeof SplitText>[] = []
  const split = (el: HTMLElement | null, type: string) => {
    if (!el?.textContent?.trim()) return null
    const s = SplitText.create(el, { type, mask: type.includes('chars') ? 'lines' : 'words', aria: 'auto' })
    splits.push(s)
    return s
  }
  const g = split(greet, 'words')
  const t = split(title, 'words,chars')
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, onComplete: () => splits.forEach((s) => s.revert()) })
  if (ridge) tl.from(ridge, { y: 60, opacity: 0, duration: 1.4 }, 0)
  if (logo) tl.from(logo, { y: -26, scale: 0.7, opacity: 0, rotation: -8, duration: 0.95, ease: 'back.out(1.8)' }, 0.05)
  if (g) tl.from(g.words, { yPercent: 120, opacity: 0, duration: 0.8, stagger: 0.06 }, 0.25)
  if (t) tl.from(t.chars, { yPercent: 115, opacity: 0, rotation: 4, duration: 0.9, stagger: 0.022 }, 0.32)
  if (search) tl.from(search, { scaleX: 0.82, opacity: 0, duration: 1.0, transformOrigin: '50% 50%', clearProps: 'transform,opacity' }, 0.5)
  if (hint) tl.from(hint, { y: 10, opacity: 0, duration: 0.7, clearProps: 'transform,opacity' }, 0.85)

  // the ridge drifts with the mouse (a finger or a controller has none)
  let stop = () => {}
  if (ridge && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    gsap.set(ridge, { scaleX: 1.05 }) // a little wider than the page, so drifting never shows an edge
    const x = gsap.quickTo(ridge, 'x', { duration: 1.1, ease: 'power3.out' })
    const move = (e: PointerEvent) => x((e.clientX / innerWidth - 0.5) * -26)
    addEventListener('pointermove', move)
    stop = () => removeEventListener('pointermove', move)
  }
  return () => {
    stop()
    tl.kill()
    splits.forEach((s) => s.revert())
    const all = [ridge, logo, search, hint].filter(Boolean)
    if (all.length) gsap.set(all, { clearProps: 'all' })
  }
}
