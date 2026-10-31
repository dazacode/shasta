// first: in the installed app, sends /api and /ai-models to the backend before anything fetches
import './lib/appApi'
import { captureConsole } from './lib/consoleCapture'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Settings -> Advanced -> Console: Shasta's own console output, for people whose DevTools are blocked
captureConsole(window, 'Shasta')

// A lazy chunk that is gone means this page is an older build than the host now serves (a CDN or browser cache kept
// the old page): reload once to pick up the current one. At most once a minute, so a real outage cannot loop.
addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('shasta-chunk-reload') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('shasta-chunk-reload', String(Date.now()))
  } catch {
    return
  }
  e.preventDefault()
  location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
