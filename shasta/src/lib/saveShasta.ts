// "Save Shasta": addresses get blocked and forgotten, so people should keep Shasta somewhere they will find it again.
// Three ways, all done by the person (no browser lets a site bookmark or install itself):
//   - install it as an app (Chrome/Edge on a computer or Chromebook offer `beforeinstallprompt`): it then sits in the
//     launcher / shelf / dock like any app;
//   - bookmark it with the star in the browser's own address bar;
//   - scan a QR code with a phone: the link opens Shasta there with `?save=phone`, which shows how to add it to the
//     home screen (install button on Android Chrome, Share -> Add to Home Screen on iPhone).
import { create } from 'zustand'
import { inInstalledApp } from './shastaApp'
import { trackEvent } from './usage'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface SaveState {
  open: boolean
  /** opened by scanning the QR code on a phone: lead with "add to home screen" */
  phone: boolean
  /** the browser offered to install Shasta (Chrome/Edge); null when it did not, or it is already installed */
  installEvent: InstallPromptEvent | null
  installed: boolean
}

export const useSaveShasta = create<SaveState>(() => ({ open: false, phone: false, installEvent: null, installed: false }))

/** Listen as early as possible: the browser fires its install offer once, soon after the page loads. */
if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep it for our own button instead of the browser's mini bar
    useSaveShasta.setState({ installEvent: e as InstallPromptEvent })
  })
  addEventListener('appinstalled', () => useSaveShasta.setState({ installEvent: null, installed: true }))
}

/** Already running as an installed app (home screen icon, launcher, the Isolated Web App)? */
export const runningInstalled = () =>
  inInstalledApp() || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true

export function openSaveShasta(phone = false) {
  trackEvent(phone ? 'save.phone-open' : 'save.open')
  useSaveShasta.setState({ open: true, phone })
}

export async function installShasta(): Promise<boolean> {
  const e = useSaveShasta.getState().installEvent
  if (!e) return false
  trackEvent('save.install')
  await e.prompt()
  const { outcome } = await e.userChoice
  useSaveShasta.setState({ installEvent: null, installed: outcome === 'accepted' })
  return outcome === 'accepted'
}

/** The address to save: this site's own (the page's origin). Null where there is no web address (the installed app). */
export function siteAddress(): string | null {
  const configured = import.meta.env.VITE_SHARE_ORIGIN as string | undefined
  if (configured?.startsWith('https://')) return `${configured.replace(/\/+$/, '')}/`
  if (inInstalledApp() || !/^https?:$/.test(location.protocol)) return null
  return `${location.origin}${import.meta.env.BASE_URL ?? '/'}`
}

/** What the phone opens: the same address, marked so it shows the home-screen steps. */
export function phoneAddress(): string | null {
  const site = siteAddress()
  return site ? `${site}?save=phone` : null
}

/** Run once at start: a phone that scanned the code lands here with ?save=phone. */
export function openSaveFromLink() {
  const q = new URLSearchParams(location.search)
  if (q.get('save') !== 'phone') return
  const url = new URL(location.href)
  url.searchParams.delete('save')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  if (!runningInstalled()) openSaveShasta(true)
}

export type Platform = 'ios' | 'android' | 'chromeos' | 'mac' | 'other'
export function platform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/CrOS/.test(ua)) return 'chromeos'
  if (/Macintosh/.test(ua)) return 'mac'
  return 'other'
}
