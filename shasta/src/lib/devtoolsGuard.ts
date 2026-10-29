/**
 * Production builds do not let the keyboard open developer tools or view-source.
 *
 * This is a deterrent, not a security boundary: a web page cannot stop the browser's own menu (⋮ → More tools) from
 * opening DevTools, and nothing secret should ever depend on it. Set VITE_ALLOW_DEVTOOLS=1 when building to keep
 * the shortcuts (for whoever maintains the deployment).
 */
export const DEVTOOLS_BLOCKED = import.meta.env.PROD && import.meta.env.VITE_ALLOW_DEVTOOLS !== '1'

interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** F12, Ctrl/Cmd+Shift+I/J/C (and Firefox's K/E), Cmd+Opt+I/J/C, and view-source (Ctrl+U, Cmd+Opt+U). */
export function isDevtoolsShortcut(e: KeyLike): boolean {
  if (e.key === 'F12' || e.code === 'F12') return true
  // `code` rather than `key`: with Option held on a Mac the key is a symbol, not a letter
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.shiftKey && ['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyE'].includes(e.code)) return true
  if (e.metaKey && e.altKey && ['KeyI', 'KeyJ', 'KeyC', 'KeyU'].includes(e.code)) return true
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyU') return true
  return false
}

/** Blocks the shortcuts inside one window (the shell, or any proxied frame). Safe to call more than once per window. */
export function installDevtoolsGuard(win: Window) {
  if (!DEVTOOLS_BLOCKED) return
  const marked = win as Window & { __shastaGuard?: boolean }
  if (marked.__shastaGuard) return
  marked.__shastaGuard = true
  win.addEventListener(
    'keydown',
    (e) => {
      if (!isDevtoolsShortcut(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true,
  )
}
