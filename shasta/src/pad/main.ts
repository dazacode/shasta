// The phone controller page (pad.html?c=CODE). A phone that scanned a Shasta window's QR code lands here and becomes
// a gamepad: D-pad (or analog stick), A/B/X/Y, shoulders, Select/Start, or (Touchpad mode) the laptop's trackpad, mouse
// buttons and keys, for games played with the mouse and keyboard. Modelled on Netflix's phone controller: no app,
// no account, one phone per player, haptic taps, and it keeps its player number when the screen sleeps and wakes.
// It talks only to Shasta's relay (/api/pad/ws, server/src/services/padRelay.ts) and stores nothing but the seat token
// for this tab (sessionStorage), so a reload or a woken screen rejoins as the same player.
import './pad.css'
import { accel, BIT, bitOf, dpadBits, MOUSE, stickAxes, tidyCode, validCode, type PadKey } from './padInput'
import { isControllerUrl, onLaunch } from '../lib/launchQueue'

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308']
const app = document.getElementById('app')!

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else n.setAttribute(k, v)
  }
  n.append(...kids)
  return n
}

// ---- connection -------------------------------------------------------------------------------------------

let code = tidyCode(new URLSearchParams(location.search).get('c') ?? '')
let ws: WebSocket | null = null
let slot = 0
let gameName = ''
let finished = false
let retry = 1000
let retryTimer: ReturnType<typeof setTimeout> | undefined
/** b = pad buttons, x/y = stick, m = mouse buttons, k = keys held on the touchpad screen */
let state = { b: 0, x: 0, y: 0, m: 0, k: [] as string[] }
const holding = () => !!(state.b || state.x || state.y || state.m || state.k.length)
const RELEASED = () => ({ b: 0, x: 0, y: 0, m: 0, k: [] as string[] })
/** every state sent is numbered: the direct channel may reorder, and the window keeps only the newest */
let seq = 0
let lastChange = 0

// ---- direct link (WebRTC) ---------------------------------------------------------------------------------
// The phone offers a data channel through the relay; if the window takes it and the network lets the two meet, buttons
// go straight to the window. Unordered, no retransmits: a late button state is worse than none, and the state is resent
// while anything is held, so a lost packet costs at most 50 ms. The relay keeps working underneath as the fallback.
const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }
let pc: RTCPeerConnection | null = null
let channel: RTCDataChannel | null = null
let rtcTimer: ReturnType<typeof setTimeout> | undefined
const direct = () => channel?.readyState === 'open'

function stopRtc() {
  clearTimeout(rtcTimer)
  channel = null
  pc?.close()
  pc = null
  showRoute()
}

async function startRtc() {
  if (typeof RTCPeerConnection === 'undefined') return
  const conn = new RTCPeerConnection(RTC_CONFIG)
  pc = conn
  const ch = conn.createDataChannel('pad', { ordered: false, maxRetransmits: 0 })
  channel = ch
  ch.onopen = () => {
    clearTimeout(rtcTimer)
    showRoute()
    sendState(true)
  }
  ch.onclose = () => {
    if (channel === ch) showRoute()
  }
  conn.onicecandidate = (e) => e.candidate && sendWs({ t: 'rtc', d: { c: e.candidate.toJSON() } })
  conn.onconnectionstatechange = () => {
    if (pc === conn && (conn.connectionState === 'failed' || conn.connectionState === 'disconnected')) showRoute()
  }
  // school Wi-Fi often blocks direct links: give up quietly and stay on the relay
  rtcTimer = setTimeout(() => !direct() && pc === conn && stopRtc(), 10_000)
  try {
    await conn.setLocalDescription(await conn.createOffer())
    sendWs({ t: 'rtc', d: { sdp: conn.localDescription?.toJSON() } })
  } catch {
    stopRtc()
  }
}

async function onRtc(d: { sdp?: RTCSessionDescriptionInit; c?: RTCIceCandidateInit; off?: boolean }) {
  if (!pc) return
  try {
    if (d.off) return stopRtc()
    if (d.sdp?.type === 'answer') await pc.setRemoteDescription(d.sdp)
    else if (d.c) await pc.addIceCandidate(d.c)
  } catch {
    stopRtc()
  }
}

const sendWs = (m: unknown) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
}

// while a button is held, say so again every 50 ms over the direct link (a packet it lost must not leave a key stuck),
// and a few times after everything is released
setInterval(() => {
  if (direct() && (holding() || Date.now() - lastChange < 300)) sendState(true)
}, 50)

const seatKey = () => `shasta-pad-seat:${code}`
const readSeat = () => {
  try {
    return sessionStorage.getItem(seatKey()) ?? ''
  } catch {
    return ''
  }
}

function connect() {
  clearTimeout(retryTimer)
  if (finished || !validCode(code)) return
  const url = new URL('/api/pad/ws', location.origin)
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('role', 'pad')
  url.searchParams.set('code', code)
  const seat = readSeat()
  if (seat) url.searchParams.set('seat', seat)
  if (!slot) showScreen('connecting')
  else setLive(false)
  const sock = new WebSocket(url)
  ws = sock
  sock.onmessage = (ev) => {
    let m: { t?: string; slot?: number; seat?: string; name?: string; ms?: number; why?: string; d?: { sdp?: RTCSessionDescriptionInit; c?: RTCIceCandidateInit; off?: boolean } }
    try {
      m = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (m.t === 'joined' && m.slot) {
      slot = m.slot
      gameName = m.name ?? ''
      retry = 1000
      try {
        if (m.seat) sessionStorage.setItem(seatKey(), m.seat)
      } catch {
        /* private mode: rejoins as a new player */
      }
      showController()
      setLive(true)
      buzz(40)
      // whatever was held while the socket was down
      sendState(true)
      void keepAwake()
      // a fresh direct link on every (re)join: the window dropped the old one when this phone's socket went away
      stopRtc()
      void startRtc()
    } else if (m.t === 'rtc' && m.d) {
      void onRtc(m.d)
    } else if (m.t === 'info') {
      gameName = m.name ?? ''
      updateTitle()
    } else if (m.t === 'buzz') {
      buzz(m.ms ?? 30)
    } else if (m.t === 'closed') {
      finished = true
      stopRtc()
      showScreen('closed', m.why)
    }
  }
  sock.onclose = (ev) => {
    if (ws !== sock) return
    ws = null
    if (finished) return
    if (ev.code === 4429) {
      finished = true
      showScreen('closed', ev.reason || 'Too many tries. Wait a few minutes.')
      return
    }
    setLive(false)
    // a hidden page reconnects as soon as it is visible again (the screen slept); otherwise back off
    if (document.visibilityState === 'visible') {
      retryTimer = setTimeout(connect, retry)
      retry = Math.min(retry * 2, 8000)
    }
  }
}

function sendState(force = false) {
  if (!force && !dirty) return
  const msg = JSON.stringify({ t: 's', n: seq++, b: state.b, x: state.x, y: state.y, m: state.m, k: state.k })
  if (direct()) {
    try {
      channel!.send(msg)
      dirty = false
      return
    } catch {
      /* the link just dropped: the relay carries this one */
    }
  }
  if (ws?.readyState !== WebSocket.OPEN) return
  dirty = false
  ws.send(msg)
}
let dirty = false

/** Sets what is held and sends it (the one way every control changes the state). */
function setState(next: Partial<typeof state>) {
  const n = { ...state, ...next }
  if (n.b === state.b && n.x === state.x && n.y === state.y && n.m === state.m && n.k.join() === state.k.join()) return
  if ((n.b & ~state.b) || (n.m & ~state.m) || n.k.some((k) => !state.k.includes(k))) buzz(12)
  state = n
  lastChange = Date.now()
  dirty = true
  sendState()
}

// Touchpad moves are deltas, sent the moment the finger moves (no waiting for the next frame), at most one per
// MOVE_GAP ms: 8 straight to the window, 16 through the relay. Never resent, since a resent delta would move the cursor
// twice; a lost one only makes it travel a little less. Whatever a gap holds back is added to the next one.
const move = { dx: 0, dy: 0, w: 0, at: 0 }
let moveTimer: ReturnType<typeof setTimeout> | undefined
function queueMove(dx: number, dy: number, w = 0) {
  move.dx += dx
  move.dy += dy
  move.w += w
  flushMove()
}
function flushMove() {
  if (moveTimer) return
  const wait = (direct() ? 8 : 16) - (performance.now() - move.at)
  if (wait > 0) {
    moveTimer = setTimeout(() => {
      moveTimer = undefined
      flushMove()
    }, wait)
    return
  }
  const dx = Math.round(move.dx)
  const dy = Math.round(move.dy)
  const w = Math.round(move.w)
  if (!dx && !dy && !w) return
  move.dx -= dx
  move.dy -= dy
  move.w -= w
  move.at = performance.now()
  const msg = JSON.stringify({ t: 'mv', dx, dy, w })
  if (direct()) {
    try {
      return channel!.send(msg)
    } catch {
      /* falls back to the relay */
    }
  }
  if (ws?.readyState === WebSocket.OPEN) ws.send(msg)
}

/** Typed text (\b = Backspace, \n = Enter). Always through the relay: it is ordered and never loses a letter. */
const sendText = (text: string) => {
  for (let i = 0; i < text.length; i += 64) sendWs({ t: 'tx', s: text.slice(i, i + 64) })
}

const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* iPhone Safari has no vibration */
  }
}

// Netflix's controller drops when the phone's screen turns off: a wake lock keeps it on while playing.
let wakeLock: { release(): Promise<void> } | null = null
async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }> } }
    if (!nav.wakeLock || wakeLock || document.visibilityState !== 'visible') return
    const lock = await nav.wakeLock.request('screen')
    wakeLock = lock
    lock.addEventListener('release', () => (wakeLock = null))
  } catch {
    /* refused (battery saver): the screen may sleep, and the controller rejoins when it wakes */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    // nothing stays held while the phone is away
    if (holding()) {
      state = RELEASED()
      dirty = true
      sendState()
    }
    return
  }
  void keepAwake()
  if (!finished && validCode(code) && (!ws || ws.readyState > WebSocket.OPEN)) {
    retry = 1000
    connect()
  }
})

// ---- screens ----------------------------------------------------------------------------------------------

let liveDot: HTMLElement | null = null
let titleEl: HTMLElement | null = null
let banner: HTMLElement | null = null

function showScreen(kind: 'enter' | 'connecting' | 'closed', why = '') {
  app.replaceChildren()
  const box = el('div', { class: 'screen' })
  const inner = el('div')
  if (kind === 'connecting') {
    inner.append(el('div', { class: 'spinner' }), el('h1', { text: 'Connecting…' }), el('p', { text: 'Joining the game on the Shasta window.' }))
  } else {
    const input = el('input', { 'aria-label': 'Controller code', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '8', placeholder: 'CODE' }) as HTMLInputElement
    const go = el('button', { class: 'primary', text: 'Connect' })
    const join = () => {
      const c = tidyCode(input.value)
      if (!validCode(c)) {
        input.focus()
        return
      }
      code = c
      finished = false
      slot = 0
      history.replaceState(null, '', `?c=${c}`)
      connect()
    }
    go.addEventListener('click', join)
    input.addEventListener('keydown', (e) => e.key === 'Enter' && join())
    inner.append(
      el('h1', { text: kind === 'closed' ? 'Controller disconnected' : 'Shasta controller' }),
      el('p', { text: kind === 'closed' ? why || 'The game window closed this controller.' : 'Scan the QR code on the game screen, or type the code shown under it.' }),
      input,
      el('br'),
      go,
    )
  }
  box.append(inner)
  app.append(box)
  liveDot = titleEl = banner = routeEl = null
}

function updateTitle() {
  if (titleEl) titleEl.replaceChildren(gameName || 'Shasta', el('small', { text: `Player ${slot}` }))
}

function setLive(on: boolean) {
  liveDot?.classList.toggle('on', on)
  if (banner) banner.hidden = on || direct()
  showRoute()
}

let routeEl: HTMLElement | null = null
/** "Direct" when buttons skip the server, else "Via Shasta" (still works, a little slower). */
function showRoute() {
  if (!routeEl) return
  routeEl.textContent = direct() ? 'Direct' : 'Via Shasta'
  routeEl.title = direct() ? 'Connected straight to the game window' : "Buttons go through Shasta's server"
}

// ---- the controller ---------------------------------------------------------------------------------------

let stickMode = false
let padRoot: HTMLElement | null = null

function showController() {
  if (padRoot && app.contains(padRoot)) {
    updateTitle()
    return
  }
  app.replaceChildren()
  const badge = el('span', { class: 'badge', text: `P${slot}` })
  badge.style.background = COLORS[(slot - 1) % COLORS.length]
  liveDot = el('span', { class: 'dot', 'aria-hidden': 'true' })
  titleEl = el('div', { class: 'title' })
  updateTitle()
  const mode = el('button', { class: 'chip', text: 'Stick' })
  mode.addEventListener('click', () => {
    stickMode = !stickMode
    mode.textContent = stickMode ? 'D-pad' : 'Stick'
    padRoot?.classList.toggle('stickmode', stickMode)
    release()
  })
  // Gamepad | Touchpad (the laptop's mouse + keys): games played with the mouse (Geometry Dash, clickers, point-and-click)
  const segBtn = (label: string, touch: boolean) => {
    const b = el('button', { class: 'seg-btn', text: label, 'aria-pressed': String(touchMode === touch) })
    b.addEventListener('click', () => setMode(touch))
    return b
  }
  const kind = el('div', { class: 'seg', role: 'group', 'aria-label': 'Controller type' }, segBtn('Gamepad', false), segBtn('Touchpad', true))
  const setMode = (on: boolean) => {
    if (on === touchMode) return
    touchMode = on
    try {
      localStorage.setItem('shasta-pad-mode', touchMode ? 'touch' : 'pad')
    } catch {
      /* private mode */
    }
    for (const b of kind.querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.textContent === 'Touchpad') === touchMode))
    mode.hidden = touchMode
    pad.hidden = touchMode
    touch.hidden = !touchMode
    buzz(15)
    release()
    releaseTouch()
  }
  mode.hidden = touchMode
  const full = el('button', { class: 'chip icon', text: '⛶', 'aria-label': 'Full screen', title: 'Full screen' })
  full.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        await (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape').catch(() => undefined)
      }
    } catch {
      /* iPhone Safari: no full screen for pages; Add to Home Screen gives the same */
    }
  })
  if (!document.fullscreenEnabled) full.hidden = true
  routeEl = el('span', { class: 'route', role: 'status' })
  showRoute()
  const bar = el('div', { class: 'bar' }, badge, titleEl, routeEl, liveDot, kind, mode, full)

  const btn = (key: PadKey, label: string, cls = '') => el('div', { class: `btn ${cls} ${key}`.trim(), 'data-k': key, text: label, role: 'button', 'aria-label': label })
  const arm = (dir: 'up' | 'down' | 'left' | 'right') => el('div', { class: `arm ${dir}`, 'data-arm': dir })
  const dpad = el('div', { class: 'dpad', 'data-zone': 'dpad', 'aria-label': 'D-pad' }, arm('up'), arm('down'), arm('left'), arm('right'))
  const knob = el('div', { class: 'knob' })
  const stick = el('div', { class: 'stick', 'data-zone': 'stick', 'aria-label': 'Stick' }, knob)
  const left = el('div', { class: 'left' }, dpad, stick)
  const mid = el('div', { class: 'mid' }, btn('back', 'Select'), btn('start', 'Start'))
  const face = el('div', { class: 'face' }, btn('y', 'Y'), btn('x', 'X'), btn('b', 'B'), btn('a', 'A'))
  const right = el('div', { class: 'right' }, face)
  const shoulders = el('div', { class: 'shoulders' }, el('div', {}, btn('lt', 'LT', 'sh t'), btn('lb', 'LB', 'sh')), el('div', {}, btn('rb', 'RB', 'sh'), btn('rt', 'RT', 'sh t')))
  const pad = el('div', { class: `pad${stickMode ? ' stickmode' : ''}` }, shoulders, left, mid, right)
  padRoot = pad
  banner = el('div', { class: 'banner', text: 'Reconnecting…', role: 'status' })
  banner.hidden = true
  const touch = buildTouchpad()
  pad.hidden = touchMode
  touch.hidden = !touchMode
  app.append(bar, pad, touch, banner)

  // Every finger is tracked; each move recomputes what is held, so a thumb can slide from A to B like on a real pad.
  const touches = new Map<number, { x: number; y: number; zone: 'dpad' | 'stick' | null }>()
  const zoneAt = (x: number, y: number): 'dpad' | 'stick' | null => {
    const hit = document.elementFromPoint(x, y)?.closest('[data-zone]') as HTMLElement | null
    return (hit?.dataset.zone as 'dpad' | 'stick' | undefined) ?? null
  }
  const recompute = () => {
    let b = 0
    let x = 0
    let y = 0
    for (const t of touches.values()) {
      if (t.zone === 'stick') {
        const r = stick.getBoundingClientRect()
        const a = stickAxes(t.x - (r.left + r.width / 2), t.y - (r.top + r.height / 2), r.width / 2)
        x = a.x
        y = a.y
        continue
      }
      if (t.zone === 'dpad') {
        const r = dpad.getBoundingClientRect()
        b |= dpadBits(t.x - (r.left + r.width / 2), t.y - (r.top + r.height / 2), r.width / 2)
        continue
      }
      const k = (document.elementFromPoint(t.x, t.y)?.closest('[data-k]') as HTMLElement | null)?.dataset.k as PadKey | undefined
      if (k) b |= bitOf(k)
    }
    // the knob (42% of the stick) travels up to the stick's rim: 0.69 of its own width
    knob.style.transform = `translate(${x * 0.69}%, ${y * 0.69}%)`
    if (b !== state.b || x !== state.x || y !== state.y) {
      setState({ b, x, y })
      paint()
    }
  }
  const paint = () => {
    for (const n of pad.querySelectorAll<HTMLElement>('[data-k]')) n.classList.toggle('down', !!(state.b & bitOf(n.dataset.k as PadKey)))
    for (const n of pad.querySelectorAll<HTMLElement>('[data-arm]')) n.classList.toggle('down-on', !!(state.b & (1 << BIT[n.dataset.arm as PadKey])))
  }
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    // a finger that starts on the D-pad or stick stays on it even if it slides off (like a real thumbstick)
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, zone: zoneAt(e.clientX, e.clientY) })
    recompute()
  })
  pad.addEventListener('pointermove', (e) => {
    const t = touches.get(e.pointerId)
    if (!t) return
    t.x = e.clientX
    t.y = e.clientY
    recompute()
  })
  const end = (e: PointerEvent) => {
    if (touches.delete(e.pointerId)) recompute()
  }
  pad.addEventListener('pointerup', end)
  pad.addEventListener('pointercancel', end)
  pad.addEventListener('lostpointercapture', end)
  release = () => {
    touches.clear()
    recompute()
  }
}

let release = () => undefined as void
let releaseTouch = () => undefined as void

let touchMode = (() => {
  try {
    return localStorage.getItem('shasta-pad-mode') === 'touch'
  } catch {
    return false
  }
})()

// ---- touchpad mode ----------------------------------------------------------------------------------------
// Like a laptop: one finger moves the cursor, a tap clicks, a two-finger tap right-clicks, two fingers scroll, and a
// tap then touch-and-slide drags. Big Left/Right buttons can be held while the other thumb moves (drag, hold to fire),
// and a row of keys plus the phone's own keyboard cover the keys mouse games use.

/** A tap is shorter than this and moves less than TAP_SLOP px. */
const TAP_MS = 220
const TAP_SLOP = 10
/** a tap's click lasts this long, so the window always sees it held (it reads once a frame) */
const CLICK_MS = 70

/** Cursor speeds the Speed chip cycles through (remembered on this phone). */
const SPEEDS = [0.6, 1, 1.5, 2.2]
const SPEED_LABELS = ['Slow', 'Normal', 'Fast', 'Fastest']

function buildTouchpad(): HTMLElement {
  const hint = el('span', { class: 'tp-hint' }, el('b', { text: 'Touchpad' }), el('span', { text: 'Slide to move · tap to click · two fingers: tap to right-click, slide to scroll' }))
  let speedIndex = 1
  try {
    const saved = localStorage.getItem('shasta-pad-speed')
    if (saved !== null && Number(saved) >= 0 && Number(saved) < SPEEDS.length) speedIndex = Number(saved)
  } catch {
    /* private mode */
  }
  const speedChip = el('button', { class: 'tp-speed', 'aria-label': 'Cursor speed' })
  const showSpeed = () => speedChip.replaceChildren(el('small', { text: 'Speed' }), SPEED_LABELS[speedIndex])
  showSpeed()
  speedChip.addEventListener('pointerdown', (e) => e.stopPropagation())
  speedChip.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length
    showSpeed()
    buzz(10)
    try {
      localStorage.setItem('shasta-pad-speed', String(speedIndex))
    } catch {
      /* private mode */
    }
  })
  const surface = el('div', { class: 'tp-surface', 'aria-label': 'Touchpad' }, hint, speedChip)
  const mbtn = (bit: number, label: string) => el('div', { class: 'tp-btn', 'data-m': String(bit), role: 'button', 'aria-label': `${label} click` }, el('span', { text: label }))
  const clicks = el('div', { class: 'tp-clicks' }, mbtn(MOUSE.left, 'Left'), mbtn(MOUSE.right, 'Right'))
  const key = (code: string, label: string, cls = '', name = label) => el('div', { class: `tp-key ${cls}`.trim(), 'data-key': code, role: 'button', 'aria-label': name, text: label })
  const arrows = el('div', { class: 'tp-arrows' }, key('ArrowUp', '▲', 'k-up', 'Up'), key('ArrowLeft', '◀', 'k-left', 'Left arrow'), key('ArrowDown', '▼', 'k-down', 'Down'), key('ArrowRight', '▶', 'k-right', 'Right arrow'))
  const typeBtn = el('div', { class: 'tp-key type', role: 'button', 'aria-label': 'Type with the keyboard' }, el('span', { class: 'tp-kb', text: '⌨' }), 'Type')
  const keys = el('div', { class: 'tp-keys' }, key('Escape', 'Esc', 'small'), key('Tab', 'Tab', 'small'), key('ShiftLeft', 'Shift', 'small'), key('Space', 'Space', 'space'), key('Enter', 'Enter', 'small'), typeBtn)
  // the phone's own keyboard: an invisible text field whose changes are sent as typed text
  const input = el('input', { class: 'tp-input', 'aria-label': 'Type into the game', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'send' }) as HTMLInputElement
  const typed = el('span', { class: 'tp-typed' })
  const doneBtn = el('button', { class: 'chip', text: 'Done' })
  const typing = el('div', { class: 'tp-typing', role: 'status' }, el('span', { class: 'tp-typing-label', text: 'Typing into the game' }), typed, doneBtn)
  typing.hidden = true
  const side = el('div', { class: 'tp-side' }, clicks, arrows)
  const root = el('div', { class: 'tp' }, surface, side, keys, typing, input)

  // ---- one finger moves, a tap clicks, two fingers scroll / right-click
  const fingers = new Map<number, { x: number; y: number; dot: HTMLElement }>()
  let gesture = { start: 0, travel: 0, most: 0, drag: false }
  let lastTap = 0
  let tapTimer: ReturnType<typeof setTimeout> | undefined
  const held = { buttons: 0, surface: 0 }
  const syncMouse = () => {
    surface.classList.toggle('pressing', !!held.surface)
    setState({ m: held.buttons | held.surface })
  }
  const click = (bit: number) => {
    clearTimeout(tapTimer)
    held.surface |= bit
    syncMouse()
    tapTimer = setTimeout(() => {
      held.surface &= ~bit
      syncMouse()
    }, CLICK_MS)
  }
  const placeDot = (dot: HTMLElement, x: number, y: number) => {
    const r = surface.getBoundingClientRect()
    dot.style.transform = `translate(${x - r.left}px, ${y - r.top}px)`
  }
  surface.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    surface.setPointerCapture?.(e.pointerId)
    if (!fingers.size) {
      // tap, then touch again quickly and slide: drag with the left button held (a second tap = double click)
      const drag = performance.now() - lastTap < 300
      gesture = { start: performance.now(), travel: 0, most: 0, drag }
      if (drag) {
        clearTimeout(tapTimer)
        held.surface |= MOUSE.left
        syncMouse()
      }
    }
    const dot = el('i', { class: 'tp-dot' })
    surface.append(dot)
    placeDot(dot, e.clientX, e.clientY)
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, dot })
    gesture.most = Math.max(gesture.most, fingers.size)
    surface.classList.add('touched')
  })
  // Chrome's raw pointer stream reports a finger as soon as the screen does, not once per frame: less delay
  const raw = 'onpointerrawupdate' in window
  const onMove = (e: PointerEvent) => {
    const f = fingers.get(e.pointerId)
    if (!f) return
    const dx = e.clientX - f.x
    const dy = e.clientY - f.y
    if (!dx && !dy) return
    f.x = e.clientX
    f.y = e.clientY
    gesture.travel += Math.hypot(dx, dy)
    const speed = SPEEDS[speedIndex]
    if (fingers.size === 1) queueMove(accel(dx, speed), accel(dy, speed))
    // two fingers: the page follows them (natural scrolling); each finger reports half of the move
    else if (fingers.size === 2) queueMove(0, 0, (-dy * 2.5) / 2)
  }
  surface.addEventListener(raw ? ('pointerrawupdate' as 'pointermove') : 'pointermove', onMove)
  // the dots follow at the screen's pace either way
  surface.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId)
    if (f) placeDot(f.dot, e.clientX, e.clientY)
  })
  const lift = (e: PointerEvent) => {
    const f = fingers.get(e.pointerId)
    if (!f) return
    f.dot.classList.add('gone')
    setTimeout(() => f.dot.remove(), 200)
    fingers.delete(e.pointerId)
    if (fingers.size) return
    surface.classList.remove('touched')
    const quick = performance.now() - gesture.start < TAP_MS && gesture.travel < TAP_SLOP
    if (gesture.drag) {
      held.surface &= ~MOUSE.left
      syncMouse()
      lastTap = 0
    } else if (quick) {
      click(gesture.most >= 2 ? MOUSE.right : MOUSE.left)
      lastTap = gesture.most >= 2 ? 0 : performance.now()
    }
  }
  surface.addEventListener('pointerup', lift)
  surface.addEventListener('pointercancel', lift)

  // ---- mouse buttons and keys: each finger holds what it went down on
  const keyFingers = new Map<number, { m?: number; key?: string; node: HTMLElement }>()
  const syncHeld = () => {
    let m = 0
    const k: string[] = []
    for (const f of keyFingers.values()) {
      if (f.m) m |= f.m
      if (f.key && !k.includes(f.key)) k.push(f.key)
    }
    held.buttons = m
    for (const n of root.querySelectorAll<HTMLElement>('[data-m],[data-key]')) n.classList.toggle('down', [...keyFingers.values()].some((f) => f.node === n))
    setState({ m: held.buttons | held.surface, k })
  }
  function down(e: PointerEvent) {
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-m],[data-key]')
    if (!node) return
    e.preventDefault()
    keyFingers.set(e.pointerId, { m: node.dataset.m ? Number(node.dataset.m) : undefined, key: node.dataset.key, node })
    syncHeld()
  }
  const up = (e: PointerEvent) => {
    if (keyFingers.delete(e.pointerId)) syncHeld()
  }
  for (const zone of [side, keys]) {
    zone.addEventListener('pointerdown', down)
    zone.addEventListener('pointerup', up)
    zone.addEventListener('pointercancel', up)
  }

  // ---- typing: whatever the phone's keyboard changes in the field is sent as letters and Backspaces
  const BLANK = ' '
  let prev = BLANK
  let shown = ''
  input.value = BLANK
  const show = (out: string) => {
    for (const ch of out) shown = ch === '\b' ? shown.slice(0, -1) : ch === '\n' ? '' : shown + ch
    shown = shown.slice(-40)
    typed.textContent = shown || '…'
  }
  typeBtn.addEventListener('pointerdown', (e) => e.preventDefault())
  typeBtn.addEventListener('click', () => {
    input.value = prev = BLANK
    input.focus()
  })
  input.addEventListener('focus', () => {
    shown = ''
    typed.textContent = '…'
    typing.hidden = false
    root.classList.add('typing')
  })
  doneBtn.addEventListener('click', () => input.blur())
  input.addEventListener('input', () => {
    const now = input.value
    let same = 0
    while (same < prev.length && same < now.length && prev[same] === now[same]) same++
    const out = '\b'.repeat(prev.length - same) + now.slice(same)
    if (out) {
      sendText(out)
      show(out)
    }
    // keep a character in the field so Backspace always has something to delete
    if (!now) input.value = BLANK
    prev = input.value
  })
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    sendText('\n')
    show('\n')
    buzz(10)
  })
  input.addEventListener('blur', () => {
    input.value = prev = BLANK
    typing.hidden = true
    root.classList.remove('typing')
  })

  releaseTouch = () => {
    for (const f of fingers.values()) f.dot.remove()
    fingers.clear()
    keyFingers.clear()
    clearTimeout(tapTimer)
    held.buttons = held.surface = 0
    surface.classList.remove('touched', 'pressing')
    syncHeld()
  }
  return root
}

// no long-press menus, text selection or pinch zoom on a controller
addEventListener('contextmenu', (e) => e.preventDefault())
addEventListener('gesturestart', (e) => e.preventDefault())

// Shasta installed on the phone: a QR code scanned while this page is open lands here without loading
// (lib/launchQueue.ts). Another window's code = load that controller; anything else = open it.
onLaunch((url) => {
  if (!isControllerUrl(url) || tidyCode(url.searchParams.get('c') ?? '') !== code) location.assign(url.href)
})

if (validCode(code)) connect()
else showScreen('enter')
