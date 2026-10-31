// The installed web app (manifest `launch_handler: focus-existing`) does not load a link it captures: Android opens a
// scanned/tapped Shasta link in the already-open app window and only hands the address to `window.launchQueue`. A page
// that never reads it stays where it was (the phone controller QR code then "opened" Shasta's start page and the phone
// never joined). Kept dependency-free: the phone controller page (src/pad/) imports it too.

interface LaunchParams {
  targetURL?: string
}
interface LaunchQueue {
  setConsumer(fn: (params: LaunchParams) => void): void
}

/** The phone controller page (pad.html, or /pad after a host strips the extension). */
export const isControllerUrl = (url: URL) => /\/pad(\.html)?$/.test(url.pathname)

/**
 * Calls `handle` with every address the installed app is launched with (not the one this page already shows).
 * Returns false when the browser has no launch queue.
 */
export function onLaunch(handle: (url: URL) => void): boolean {
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
  if (!queue) return false
  queue.setConsumer((params) => {
    if (!params.targetURL) return
    let url: URL
    try {
      url = new URL(params.targetURL)
    } catch {
      return
    }
    if (url.origin !== location.origin || url.href === location.href) return
    handle(url)
  })
  return true
}
