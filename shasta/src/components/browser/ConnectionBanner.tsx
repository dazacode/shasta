import { WifiOff, Loader2 } from 'lucide-react'
import { useConnection } from '@/stores/connectionStore'
import { useTabs } from '@/stores/tabsStore'
import { shouldSuggestApp } from '@/lib/shastaApp'

/** Shown only while the proxy engine or its Wisp transport is genuinely not working. */
export function ConnectionBanner() {
  const info = useConnection((s) => s.info)
  const reconnect = useConnection((s) => s.reconnect)
  const noBackend = useConnection((s) => s.noBackend)
  const { state, detail } = info
  if (state === 'connected' || state === 'idle') return null

  const busy = state === 'connecting' || state === 'reconnecting'
  const text =
    state === 'connecting'
      ? 'Starting the proxy engine…'
      : state === 'reconnecting'
        ? 'Connection to the proxy was interrupted. Reconnecting…'
        : state === 'disconnected' && noBackend && navigator.onLine
          ? "Website browsing isn't available in this development build yet: no proxy server is connected. Everything else in Shasta works."
          : state === 'disconnected' && !navigator.onLine
          ? "You're offline. Shasta itself keeps working; websites load again once you're back online and the proxy server is reachable."
          : state === 'disconnected'
          ? `Can't reach the proxy server${detail ? ` (${detail})` : ''}. Pages can't load until it's back.`
          : `The proxy engine failed to start: ${detail}`

  return (
    <div role="alert" className="flex items-center justify-center gap-3 border-t border-shasta-line bg-shasta-field px-4 py-1.5 text-sm text-shasta-fg">
      {busy ? <Loader2 className="size-4 sh-spin text-shasta-accent" /> : <WifiOff className="size-4 text-shasta-warn" />}
      <span>{text}</span>
      {!busy && (
        <>
          <button onClick={() => void reconnect()} className="rounded-full bg-shasta-hover px-3 py-0.5 font-medium hover:bg-shasta-line">
            Retry now
          </button>
          {/* the installed app browses without the proxy server, so it is the real way out of this banner */}
          {shouldSuggestApp() && (
            <button onClick={() => useTabs.getState().openInternal('get-app')} className="rounded-full bg-shasta-accent px-3 py-0.5 font-medium text-white hover:opacity-90">
              Get the app: browse without a server
            </button>
          )}
          <button onClick={() => useTabs.getState().openInternal('settings')} className="rounded-full px-3 py-0.5 text-shasta-muted hover:bg-shasta-hover">
            Connection settings
          </button>
        </>
      )}
    </div>
  )
}
