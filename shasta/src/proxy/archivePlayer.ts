// Internet Archive games (archive.org/embed/<id>, most of the Store's game shelf) made playable in a tab. The
// Archive's own player stays in charge (its emulators, its servers): this only removes the friction around it.
//   - starts the game at once instead of waiting for a click on the power button
//   - scales the screen to fill the tab, centred, sharp pixels (the player draws it at native size in a corner)
//   - Enter = insert coin + start (arcade) / Start (consoles); nobody knows MAME's 5 and 1
//   - a short controls card, reopened from a small "Controls" button
//   - sound starts with the first key or click (the page was not clicked, so the browser keeps audio suspended)

type Kind = 'arcade' | 'console' | 'dos' | 'flash' | 'other'

const HINTS: Record<Kind, [string, string][]> = {
  arcade: [
    ['Enter', 'Insert coin and start'],
    ['Arrows', 'Move'],
    ['Ctrl · Alt · Space · Shift', 'Buttons 1–4'],
    ['5 / 1', 'Coin / Start (2 = two players)'],
    ['Tab', 'Emulator menu (change keys)'],
  ],
  console: [
    ['Enter', 'Start'],
    ['Arrows', 'Move'],
    ['Ctrl · Alt · Space · Shift', 'Buttons'],
    ['5', 'Select (most systems)'],
    ['Tab', 'Emulator menu (change keys)'],
  ],
  dos: [
    ['Keyboard', 'As on a PC'],
    ['Click the game', 'Use the mouse'],
    ['Esc', 'Let go of the mouse'],
  ],
  flash: [],
  other: [],
}

export function isArchiveEmbed(url: URL) {
  return (url.hostname === 'archive.org' || url.hostname === 'www.archive.org') && url.pathname.startsWith('/embed/')
}

function kindOf(module: string, identifier: string): Kind {
  if (identifier.startsWith('arcade_')) return 'arcade'
  if (module.startsWith('dosbox')) return 'dos'
  if (module.startsWith('ruffle')) return 'flash'
  // everything else on the Archive is MAME/MESS; the few other engines (v86, Amiga, Palm) are left alone
  if (/^(v86|sae|cloudpilot|pce-|vice)/.test(module)) return 'other'
  return 'console'
}

export function applyArchivePlayer(win: Window, url: URL) {
  if (!isArchiveEmbed(url)) return
  const doc = win.document
  type W = Window & typeof globalThis & { jQuery?: { _data?: (el: Element, k: string) => Record<string, unknown> | undefined } }
  const w = win as W

  // sound: remember every AudioContext the player makes, resume them on the first real key or click
  const contexts: AudioContext[] = []
  for (const name of ['AudioContext', 'webkitAudioContext'] as const) {
    const Base = (w as unknown as Record<string, typeof AudioContext | undefined>)[name]
    if (!Base) continue
    const Tracked = new Proxy(Base, {
      construct(target, args, newTarget) {
        const ctx = Reflect.construct(target, args, newTarget) as AudioContext
        contexts.push(ctx)
        return ctx
      },
    })
    try {
      Object.defineProperty(w, name, { value: Tracked, configurable: true, writable: true })
    } catch {
      /* not replaceable here */
    }
  }
  const wake = (e: Event) => {
    if (!e.isTrusted) return
    for (const c of contexts) if (c.state === 'suspended') void c.resume().catch(() => undefined)
  }
  win.addEventListener('keydown', wake, { capture: true })
  win.addEventListener('pointerdown', wake, { capture: true })

  const style = doc.createElement('style')
  style.dataset.shasta = 'archive'
  style.textContent = `
    html, body { margin: 0 !important; overflow: hidden !important; background: #000 !important; }
    #canvasholder { position: fixed !important; inset: 0 !important; width: auto !important; height: auto !important;
      margin: 0 !important; transform: none !important; display: flex !important; align-items: center;
      justify-content: center; background: #000; z-index: 1; }
    #canvasholder canvas { image-rendering: pixelated; flex: none; outline: none; }
    #emulate, #jsmessSS { position: fixed !important; inset: 0 !important; }
    #jsmessSS #screenshot img { width: 100vw !important; height: 100vh !important; object-fit: contain; }
    .ui-keyboard, #theatre-controls, .js-emulation-keyboard { display: none !important; }`

  let started = false
  let kind: Kind = 'other'

  const screen = () =>
    (doc.querySelector('#canvasholder ruffle-player, #canvasholder ruffle-object, #canvasholder ruffle-embed') as HTMLElement | null) ??
    (doc.querySelector('#canvasholder canvas') as HTMLCanvasElement | null)

  // A canvas is laid out at its real pixel size and scaled with a transform: the players disagree on its CSS size
  // (MAME sets pixels, DOSBox leaves 100% of the box, which stretches the picture), and emulators map the mouse through
  // getBoundingClientRect, which includes the transform. Ruffle redraws at any size, so it is simply resized.
  const fit = () => {
    const el = screen()
    if (!el) return
    const vw = win.innerWidth
    const vh = win.innerHeight
    if (el instanceof w.HTMLCanvasElement) {
      const cw = el.width
      const ch = el.height
      if (!cw || !ch) return
      const s = Math.min(vw / cw, vh / ch)
      el.style.setProperty('width', `${cw}px`, 'important')
      el.style.setProperty('height', `${ch}px`, 'important')
      el.style.setProperty('transform', `scale(${s})`, 'important')
      el.style.setProperty('transform-origin', 'center', 'important')
    } else {
      el.style.setProperty('width', `${vw}px`, 'important')
      el.style.setProperty('height', `${vh}px`, 'important')
    }
  }

  // the player swaps or resizes its screen when the game picks a video mode: follow it
  const sizes = new ResizeObserver(() => fit())
  let watched: Element | null = null
  const watch = () => {
    const el = screen()
    if (el && el !== watched) {
      if (watched) sizes.unobserve(watched)
      watched = el
      sizes.observe(el)
    }
    fit()
  }

  const press = (key: string, code: string, keyCode: number, hold = 120) => {
    const fire = (type: string) => {
      const e = new w.KeyboardEvent(type, { key, code, bubbles: true, cancelable: true })
      for (const p of ['keyCode', 'which'] as const) Object.defineProperty(e, p, { get: () => keyCode })
      ;(doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : win).dispatchEvent(e)
    }
    fire('keydown')
    win.setTimeout(() => fire('keyup'), hold)
  }

  win.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!e.isTrusted || !started || e.key !== 'Enter' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (kind === 'arcade') {
        press('5', 'Digit5', 53)
        win.setTimeout(() => press('1', 'Digit1', 49), 400)
      } else if (kind === 'console') press('1', 'Digit1', 49)
    },
    { capture: true },
  )

  // the controls card, in its own shadow root so neither page styles it nor it the page
  const showCard = (rows: [string, string][]) => {
    if (!rows.length || !doc.body) return
    const host = doc.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>
      .card { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: calc(100% - 32px);
        background: rgba(18,18,22,.86); color: #f4f4f5; border: 1px solid rgba(255,255,255,.12); border-radius: 14px;
        padding: 12px 16px; font: 13px/1.5 system-ui, sans-serif; backdrop-filter: blur(8px); transition: opacity .4s;
        pointer-events: auto; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
      .card[hidden] { display: block; opacity: 0; pointer-events: none; }
      table { border-collapse: collapse; }
      td { padding: 2px 0; vertical-align: top; } td:first-child { padding-right: 14px; white-space: nowrap; }
      kbd { font: 600 12px system-ui, sans-serif; background: rgba(255,255,255,.12); border-radius: 5px; padding: 1px 6px; }
      .t { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; gap: 16px; }
      button { all: unset; cursor: pointer; opacity: .7; } button:hover { opacity: 1; }
      .pill { position: absolute; right: 12px; bottom: 12px; pointer-events: auto; background: rgba(18,18,22,.6); color: #f4f4f5;
        font: 600 12px system-ui, sans-serif; padding: 5px 10px; border-radius: 999px; opacity: .35; transition: opacity .2s; }
      .pill:hover { opacity: 1; } .pill[hidden] { display: none; }
    </style>
    <div class="card" role="note"><div class="t"><span>Controls</span><button class="x" aria-label="Hide controls">✕</button></div><table></table></div>
    <button class="pill" hidden>Controls</button>`
    const table = root.querySelector('table')!
    for (const [k, v] of rows) {
      const tr = doc.createElement('tr')
      const a = doc.createElement('td')
      const kbd = doc.createElement('kbd')
      kbd.textContent = k
      a.append(kbd)
      const b = doc.createElement('td')
      b.textContent = v
      tr.append(a, b)
      table.append(tr)
    }
    const card = root.querySelector('.card') as HTMLElement
    const pill = root.querySelector('.pill') as HTMLElement
    const hide = () => {
      card.hidden = true
      pill.hidden = false
    }
    root.querySelector('.x')!.addEventListener('click', hide)
    pill.addEventListener('click', () => {
      card.hidden = false
      pill.hidden = true
      win.setTimeout(hide, 8000)
    })
    // stays until the person has had a moment and pressed something
    const shownAt = Date.now()
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || Date.now() - shownAt < 4000) return
      win.removeEventListener('keydown', onKey, true)
      hide()
    }
    win.addEventListener('keydown', onKey, true)
    win.setTimeout(hide, 15000)
    doc.body.append(host)
  }

  const begin = () => {
    if (started) return
    started = true
    watch()
    // never `style`: fit() writes it
    new MutationObserver(watch).observe(doc.getElementById('canvasholder') ?? doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] })
    win.addEventListener('resize', fit)
    showCard(HINTS[kind])
    // keys go to the window the game listens on
    win.setTimeout(() => {
      try {
        win.focus()
      } catch {
        /* gone */
      }
    }, 500)
  }

  const setup = () => {
    doc.head?.append(style)
    try {
      const cfg = JSON.parse((doc.querySelector('.js-emulation') as HTMLInputElement | null)?.value ?? '{}') as { module?: string; identifier?: string }
      kind = kindOf(cfg.module ?? '', cfg.identifier ?? url.pathname.split('/')[2] ?? '')
    } catch {
      /* no config: the page is not a game */
      return
    }
    const link = doc.querySelector('.js-emulation-emulate') as HTMLElement | null
    if (!link) return
    // a click by the person still works; we only take it over once the player has bound its handler
    link.addEventListener('click', () => win.setTimeout(begin, 0))
    const t0 = Date.now()
    const tryStart = () => {
      if (started) return
      const bound = w.jQuery?._data?.(link, 'events')?.click
      if (bound) {
        link.click()
        return
      }
      if (Date.now() - t0 < 30000) win.setTimeout(tryStart, 250)
    }
    tryStart()
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', setup, { once: true })
  else setup()
}
