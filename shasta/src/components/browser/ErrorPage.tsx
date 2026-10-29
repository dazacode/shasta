import { ExternalLink, CloudOff, Flag, RotateCw, Pencil, WifiOff, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { classifyError } from '@/lib/errors'
import { classifySignIn, directOpenUrl, openInHostBrowser } from '@/lib/authGuidance'
import { displayUrl, hostOf } from '@/lib/url'
import { useConnection } from '@/stores/connectionStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import type { Tab } from '@/lib/tabModel'
import { shouldSuggestApp } from '@/lib/shastaApp'
import { openReport } from '@/store/ReportDialog'

export function ErrorPage({ tab }: { tab: Tab }) {
  const conn = useConnection((s) => s.info.state)
  const reconnect = useConnection((s) => s.reconnect)
  const noBackend = useConnection((s) => s.noBackend)
  if (!tab.error) return null
  const proxyDown = conn === 'disconnected' || conn === 'reconnecting' || conn === 'error'
  const info = classifyError(tab.error.message, { online: navigator.onLine, proxyDown, noBackend })
  const Icon = info.kind === 'offline' || info.kind === 'proxy' ? WifiOff : info.kind === 'tls' || info.kind === 'blocked' ? ShieldAlert : CloudOff

  const signIn = classifySignIn(tab.error.url)
  const canOpenDirect = !!directOpenUrl(tab.error.url)
  return (
    <div role="alert" className="absolute inset-0 z-10 grid place-items-center overflow-auto bg-shasta-bg px-6 py-10">
      <div className="max-w-lg">
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-shasta-field text-shasta-warn">
          <Icon className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{info.title}</h1>
        <p className="mt-1 break-all text-sm text-shasta-muted">{displayUrl(tab.error.url) || hostOf(tab.error.url)}</p>
        <p className="mt-4 text-[15px] leading-relaxed">{info.body}</p>
        {signIn.isSignIn && (
          <p className="mt-3 rounded-xl bg-shasta-field px-4 py-3 text-sm">
            This looks like a sign-in page. {signIn.known ? `${signIn.known.title}. ${signIn.known.body}` : 'Some sign-in methods do not work through a proxy.'} You can open the original website in your browser instead; Shasta can't promise every login works.
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            size="lg"
            onClick={() => {
              if (proxyDown) void reconnect()
              useTabs.getState().reload(tab.id)
            }}
          >
            <RotateCw /> Try again
          </Button>
          <Button size="lg" variant="outline" onClick={() => useUi.getState().requestOmniboxFocus()}>
            <Pencil /> Edit address
          </Button>
          <Button size="lg" variant="ghost" onClick={() => useTabs.getState().resetFrame(tab.id)}>
            Reset this tab
          </Button>
          {canOpenDirect && (
            <Button size="lg" variant="ghost" onClick={() => openInHostBrowser(tab.error!.url)}>
              <ExternalLink /> Open the original website in your browser
            </Button>
          )}
        </div>
        {tab.app && info.kind !== 'offline' && info.kind !== 'proxy' && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-shasta-field px-4 py-3 text-sm">
            <span className="flex-1">Is {tab.app.name} broken for you? Tell the team and it gets fixed.</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openReport({ appId: tab.app!.id, name: tab.app!.name, isGame: tab.app!.scheme === 'game', kind: tab.app!.kind, problem: info.kind === 'dns' || info.kind === 'refused' ? 'dead' : 'wont-load', error: `${info.title} (${tab.error!.message})` })}
            >
              <Flag /> Report this {tab.app.scheme === 'game' ? 'game' : 'app'}
            </Button>
          </div>
        )}
        {shouldSuggestApp() && info.kind !== 'offline' && (
          <p className="mt-6 rounded-xl bg-shasta-field px-4 py-3 text-sm">
            The Shasta app loads sites straight from your device and runs sites the proxy can't.{' '}
            <button className="font-medium text-shasta-accent underline-offset-2 hover:underline" onClick={() => useTabs.getState().openInternal('get-app')}>Get the app</button>
          </p>
        )}
        <details className="mt-8 text-xs text-shasta-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="mt-2 whitespace-pre-wrap">{tab.error.message}</pre>
        </details>
      </div>
    </div>
  )
}
