import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, Download, Laptop, PackageCheck, School, Sparkles, UserRound } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { APP_BUNDLE_URL, APP_UPDATE_MANIFEST_URL, inInstalledApp, isChromium } from '@/lib/shastaApp'
import { downloadProfile } from '@/lib/profile'
import { useSettings } from '@/stores/settingsStore'
import { useLibrary } from '@/stores/libraryStore'
import { useStore } from '@/store/storeStore'
import { emptyLocal } from '@/store/localLibrary'
import { useUi } from '@/stores/uiStore'
import { InstallDemo } from '@/components/demos/InstallDemo'

// shasta://get-app: how to install Shasta as an app. Since ChromeOS 150 a personal device can install
// the downloaded file itself (no developer flags, no admin) — see docs/on-device-wisp.md §3. A managed
// Chromebook still goes through its administrator. A web page cannot install the app for you (the
// isolated-app scheme is not reachable from a link), so the guide does the parts it can: download,
// copy an address, open a page. Progress is kept in localStorage so it survives a relaunch.

const PROGRESS_KEY = 'shasta-get-app'
type Path = 'own' | 'managed'
interface Progress { path: Path | null; step: number; downloaded: boolean; copied: string[] }
const START: Progress = { path: null, step: 0, downloaded: false, copied: [] }

// Only needed on Chrome older than 150, or if the file-open install does not appear. Newer Chrome has
// the first flag on by default; the second (dev mode) is the manual fallback path.
const FLAG_UNMANAGED = 'chrome://flags/#enable-isolated-web-app-unmanaged-install'
const FLAG_DEV = 'chrome://flags/#enable-isolated-web-app-dev-mode'
const INTERNALS = 'chrome://web-app-internals'
const isChromeOS = () => /CrOS/.test(navigator.userAgent)

function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null') as Partial<Progress> | null
    if (!raw || (raw.path !== 'own' && raw.path !== 'managed' && raw.path !== null)) return START
    return { ...START, ...raw, copied: Array.isArray(raw.copied) ? raw.copied.filter((c) => typeof c === 'string') : [] }
  } catch {
    return START
  }
}
function saveProgress(p: Progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p))
  } catch {
    // private window or blocked storage: the guide still works, it just won't resume after a relaunch
  }
}

/** An address with a one-click copy; remembers that it was copied so the step can show a tick. */
function CopyRow({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-shasta-field p-2 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-shasta-fg">{text}</code>
      <Button
        size="sm"
        variant={copied ? 'secondary' : 'default'}
        onClick={() => void navigator.clipboard.writeText(text).then(onCopy, () => useUi.getState().toast('Could not copy. Select the address and copy it yourself.', { tone: 'error' }))}
      >
        {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
      </Button>
    </div>
  )
}

function StepDots({ count, current }: { count: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${current + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`h-1.5 rounded-full transition-colors duration-150 ease-shasta ${i === current ? 'w-6 bg-shasta-fg' : i < current ? 'w-1.5 bg-shasta-faint' : 'w-1.5 bg-shasta-line'}`} />
      ))}
    </div>
  )
}

/** One screen of the guide: icon, title, body, and the footer buttons. */
function Card({ icon, title, children, footer }: { icon: ReactNode; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-shasta-line bg-shasta-home p-6" aria-live="polite">
      <div className="mb-4 grid size-10 place-items-center rounded-xl bg-shasta-field text-shasta-muted">{icon}</div>
      <h2 className="sh-heading">{title}</h2>
      <div className="mt-2 grid gap-3 text-sm text-shasta-muted">{children}</div>
      {footer && <div className="mt-6 flex flex-wrap items-center justify-between gap-3">{footer}</div>}
    </section>
  )
}

export default function GetAppPage() {
  if (inInstalledApp()) return <InApp />

  return (
    <div className="mx-auto w-full max-w-xl px-8 pt-10 pb-16 text-shasta-fg">
      <header className="mb-8">
        <h1 className="sh-title">Get the Shasta app</h1>
        <p className="mt-1 text-sm text-shasta-muted">Shasta installed in Chrome: every site works, even when the proxy server is down.</p>
      </header>
      {isChromium() ? <Guide /> : (
        <Card icon={<Laptop className="size-5" />} title="Open this page in Chrome">
          <p>The app is a Chrome feature (an Isolated Web App), so it needs Chrome, Edge or another Chromium browser on a computer. Open <code className="font-mono">shasta://get-app</code> there to set it up.</p>
        </Card>
      )}
    </div>
  )
}

function Guide() {
  const [p, setP] = useState<Progress>(loadProgress)
  useEffect(() => {
    saveProgress(p)
  }, [p])
  const set = (patch: Partial<Progress>) => setP((cur) => ({ ...cur, ...patch }))
  const copied = (text: string) => p.copied.includes(text)
  const markCopied = (text: string) => setP((cur) => (cur.copied.includes(text) ? cur : { ...cur, copied: [...cur.copied, text] }))
  const restart = () => setP(START)

  // the stageshow demo of the one-file install, on "Install it" of the personal-device path only (a managed
  // Chromebook's admin decides, so the managed path never shows it)
  const demo = (
    <div className="mb-6" aria-label="Animation: download the file, open it, confirm, and Shasta opens in its own window" role="img">
      <InstallDemo />
    </div>
  )
  if (!p.path) return <Choose onPick={(path) => set({ path, step: 0 })} />
  if (p.path === 'managed') return <Managed onBack={restart} />

  const steps = 4
  const back = <Button variant="ghost" onClick={() => (p.step === 0 ? restart() : set({ step: p.step - 1 }))}><ArrowLeft /> Back</Button>
  const next = (label = 'Next', disabled = false) => (
    <div className="flex items-center gap-3">
      <StepDots count={steps} current={p.step} />
      <Button disabled={disabled} onClick={() => set({ step: p.step + 1 })}>{label} <ArrowRight /></Button>
    </div>
  )

  switch (p.step) {
    case 0:
      return (
        <Card icon={<Download className="size-5" />} title="Download the app" footer={<>{back}{APP_BUNDLE_URL ? next('Next', !p.downloaded) : next('I already have the file')}</>}>
          {APP_BUNDLE_URL ? (
            <>
              <p>One file, about 36 MB. It is the whole app, signed so Chrome can check it.</p>
              <a href={APP_BUNDLE_URL} download className={buttonVariants({ size: 'lg', className: 'w-fit' })} onClick={() => set({ downloaded: true })}>
                {p.downloaded ? <><Check /> Downloading. Get it again</> : <><Download /> Download Shasta</>}
              </a>
              {p.downloaded && <p>Keep it in your Downloads; you'll open it in the next step.</p>}
            </>
          ) : (
            <p>This copy of Shasta doesn't offer the app file yet. Ask whoever runs it, then come back here.</p>
          )}
        </Card>
      )
    case 1:
      return (
        <>
        {demo}
        <Card icon={<PackageCheck className="size-5" />} title="Install it" footer={<>{back}{next("It's installed")}</>}>
          <p>Open the file you just downloaded — it ends in <code className="font-mono">.swbn</code>. {isChromeOS() ? 'In the Files app, open Downloads and double-click it.' : 'Open it from your Downloads folder.'} Chrome asks you to confirm, then Shasta opens in its own window and joins your apps.</p>
          <p className="text-xs">Chrome 150 and newer installs the downloaded file directly, with nothing to switch on.</p>
          <details className="rounded-xl bg-shasta-field p-3 text-xs">
            <summary className="cursor-pointer font-medium text-shasta-fg">Nothing happened, or Chrome is older?</summary>
            <div className="mt-2 grid gap-2">
              <p>Open <code className="font-mono">chrome://flags</code>, set this one to <b className="text-shasta-fg">Enabled</b>, and relaunch Chrome:</p>
              <CopyRow text={FLAG_UNMANAGED} copied={copied(FLAG_UNMANAGED)} onCopy={() => markCopied(FLAG_UNMANAGED)} />
              <p>If the file still won't install, also enable <code className="font-mono">{FLAG_DEV}</code>, then open the address below, choose <b className="text-shasta-fg">Install IWA from Signed Web Bundle</b>, and pick the file:</p>
              <CopyRow text={INTERNALS} copied={copied(INTERNALS)} onCopy={() => markCopied(INTERNALS)} />
            </div>
          </details>
        </Card>
        </>
      )
    case 2:
      return (
        <Card icon={<UserRound className="size-5" />} title="Bring your bookmarks along" footer={<>{back}{next('Finish')}</>}>
          <p>The app keeps its own bookmarks and settings. Save them here, then in the app open Settings → Profile & data → Import.</p>
          <SaveProfile />
          <p className="text-xs">The file holds settings, bookmarks and your installed-app list. No cookies, passwords or history.</p>
        </Card>
      )
    default:
      return (
        <Card icon={<Sparkles className="size-5" />} title="You're set" footer={<><Button variant="ghost" onClick={restart}>Start over</Button><span /></>}>
          <p>Open Shasta from your apps ({isChromeOS() ? 'the launcher' : /Mac/.test(navigator.platform) ? 'Launchpad or Applications' : 'the Start menu'}) whenever you want to browse without the proxy.</p>
          <p>Your connections go from your device to each site, so your network can see which sites you visit, as it would in a normal tab.</p>
        </Card>
      )
  }
}

function SaveProfile() {
  const settings = useSettings((x) => x.settings)
  const bookmarks = useLibrary((x) => x.bookmarks)
  const local = useStore((x) => x.local)
  const [saved, setSaved] = useState(false)
  return (
    <Button
      size="lg"
      variant={saved ? 'secondary' : 'default'}
      className="w-fit"
      onClick={() => {
        downloadProfile(settings, bookmarks, local ?? emptyLocal())
        setSaved(true)
      }}
    >
      {saved ? <><Check /> Saved to Downloads</> : <><Download /> Save my bookmarks & settings</>}
    </Button>
  )
}

function Choose({ onPick }: { onPick: (path: Path) => void }) {
  const option = (path: Path, icon: ReactNode, title: string, body: string) => (
    <button
      onClick={() => onPick(path)}
      className="flex items-start gap-4 rounded-2xl border border-shasta-line bg-shasta-home p-5 text-left transition-colors duration-150 ease-shasta hover:bg-shasta-hover focus-visible:outline-2 focus-visible:outline-shasta-accent"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-shasta-field text-shasta-muted">{icon}</span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-shasta-muted">{body}</span>
      </span>
      <ArrowRight className="ml-auto mt-3 size-4 shrink-0 text-shasta-muted" aria-hidden />
    </button>
  )
  return (
    <div className="grid gap-3">
      <p className="text-sm text-shasta-muted">Where are you installing it?</p>
      {option('own', <Laptop className="size-5" />, 'My own computer or Chromebook', 'About two minutes: download one file and open it. No settings to change.')}
      {option('managed', <School className="size-5" />, 'A school or work Chromebook', 'A managed device installs apps the way its administrator decides.')}
    </div>
  )
}

function Managed({ onBack }: { onBack: () => void }) {
  const note = [
    'Could Shasta be added to our managed Chromebooks?',
    'It is an Isolated Web App: Google Admin console -> Devices -> Chrome -> Apps & extensions -> Isolated Web App.',
    'Either force-install it for everyone, or set User app settings -> Isolated Web App Installation to Allowed so people can install the file themselves.',
    APP_UPDATE_MANIFEST_URL ? `Update manifest: ${APP_UPDATE_MANIFEST_URL}` : '',
  ].filter(Boolean).join('\n')
  const [copiedNote, setCopiedNote] = useState(false)
  return (
    <Card icon={<School className="size-5" />} title="Ask your administrator" footer={<><Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button><span /></>}>
      <p>On a managed Chromebook the administrator decides. They can add it for everyone in a few clicks, or let people install the downloaded file themselves.</p>
      <Button
        size="lg"
        variant={copiedNote ? 'secondary' : 'default'}
        className="w-fit"
        onClick={() => void navigator.clipboard.writeText(note).then(() => setCopiedNote(true))}
      >
        {copiedNote ? <><Check /> Copied, paste it in a message</> : <><Copy /> Copy a note for your admin</>}
      </Button>
      {!APP_UPDATE_MANIFEST_URL && <p className="text-xs">This copy of Shasta hasn't published the app's update address yet, so your admin will need it from whoever runs Shasta.</p>}
    </Card>
  )
}

function InApp() {
  return (
    <div className="mx-auto w-full max-w-xl px-8 pt-10 pb-16 text-shasta-fg">
      <Card icon={<CheckCircle2 className="size-5" />} title="You're using the Shasta app">
        <p>Websites load straight from this device, with no proxy server, and every site runs as itself. Settings → Advanced → Page engine switches between that and Shasta's proxy.</p>
        <p>Coming from Shasta in a browser tab? Settings → Profile & data → Import brings your saved bookmarks and settings in.</p>
      </Card>
    </div>
  )
}
