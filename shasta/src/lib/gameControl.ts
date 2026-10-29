// Game mode's "forced control" for proxied pages. Many browser games only take input after their window receives a
// `focus` event and only capture the mouse when their canvas is clicked; inside Shasta the frame can already be focused
// before the game starts listening, so the game believes it is in the background and ignores keys and mouse.
// While game mode is on, a click in the page re-focuses its window, tells the game so, and locks the pointer to the
// canvas that was clicked. The proxy layer reads the flag from here and never imports the stores.

let on = false

export const gameControl = () => on
export const setGameControl = (v: boolean) => {
  on = v
}

/** Focuses `win` and fires the `focus` event games listen for (a no-op for pages that do not care). */
export function forceFocus(win: Window) {
  try {
    win.focus()
    win.dispatchEvent(new (win as Window & typeof globalThis).FocusEvent('focus'))
  } catch {
    /* a frame that went away */
  }
}

/** Locks the pointer to a clicked canvas (3D games turn the mouse into camera movement). Must run inside the click. */
export function forcePointerLock(target: EventTarget | null) {
  const el = target as (Element & { requestPointerLock?: (o?: object) => Promise<void> | void }) | null
  if (!el || el.nodeName !== 'CANVAS' || el.ownerDocument.pointerLockElement || !el.requestPointerLock) return
  try {
    void Promise.resolve(el.requestPointerLock()).catch(() => undefined)
  } catch {
    /* the browser refused (no gesture, or the page blocks it) */
  }
}
