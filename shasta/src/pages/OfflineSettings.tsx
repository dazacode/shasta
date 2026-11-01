import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CloudOff, Download, KeyRound, Loader2, RefreshCw, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Row, Toggle } from './settingsParts'
import { useSettings } from '@/stores/settingsStore'
import { useOffline } from '@/stores/offlineStore'
import { useConnection } from '@/stores/connectionStore'
import { formatBytes } from '@/stores/downloadsStore'
import { summarize } from '@/lib/offline'
import * as offline from '@/lib/offline'
import { useUi } from '@/stores/uiStore'

function wispHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function ago(t: number | null | undefined, now: number) {
  if (!t) return ''
  const m = Math.floor((now - t) / 60_000)
  return m < 1 ? 'Checked just now' : m < 60 ? `Checked ${m} min ago` : `Checked ${Math.floor(m / 60)} h ago`
}

type Tone = 'ok' | 'busy' | 'ready' | 'warn' | 'muted'
const TONES: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  busy: 'bg-shasta-field text-shasta-muted',
  ready: 'bg-shasta-field text-shasta-accent',
  warn: 'bg-shasta-danger/15 text-shasta-danger',
  muted: 'bg-shasta-field text-shasta-muted',
}

/** Which version runs here, whether a newer one exists, and the one button that fits. */
function VersionCard() {
  const { status, update, updateReady, signInExpired } = useOffline()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  // opening this page looks again, unless that just happened
  useEffect(() => {
    const u = useOffline.getState().update
    if (!u?.checkedAt || Date.now() - u.checkedAt > 5 * 60_000) void useOffline.getState().checkUpdate()
  }, [])

  const check = () => void useOffline.getState().checkUpdate({ fromUser: true })
  const build = status?.version ? `build ${status.version.slice(0, 8)}` : ''
  const version = [status?.app ? `Shasta ${status.app}` : 'Shasta', build].filter(Boolean).join(' · ')

  let tone: Tone, icon: ReactNode, title: string, desc: string, actions: ReactNode
  if (status && !status.enabled) {
    tone = 'muted'
    icon = <Sparkles />
    title = 'Development build'
    desc = 'This build always runs the newest code from the dev server, so there is nothing to update.'
    actions = null
  } else if (updateReady) {
    tone = 'ready'
    icon = <Sparkles />
    title = 'Update ready'
    desc = 'A new version of Shasta is installed. Restart to use it; your tabs come back.'
    actions = <Button onClick={() => void useOffline.getState().applyUpdate()}><RefreshCw /> Restart now</Button>
  } else if (update?.checking) {
    tone = 'busy'
    icon = <Loader2 className="animate-spin" />
    title = 'Checking for updates…'
    desc = 'If there is a new version, it downloads now and is ready after a restart.'
    actions = null
  } else if (signInExpired || update?.state === 'signin') {
    tone = 'warn'
    icon = <KeyRound />
    title = 'Sign in to get updates'
    desc = 'Your sign-in to this Shasta site has expired. The copy on this device keeps working meanwhile.'
    actions = <Button onClick={offline.reloadFromServer}>Sign in</Button>
  } else if (update?.state === 'failed') {
    tone = 'warn'
    icon = <AlertTriangle />
    title = "Couldn't update to the newest version"
    desc = `This device keeps running the previous version, which still works. ${update.error?.message ?? ''} Try again, or reload Shasta straight from the server.`
    actions = (
      <>
        <Button variant="outline" onClick={check}><RefreshCw /> Try again</Button>
        <Button onClick={offline.reloadFromServer}><RotateCcw /> Reload from server</Button>
      </>
    )
  } else if (update?.state === 'offline') {
    tone = 'muted'
    icon = <CloudOff />
    title = "Can't check for updates right now"
    desc = "You're offline. Shasta keeps working and checks again when you're back online."
    actions = <Button variant="outline" disabled={!navigator.onLine} onClick={check}><RefreshCw /> Check again</Button>
  } else {
    tone = 'ok'
    icon = <CheckCircle2 />
    title = update ? 'Shasta is up to date' : 'Updates'
    desc = 'New versions download in the background and are ready after a restart. If one ever fails, the current version keeps working and Shasta tells you.'
    actions = <Button variant="outline" disabled={!navigator.onLine} onClick={check}><RefreshCw /> Check for updates</Button>
  }

  return (
    <section aria-labelledby="version-title" aria-live="polite" className="mb-4 flex max-w-2xl flex-wrap items-start gap-4 rounded-2xl border border-shasta-line bg-shasta-home p-5">
      <div aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5 ${TONES[tone]}`}>{icon}</div>
      <div className="min-w-0 flex-1 basis-60">
        <h3 id="version-title" className="font-medium">{title}</h3>
        <p className="mt-0.5 text-sm text-shasta-muted">{desc}</p>
        <p className="sh-meta mt-2">
          {version}
          {update?.checkedAt && !update.checking ? ` · ${ago(update.checkedAt, now)}` : ''}
        </p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 self-center">{actions}</div>}
    </section>
  )
}

/** Settings -> Updates & offline. Honest about the line between Shasta itself (works offline) and websites (never do). */
export function OfflineSection() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const { status, phase, progress, error, storage } = useOffline()
  const connected = useConnection((x) => x.info.state === 'connected')
  const endpoint = useConnection((x) => x.info.endpoint) ?? s.wispUrl

  useEffect(() => {
    void useOffline.getState().refresh()
  }, [])

  const core = status ? summarize(status.files, 'core') : null
  const ai = status ? summarize(status.files, 'ai') : null
  const ready = !!core?.complete && (!s.offlineAiRuntime || !!ai?.complete)
  const busy = phase === 'downloading'
  const pct = progress && progress.total ? Math.floor((progress.done / progress.total) * 100) : 0

  const state = !status
    ? 'Checking…'
    : !status.enabled
      ? 'Not available in this build. The dev server (bun run dev) is never cached; use bun run build.'
      : busy
        ? `Downloading… ${pct}% (${formatBytes(progress?.done ?? 0)} of ${formatBytes(progress?.total ?? 0)})`
        : ready
          ? `Ready. Shasta ${status.app ?? ''} starts on this device without a network.`
          : core && core.cachedFiles > 0
            ? `Partly downloaded (${formatBytes(core.cachedBytes)} of ${formatBytes(core.bytes)}). ${navigator.onLine ? 'Download to finish it.' : 'It continues when you are back online.'}`
            : status.error
              ? status.error.message
              : 'Not downloaded yet.'

  const start = async () => {
    // a click is the moment the browser may grant persistence
    await useOffline.getState().persist()
    if (!s.offlineShell) update({ offlineShell: true })
    await useOffline.getState().download({ fromUser: true })
  }
  const setKeep = useOffline((x) => x.setKeep)

  return (
    <>
      <p className="mb-2 max-w-2xl rounded-xl bg-shasta-field p-3 text-sm text-shasta-muted" role="note">
        Offline, Shasta itself keeps working: tabs, settings, bookmarks, history, downloads, your library and AI models already on this device. Opening websites always needs an internet connection and the Wisp relay ({wispHost(endpoint)}{connected ? ', connected now' : ', not reachable right now'}).
      </p>
      <VersionCard />
      <Row title="Offline copy" desc={state}>
        {busy ? (
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-shasta-line" role="progressbar" aria-label="Offline download" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-shasta-accent" style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <Button variant="outline" disabled={!status?.enabled} onClick={() => void start()}>
            {ready ? <RefreshCw /> : <Download />} {ready ? 'Check again' : 'Download for offline use'}
          </Button>
        )}
      </Row>
      {error && phase === 'error' && (
        <p className="-mt-2 mb-2 text-sm text-shasta-danger" role="alert">
          {error.message} {['network', 'stalled', 'http'].includes(error.code) ? 'What is already downloaded is kept; it continues from there.' : ''}
        </p>
      )}
      <Row title="Keep Shasta available offline" desc={`Downloads Shasta's own files in the background${core ? ` (${formatBytes(core.bytes)})` : ''} and keeps them up to date. Off: nothing new is downloaded automatically.`} htmlFor="offline-shell">
        <Toggle id="offline-shell" label="Keep Shasta available offline" checked={s.offlineShell} onChange={(offlineShell) => void setKeep({ offlineShell })} />
      </Row>
      <Row title="Include the AI runtime" desc={`Also keeps the engine the on-device AI runs on${ai ? ` (${formatBytes(ai.bytes)})` : ''}, so AI models you already downloaded in Settings → AI work offline. AI models themselves are never downloaded from here.${ai?.complete ? ' Downloaded.' : ''}`} htmlFor="offline-ai">
        <Toggle id="offline-ai" label="Include the AI runtime" checked={s.offlineAiRuntime} onChange={(offlineAiRuntime) => void setKeep({ offlineAiRuntime })} />
      </Row>
      <Row
        title="Storage"
        desc={
          storage?.usage != null
            ? `${formatBytes(storage.usage)} used by Shasta on this device${storage.quota ? `, ${formatBytes(storage.quota)} available to it` : ''}. ${storage.persisted ? 'The browser keeps it even when space runs low.' : 'The browser may remove it when space runs low; downloading asks it to keep it (it decides on its own, installed apps usually get it).'}`
            : 'This browser does not report storage use.'
        }
      >
        {storage && !storage.persisted && (
          <Button variant="outline" onClick={async () => useUi.getState().toast((await useOffline.getState().persist()) ? 'The browser will keep Shasta’s data.' : 'The browser did not agree to keep it for now. Installing Shasta as an app usually helps.')}>
            Ask to keep it
          </Button>
        )}
      </Row>
      <Row title="Clear offline data" desc="Removes the offline copy of Shasta's files. Settings, bookmarks, history, site data and AI models are not touched. Turns off “Keep Shasta available offline”.">
        <Button
          variant="outline"
          disabled={busy || !core?.cachedFiles}
          onClick={async () => {
            update({ offlineShell: false })
            await useOffline.getState().clear()
            useUi.getState().toast('Offline copy removed.')
          }}
        >
          <Trash2 /> Clear
        </Button>
      </Row>
      <Row
        title="Reload from the server"
        desc="Starts Shasta once straight from the server, skipping the copy saved on this device. Use it if Shasta looks out of date or something stopped working after an update. Your tabs, settings, bookmarks and data stay as they are."
      >
        <Button variant="outline" disabled={!navigator.onLine} onClick={offline.reloadFromServer}>
          <RotateCcw /> Reload from server
        </Button>
      </Row>
    </>
  )
}
