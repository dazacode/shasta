// first: in the installed app, sends /api and /ai-models to the backend before anything fetches
import './lib/appApi'
import { captureConsole } from './lib/consoleCapture'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Settings -> Advanced -> Console: Shasta's own console output, for people whose DevTools are blocked
captureConsole(window, 'Shasta')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
