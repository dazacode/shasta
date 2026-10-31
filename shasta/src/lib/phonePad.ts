// Phone controllers, window side (server: services/padRelay.ts). Like Netflix's: the window shows a QR code, a phone
// scans it with its own camera, opens Shasta's controller page in the browser (no app, no account) and becomes player
// 1-4. One room per Shasta window, opened only when the person asks for it, kept across games while the window is open.
// Phone buttons arrive as a virtual controller and go through the same key mapping as a real one (lib/gamepad.ts).
// A phone in Touchpad mode is the laptop's trackpad and keys instead: cursor moves, mouse buttons, held keys and typed
// text, which lib/phoneMouse.ts plays into the game's frames.
// Direct link: the phone offers a WebRTC data channel through the relay; when it opens, buttons skip the server
// (a few ms on the same Wi-Fi instead of a trip to the server and back). The relay is the fallback and carries the
// handshake. Off with Settings -> Privacy "Direct phone connection" (it shows each device's address to the other).
import { create } from 'zustand'
import { APP_API_ORIGIN } from './appApi'
import { siteAddress } from './saveShasta'
import { useSettings } from '@/stores/settingsStore'

/** Cloudflare's STUN server: Cloudflare already serves Shasta and sees every visitor's address, so no new party learns it. */
export const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }

export interface PhonePad {
  slot: number
  on: boolean
  /** bitmask in PAD_BUTTONS order */
  b: number
  x: number
  y: number
  /** mouse buttons held (MouseEvent.buttons order) */
  m: number
  /** key codes held on its touchpad screen */
  k: string[]
  /** its buttons arrive over the direct WebRTC channel */
  direct?: boolean
}

interface PhonePadState {
  status: 'off' | 'opening' | 'open' | 'error'
  code: string | null
  /** what the QR code holds: the controller page on the full site */
  link: string | null
  error: string
  pads: PhonePad[]
}

export const usePhonePads = create<PhonePadState>(() => ({ status: 'off', code: null, link: null, error: '', pads: [] }))

/** Where phones open the controller: the full site (Lite and the installed app talk to it as their backend). */
export function controllerOrigin(): string | null {
  if (APP_API_ORIGIN) return APP_API_ORIGIN.replace(/\/+$/, '')
  const site = siteAddress()
  return site ? new URL(site).origin : null
}

export const controllerLink = (code: string) => {
  const origin = controllerOrigin()
  return origin ? `${origin}/pad.html?c=${code}` : null
}

let ws: WebSocket | null = null
let room: { code: string; key: string } | null = null
let wanted = false
let delay = 1000
let timer: ReturnType<typeof setTimeout> | undefined
let gameName = ''
const listeners = new Set<(e: { type: 'join' | 'leave'; slot: number }) => void>()

export const onPhonePadEvent = (fn: (e: { type: 'join' | 'leave'; slot: number }) => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

const sendRaw = (m: unknown) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
}

// the newest state number seen per player: the direct channel is unordered (an old press must never undo a newer one)
const lastSeq = new Map<number, number>()
type StateMsg = { n?: number; b?: number; x?: number; y?: number; m?: number; k?: unknown }
function applyState(slot: number, m: StateMsg) {
  if (typeof m.n === 'number') {
    if (m.n <= (lastSeq.get(slot) ?? -1)) return
    lastSeq.set(slot, m.n)
  }
  const b = m.b ?? 0
  const before = usePhonePads.getState().pads.find((p) => p.slot === slot)?.b ?? 0
  holdPresses(slot, b & ~before)
  const k = Array.isArray(m.k) ? m.k.filter((c): c is string => typeof c === 'string').slice(0, 8) : []
  const prev = usePhonePads.getState().pads.find((p) => p.slot === slot)
  setMouseButtons(slot, (m.m ?? 0) & 7)
  setPad(slot, { on: true, b, x: m.x ?? 0, y: m.y ?? 0, m: (m.m ?? 0) & 7, k: prev && prev.k.join() === k.join() ? prev.k : k })
}

// ---- touchpad: one shared cursor for every phone (a game has one mouse) --------------------------------------

export interface MouseInput {
  dx: number
  dy: number
  /** scroll, in px (positive = down) */
  w: number
  /** button presses and releases in the order they happened, so a quick tap is never lost between two frames */
  changes: { button: number; down: boolean }[]
  /** typed text (\b = Backspace, \n = Enter) */
  text: string
}
const emptyMouse = (): MouseInput => ({ dx: 0, dy: 0, w: 0, changes: [], text: '' })
let mouse = emptyMouse()
const mouseBySlot = new Map<number, number>()
const allButtons = () => [...mouseBySlot.values()].reduce((a, b) => a | b, 0)
function setMouseButtons(slot: number, buttons: number) {
  const before = allButtons()
  if (buttons) mouseBySlot.set(slot, buttons)
  else mouseBySlot.delete(slot)
  const after = allButtons()
  for (const bit of [1, 2, 4]) if ((before & bit) !== (after & bit)) mouse.changes.push({ button: bit, down: !!(after & bit) })
}
/** What the phones did with the mouse since the last call (lib/gamepad.ts takes it once a frame). */
export function takePhoneMouse(): MouseInput {
  const m = mouse
  mouse = emptyMouse()
  return m
}
/** Keys held on the phones' touchpad screens. */
export const phoneHeldKeys = (): string[] => usePhonePads.getState().pads.flatMap((p) => (p.on ? p.k : []))

const inputListeners = new Set<() => void>()
/** Called right after each phone message is taken in (lib/gamepad.ts plays it at once instead of at the next frame). */
export const onPhoneInput = (fn: () => void) => {
  inputListeners.add(fn)
  return () => void inputListeners.delete(fn)
}

function onPadMessage(slot: number, m: StateMsg & { t?: string; dx?: number; dy?: number; w?: number; s?: unknown }) {
  takeIn(slot, m)
  for (const fn of inputListeners) {
    try {
      fn()
    } catch {
      /* a frame that went away mid-event: the next frame tries again */
    }
  }
}
function takeIn(slot: number, m: StateMsg & { t?: string; dx?: number; dy?: number; w?: number; s?: unknown }) {
  if (m.t === 's') applyState(slot, m)
  else if (m.t === 'mv') {
    mouse.dx += Number(m.dx) || 0
    mouse.dy += Number(m.dy) || 0
    mouse.w += Number(m.w) || 0
  } else if (m.t === 'tx' && typeof m.s === 'string') mouse.text += m.s.slice(0, 64)
}

/** How long a phone press lasts at the least, so a quick tap is never lost (lib/gamepad.ts reads once a frame). */
export const MIN_PRESS_MS = 60
// per player: button bit -> time until which it counts as held even if already released
const minHold = new Map<number, Map<number, number>>()
function holdPresses(slot: number, pressed: number) {
  if (!pressed) return
  let held = minHold.get(slot)
  if (!held) minHold.set(slot, (held = new Map()))
  const until = performance.now() + MIN_PRESS_MS
  for (let bit = 1; bit <= pressed; bit <<= 1) if (pressed & bit) held.set(bit, until)
}
/** The player's buttons as the game should see them now: what is held, plus taps still inside their minimum press. */
function effectiveButtons(slot: number, b: number): number {
  const held = minHold.get(slot)
  if (!held) return b
  const now = performance.now()
  for (const [bit, until] of held) {
    if (until > now) b |= bit
    else held.delete(bit)
  }
  return b
}

const peers = new Map<number, RTCPeerConnection>()
function closePeer(slot: number) {
  peers.get(slot)?.close()
  peers.delete(slot)
  if (usePhonePads.getState().pads.some((p) => p.slot === slot && p.direct)) setPad(slot, { direct: false })
}

/** The phone's half of the handshake arrived through the relay: answer it (or say no when direct links are off). */
async function onRtc(slot: number, d: { sdp?: RTCSessionDescriptionInit; c?: RTCIceCandidateInit }) {
  if (!useSettings.getState().settings.phoneDirect || typeof RTCPeerConnection === 'undefined') {
    if (d.sdp) sendRaw({ t: 'rtc', slot, d: { off: true } })
    return
  }
  try {
    if (d.sdp?.type === 'offer') {
      closePeer(slot)
      const pc = new RTCPeerConnection(RTC_CONFIG)
      peers.set(slot, pc)
      pc.onicecandidate = (e) => e.candidate && sendRaw({ t: 'rtc', slot, d: { c: e.candidate.toJSON() } })
      pc.ondatachannel = (e) => {
        const ch = e.channel
        ch.onopen = () => setPad(slot, { direct: true })
        ch.onclose = () => peers.get(slot) === pc && setPad(slot, { direct: false })
        ch.onmessage = (msg) => {
          try {
            onPadMessage(slot, JSON.parse(String(msg.data)))
          } catch {
            /* not ours */
          }
        }
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') peers.get(slot) === pc && closePeer(slot)
      }
      await pc.setRemoteDescription(d.sdp)
      await pc.setLocalDescription(await pc.createAnswer())
      sendRaw({ t: 'rtc', slot, d: { sdp: pc.localDescription?.toJSON() } })
    } else if (d.c) {
      await peers.get(slot)?.addIceCandidate(d.c)
    }
  } catch {
    // a direct link that cannot be made is fine: the relay keeps carrying this phone
    closePeer(slot)
  }
}

function setPad(slot: number, patch: Partial<PhonePad>) {
  const pads = usePhonePads.getState().pads.filter((p) => p.slot !== slot)
  const prev = usePhonePads.getState().pads.find((p) => p.slot === slot) ?? { slot, on: false, b: 0, x: 0, y: 0, m: 0, k: [] }
  const next = { ...prev, ...patch }
  usePhonePads.setState({ pads: [...pads, next].sort((a, c) => a.slot - c.slot) })
}

function connect() {
  if (!wanted || typeof WebSocket === 'undefined') return
  const url = new URL('/api/pad/ws', APP_API_ORIGIN || location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('role', 'host')
  if (room) {
    url.searchParams.set('room', room.code)
    url.searchParams.set('key', room.key)
  }
  if (!room) usePhonePads.setState({ status: 'opening', error: '' })
  const sock = new WebSocket(url)
  ws = sock
  sock.onmessage = (ev) => {
    let m: StateMsg & { t?: string; code?: string; key?: string; slot?: number; on?: boolean; dx?: number; dy?: number; w?: number; s?: unknown; d?: { sdp?: RTCSessionDescriptionInit; c?: RTCIceCandidateInit } }
    try {
      m = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (m.t === 'room' && m.code && m.key) {
      // a new room (the old one expired while we were away): the phones have to scan again
      if (room && room.code !== m.code) usePhonePads.setState({ pads: [] })
      room = { code: m.code, key: m.key }
      delay = 1000
      usePhonePads.setState({ status: 'open', code: m.code, link: controllerLink(m.code), error: '' })
      if (gameName) sendRaw({ t: 'info', name: gameName })
    } else if (m.t === 'pad' && m.slot) {
      // a phone (re)joined or left: its numbering starts again, and a left phone's direct link goes with it
      lastSeq.delete(m.slot)
      minHold.delete(m.slot)
      if (!m.on) closePeer(m.slot)
      setMouseButtons(m.slot, 0)
      setPad(m.slot, m.on ? { on: true } : { on: false, b: 0, x: 0, y: 0, m: 0, k: [], direct: false })
      listeners.forEach((fn) => fn({ type: m.on ? 'join' : 'leave', slot: m.slot! }))
      if (m.on) sendRaw({ t: 'buzz', slot: m.slot, ms: 60 })
    } else if ((m.t === 's' || m.t === 'mv' || m.t === 'tx') && m.slot) {
      onPadMessage(m.slot, m)
    } else if (m.t === 'rtc' && m.slot && m.d) {
      void onRtc(m.slot, m.d)
    }
  }
  sock.onclose = (ev) => {
    if (ws !== sock) return
    ws = null
    // phones keep their state on the server for a while; here nothing is held until they speak again
    for (const p of usePhonePads.getState().pads) setMouseButtons(p.slot, 0)
    usePhonePads.setState({ pads: usePhonePads.getState().pads.map((p) => ({ ...p, b: 0, x: 0, y: 0, m: 0, k: [] })) })
    if (!wanted) return
    if (ev.code === 4429) {
      wanted = false
      usePhonePads.setState({ status: 'error', error: ev.reason || 'Too many controller rooms from this network. Try again later.' })
      return
    }
    if (!room) usePhonePads.setState({ status: 'error', error: "Couldn't reach Shasta's server. Trying again…" })
    timer = setTimeout(connect, delay)
    delay = Math.min(delay * 2, 15_000)
  }
}

/** Opens this window's controller room (or keeps the open one). */
export function startPhonePads() {
  if (wanted) return
  wanted = true
  connect()
}

/** Closes the room: every phone is told, and its code stops working. */
export function stopPhonePads() {
  wanted = false
  clearTimeout(timer)
  sendRaw({ t: 'close' })
  ws?.close()
  ws = null
  room = null
  for (const slot of [...peers.keys()]) closePeer(slot)
  lastSeq.clear()
  minHold.clear()
  mouseBySlot.clear()
  mouse = emptyMouse()
  usePhonePads.setState({ status: 'off', code: null, link: null, error: '', pads: [] })
}

/** The game the phones show at the top of their screen. */
export function setPhonePadGame(name: string) {
  if (name === gameName) return
  gameName = name
  sendRaw({ t: 'info', name })
}

export const kickPhonePad = (slot: number) => sendRaw({ t: 'kick', slot })
export const buzzPhonePads = (ms = 40) => sendRaw({ t: 'buzz', ms })

export const phonePadsConnected = () => usePhonePads.getState().pads.some((p) => p.on)

/** Every connected phone as a virtual controller for its player: pressed values in standard order, plus the left stick. */
export function phonePadInputs(): { player: number; buttons: number[]; axes: number[] }[] {
  return usePhonePads
    .getState()
    .pads.filter((p) => p.on)
    .map((p) => {
      const b = effectiveButtons(p.slot, p.b)
      return { player: p.slot, buttons: Array.from({ length: 16 }, (_, i) => ((b >> i) & 1 ? 1 : 0)), axes: [p.x / 100, p.y / 100] }
    })
}
