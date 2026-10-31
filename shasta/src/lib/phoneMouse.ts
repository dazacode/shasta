// A phone in Touchpad mode (src/pad/main.ts) is the laptop's mouse: lib/phonePad.ts collects its moves, buttons and
// typed text, lib/gamepad.ts hands them here once a frame, and this module plays them into the tab's proxied frames as
// the events a real mouse makes (pointer + mouse events, click, contextmenu, wheel), at a cursor Shasta draws over the
// tab. The event goes to the element under the cursor, through nested same-origin frames (a game is often an iframe in
// its site's page). A pointer-locked game (3D camera) gets the raw movement instead. Nothing leaves the window.
import { forceFocus } from './gameControl'
import { keySpec, type KeySpec } from './gameInput'
import type { MouseInput } from './phonePad'
import { keyTarget, sendKey } from '@/proxy/inputMapper'

type Win = Window & typeof globalThis

/** Where a point of the tab lands: the innermost frame under it and the point in that frame's own coordinates. */
interface Hit {
  win: Win
  doc: Document
  el: Element
  x: number
  y: number
}

/** The element under (x, y) of `frame`'s page, descending into nested frames the shell can reach. */
export function hitTest(frame: HTMLIFrameElement, x: number, y: number): Hit | null {
  let win = frame.contentWindow as Win | null
  let cx = x
  let cy = y
  for (let depth = 0; win && depth < 6; depth++) {
    let doc: Document
    try {
      doc = win.document
    } catch {
      return null
    }
    const el = doc.elementFromPoint(cx, cy)
    if (!el) return { win, doc, el: doc.body ?? doc.documentElement, x: cx, y: cy }
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      const inner = (el as HTMLIFrameElement).contentWindow as Win | null
      let reachable = false
      try {
        reachable = !!inner?.document
      } catch {
        /* another origin (an uploaded app, an ad): stop at its frame element */
      }
      if (inner && reachable) {
        const r = el.getBoundingClientRect()
        cx -= r.left + el.clientLeft
        cy -= r.top + el.clientTop
        win = inner
        continue
      }
    }
    return { win, doc, el, x: cx, y: cy }
  }
  return null
}

const FOCUSABLE = 'input, textarea, select, button, a[href], [tabindex], [contenteditable=""], [contenteditable="true"]'
const isEditable = (el: Element | null) => {
  const e = el as HTMLElement | null
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable === true)
}

/** The element a wheel turn would scroll: the nearest ancestor that can scroll that way, else the page. */
function scroller(el: Element, dy: number): Element | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const st = n.ownerDocument.defaultView?.getComputedStyle(n)
    if (st && /(auto|scroll|overlay)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      if ((dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight) || (dy < 0 && n.scrollTop > 0)) return n
    }
  }
  return el.ownerDocument.scrollingElement
}

/** A character typed on the phone as the key press a laptop would make for it. */
export function charSpec(ch: string): { spec: KeySpec; shift: boolean } {
  if (ch === '\b') return { spec: keySpec('Backspace')!, shift: false }
  if (ch === '\n') return { spec: keySpec('Enter')!, shift: false }
  if (ch === ' ') return { spec: keySpec('Space')!, shift: false }
  if (/^[a-z]$/i.test(ch)) return { spec: { ...keySpec(`Key${ch.toUpperCase()}`)!, key: ch }, shift: ch !== ch.toLowerCase() }
  if (/^\d$/.test(ch)) return { spec: keySpec(`Digit${ch}`)!, shift: false }
  // everything else (punctuation, accents, emoji): the right `key`, a best-effort code
  return { spec: { code: '', key: ch, keyCode: ch.toUpperCase().charCodeAt(0) & 0xff }, shift: false }
}

const CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.4 2.9 6.7 3-1.3-2.9-6.6 6.4-.3z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>'
/** the cursor hides after this long without the touchpad being used */
const IDLE_MS = 5000

export function createPhoneMouse() {
  /** the cursor, in the tab frame's own coordinates */
  let x = -1
  let y = -1
  let buttons = 0
  let lastUse = 0
  let cursor: HTMLDivElement | null = null
  /** the frame a button went down in: its release goes there too, wherever the cursor is by then (like a real drag) */
  let downIn: Hit | null = null

  const draw = (frame: HTMLIFrameElement | null, locked: boolean) => {
    const show = !!frame && x >= 0 && !locked && performance.now() - lastUse < IDLE_MS
    if (!show) {
      if (cursor) cursor.style.display = 'none'
      return
    }
    if (!cursor) {
      cursor = document.createElement('div')
      cursor.setAttribute('aria-hidden', 'true')
      cursor.dataset.shastaPhoneCursor = ''
      cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px #0008)'
      cursor.innerHTML = CURSOR_SVG
      document.body.append(cursor)
    }
    const r = frame!.getBoundingClientRect()
    cursor.style.display = 'block'
    cursor.style.transform = `translate(${r.left + x - 3}px, ${r.top + y - 2}px)`
  }

  const fire = (hit: Hit, type: string, init: MouseEventInit & { movementX?: number; movementY?: number }, target: EventTarget = hit.el) => {
    const base = { bubbles: true, cancelable: true, composed: true, view: hit.win, clientX: hit.x, clientY: hit.y, screenX: hit.x, screenY: hit.y, buttons, ...init }
    try {
      if (type.startsWith('pointer') && typeof hit.win.PointerEvent === 'function') {
        return target.dispatchEvent(new hit.win.PointerEvent(type, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: buttons ? 0.5 : 0 }))
      }
      return target.dispatchEvent(new hit.win.MouseEvent(type, base))
    } catch {
      return true
    }
  }

  /** Mouse button `bit` (1 left, 2 right, 4 middle) as the `button` number events carry. */
  const buttonOf = (bit: number) => (bit === 1 ? 0 : bit === 2 ? 2 : 1)

  const press = (frame: HTMLIFrameElement, change: { button: number; down: boolean }) => {
    const hit = (!change.down && downIn) || hitTest(frame, x, y)
    if (!hit) return
    const locked = hit.doc.pointerLockElement
    const target = locked ?? hit.el
    const button = buttonOf(change.button)
    if (change.down) {
      buttons |= change.button
      downIn = hit
      try {
        cursor?.animate([{ scale: '1' }, { scale: '0.78' }, { scale: '1' }], { duration: 160, easing: 'ease-out' })
      } catch {
        /* no Web Animations */
      }
      // a real click focuses the page and the thing clicked (a text field to type into, a game's canvas)
      if (!hit.win.document.hasFocus()) forceFocus(hit.win)
      const focusable = hit.el.closest(FOCUSABLE) as HTMLElement | null
      try {
        if (focusable) focusable.focus()
        else if (isEditable(hit.doc.activeElement)) (hit.doc.activeElement as HTMLElement).blur()
      } catch {
        /* gone */
      }
      const ok = fire(hit, 'pointerdown', { button }, target)
      if (ok) fire(hit, 'mousedown', { button }, target)
      return
    }
    buttons &= ~change.button
    downIn = buttons ? downIn : null
    fire(hit, 'pointerup', { button }, target)
    fire(hit, 'mouseup', { button }, target)
    if (locked) return
    if (button === 0) fire(hit, 'click', { button, detail: 1 })
    else if (button === 2) fire(hit, 'contextmenu', { button })
    else fire(hit, 'auxclick', { button })
  }

  /** Text from the phone's keyboard: into the focused text field when there is one, else as key presses. */
  const type = (win: Window, text: string) => {
    const target = keyTarget(win)
    const doc = (target as Node).ownerDocument ?? win.document
    for (const ch of text) {
      const { spec, shift } = charSpec(ch)
      const mods = { shiftKey: shift }
      const ok = sendKey(win, target, 'keydown', spec, mods)
      if (ok && (spec.key.length === 1 || spec.key === 'Enter')) sendKey(win, target, 'keypress', spec, mods)
      // a synthetic key press types nothing by itself: do what the browser would have done
      if (ok && isEditable(target as Element)) {
        try {
          if (ch === '\b') doc.execCommand('delete')
          else if (ch !== '\n') doc.execCommand('insertText', false, ch)
          else if ((target as Element).tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable) doc.execCommand('insertLineBreak')
        } catch {
          /* not editable after all */
        }
      }
      sendKey(win, target, 'keyup', spec, mods)
    }
  }

  return {
    /**
     * One frame: `frame` is the front tab's proxied frame (null = no target), `keysWin` the frame keys go to (typing),
     * `input` what the phones did since the last frame.
     */
    step(frame: HTMLIFrameElement | null, keysWin: Window | null, input: MouseInput) {
      const used = input.dx || input.dy || input.w || input.changes.length || input.text
      if (!frame) {
        draw(null, false)
        return
      }
      if (used) lastUse = performance.now()
      const r = frame.getBoundingClientRect()
      if (x < 0 || x > r.width || y < 0 || y > r.height) {
        if (!used) return draw(frame, false)
        x = r.width / 2
        y = r.height / 2
      }
      let locked = false
      if (input.dx || input.dy) {
        x = Math.max(0, Math.min(r.width - 1, x + input.dx))
        y = Math.max(0, Math.min(r.height - 1, y + input.dy))
        const hit = hitTest(frame, x, y)
        if (hit) {
          const lockEl = hit.doc.pointerLockElement
          locked = !!lockEl
          const move = { movementX: input.dx, movementY: input.dy }
          // while a button is held the events keep going to where it went down (dragging a slider off its track)
          const target = lockEl ?? (buttons && downIn?.doc === hit.doc ? downIn.el : hit.el)
          if (fire(hit, 'pointermove', move, target)) fire(hit, 'mousemove', move, target)
        }
      }
      for (const c of input.changes) press(frame, c)
      if (input.w) {
        const hit = hitTest(frame, x, y)
        if (hit) {
          let ok = true
          try {
            ok = hit.el.dispatchEvent(new hit.win.WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, view: hit.win, clientX: hit.x, clientY: hit.y, deltaY: input.w, deltaMode: 0 }))
          } catch {
            /* old frame */
          }
          // a synthetic wheel event scrolls nothing: scroll what a real one would have, unless the page took it
          if (ok) scroller(hit.el, input.w)?.scrollBy({ top: input.w })
        }
      }
      if (input.text && keysWin) type(keysWin, input.text)
      if (!locked) {
        try {
          locked = !!hitTest(frame, x, y)?.doc.pointerLockElement
        } catch {
          /* gone */
        }
      }
      draw(frame, locked)
    },
    /** Releases held buttons and hides the cursor (the tab changed, the phones left). */
    reset(frame: HTMLIFrameElement | null) {
      if (frame && buttons) for (const bit of [1, 2, 4]) if (buttons & bit) press(frame, { button: bit, down: false })
      buttons = 0
      downIn = null
      draw(null, false)
    },
  }
}

export type PhoneMouse = ReturnType<typeof createPhoneMouse>
