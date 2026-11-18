// Shasta on your phone (me.html): the phone IS the account. Opened by scanning a Shasta QR code with the camera
// (`/me#l=...` links a Chromebook, `/me#f=...` adds a friend), or from the Home Screen. Its own small bundle: none of
// the browser, the proxy engine or the on-device AI loads here.
// Order matters: the hash is read and stripped before anything else runs (arrival.ts).
import '@/lib/appApi'
import { announceArrival, arrivalFrom, takeArrival } from './arrival'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { onLaunch } from '@/lib/launchQueue'
import { wireSocialQueries } from '@/social/queries'
import { BASE } from '@/lib/edition'
import { App } from './App'
import { watchInstall } from './install'
import { watchHistory } from './nav'
import './me.css'

const arrival = takeArrival()

// light or dark follows the phone
const dark = matchMedia('(prefers-color-scheme: dark)')
const applyScheme = () => {
  document.documentElement.classList.toggle('dark', dark.matches)
  document.documentElement.classList.toggle('light', !dark.matches)
}
applyScheme()
dark.addEventListener('change', applyScheme)

watchInstall()
watchHistory()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => n < 2 && (e as { status?: number })?.status !== 401 && (e as { status?: number })?.status !== 404, refetchOnWindowFocus: true },
  },
})
wireSocialQueries(queryClient)

// the installed app may be handed a scanned link instead of loading it (lib/launchQueue.ts): load it
onLaunch((url) => {
  if (/\/me(\.html|\/)?$/.test(url.pathname)) announceArrival(arrivalFrom(url.hash, 'camera'))
})
// another code opened in this same tab
window.addEventListener('hashchange', () => announceArrival(takeArrival()))

// a small worker of our own, only for /me/ (public/me/sw.js); never Shasta's main one
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${BASE}me/sw.js`, { scope: `${BASE}me/` }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App arrival={arrival} />
    </QueryClientProvider>
  </StrictMode>,
)
