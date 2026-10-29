// A WebSocket to one of the server's live endpoints (/api/chat/ws, /api/events/ws) that reconnects by itself.
// Live updates used Server-Sent Events, but a Cloudflare quick tunnel in front of the backend holds an event stream
// back entirely, while WebSockets pass. In the installed app the backend is VITE_APP_API_ORIGIN.
import { APP_API_ORIGIN } from './appApi'

export interface LiveSocket {
  close(): void
  /** sends when connected, otherwise drops it (callers only send things that are fine to lose) */
  send(data: unknown): void
}

/** `onState(true)` on every (re)connect: callers catch up on what they missed while it was down */
export function openLiveSocket(path: string, onMessage: (data: string) => void, onState: (connected: boolean) => void): LiveSocket {
  let ws: WebSocket | null = null
  let closed = false
  let delay = 1000
  let timer: ReturnType<typeof setTimeout> | undefined
  const url = new URL(path, APP_API_ORIGIN || location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  const open = () => {
    if (closed || typeof WebSocket === 'undefined') return
    const sock = new WebSocket(url)
    ws = sock
    sock.onopen = () => {
      delay = 1000
      onState(true)
    }
    sock.onmessage = (ev) => onMessage(String(ev.data))
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null
      onState(false)
      if (closed) return
      timer = setTimeout(open, delay)
      delay = Math.min(delay * 2, 15_000)
    }
  }
  open()
  return {
    close() {
      closed = true
      clearTimeout(timer)
      ws?.close()
    },
    send(data) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
    },
  }
}
