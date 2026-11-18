// Keeping the account on the phone: a browser tab is not durable (iOS wipes a site's storage after 7 days without a
// visit, and "clear website data" wipes it at once), so the app asks for persistent storage and offers Add to Home
// Screen. Android/Chrome fire `beforeinstallprompt`; iOS has no prompt, only Share -> Add to Home Screen.
import { create } from 'zustand'

interface InstallEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface InstallState {
  /** Chrome's deferred install prompt, when it offered one */
  prompt: InstallEvent | null
  installed: boolean
}

export const useInstall = create<InstallState>(() => ({ prompt: null, installed: isStandalone() }))

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
export const isAndroid = () => /Android/.test(navigator.userAgent)

/** Run once at start (before React) so the early event is not missed. */
export function watchInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    useInstall.setState({ prompt: e as InstallEvent })
  })
  window.addEventListener('appinstalled', () => useInstall.setState({ installed: true, prompt: null }))
}

/** Shows Chrome's install dialog; true when the person installed. */
export async function promptInstall(): Promise<boolean> {
  const p = useInstall.getState().prompt
  if (!p) return false
  await p.prompt()
  const { outcome } = await p.userChoice
  useInstall.setState({ prompt: null, installed: outcome === 'accepted' })
  return outcome === 'accepted'
}

/** Asks the browser not to clear this site's storage under pressure. Quietly does nothing where unsupported. */
export async function persistStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
