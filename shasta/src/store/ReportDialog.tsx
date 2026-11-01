// "Report a problem": one dialog for every place a person can hit one (the Store listing, the running app's toolbar,
// the app's error screen, the main menu while a Store app is open). Two taps for the usual case: pick what's wrong,
// send. Optional technical details (shown in full, can be left out) help the team fix it the moment it arrives.
// Reports are anonymous; the official storefront's reports also reach the Shasta team's Discord (server/discord/reports.ts).
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/stores/settingsStore'
import { chromeVersion } from '@/lib/browserSupport'
import { cn } from '@/lib/utils'
import { api, errorMessage } from './api'
import { timeAgo } from './hooks'
import { useStore } from './storeStore'

export interface ReportTarget {
  appId: string
  name: string
  /** from the official storefront; looked up in the library when not given */
  official?: boolean
  isGame?: boolean
  /** 'package' runs in Shasta's app runtime, 'linked' in a normal (proxied or direct) tab */
  kind?: 'package' | 'linked'
  appVersion?: string | null
  /** the error the person is looking at, if any */
  error?: string | null
  /** start on this problem (e.g. "wont-load" from an error screen) */
  problem?: Problem
}

export const useReport = create<{ target: ReportTarget | null; open: (t: ReportTarget) => void; close: () => void }>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
export const openReport = (t: ReportTarget) => useReport.getState().open(t)

const PROBLEMS = [
  ['wont-load', "Won't load / blank screen"],
  ['stuck-loading', 'Stuck loading'],
  ['crash', 'Crashes or freezes'],
  ['controls', "Controls don't work"],
  ['sound', 'No sound'],
  ['slow', 'Very slow / laggy'],
  ['dead', 'Dead link / site is gone'],
  ['outdated', 'Old version, needs an update'],
  ['other', 'Something else is broken'],
] as const
type Problem = (typeof PROBLEMS)[number][0]

const OTHER_REASONS = [
  ['inappropriate', 'Inappropriate content'],
  ['malicious', 'Harmful, deceptive or unsafe'],
  ['copyright', 'Copyright or impersonation'],
  ['other', 'Something else'],
] as const

// which apps this device reported, and when (device only, so the dialog can say "you already reported this")
const SEEN_KEY = 'shasta-reported'
const seen = (): Record<string, number> => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function remember(appId: string) {
  try {
    const week = Date.now() - 7 * 86_400_000
    const next = Object.fromEntries(Object.entries(seen()).filter(([, t]) => t > week))
    next[appId] = Date.now()
    localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {}
}

function osName(): string {
  const ua = navigator.userAgent
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}

function browserName(): string {
  const v = chromeVersion()
  if (/Edg\//.test(navigator.userAgent)) return `Edge ${/Edg\/(\d+)/.exec(navigator.userAgent)?.[1] ?? ''}`.trim()
  if (v) return `Chrome ${v}`
  if (/Firefox\/(\d+)/.test(navigator.userAgent)) return `Firefox ${/Firefox\/(\d+)/.exec(navigator.userAgent)![1]}`
  if (/Safari\//.test(navigator.userAgent)) return 'Safari'
  return ''
}

/** exactly what is sent when "Include technical details" is on (also shown to the person) */
function techInfo(t: ReportTarget, engine: string) {
  const info: Record<string, string> = { shasta: __APP_VERSION__, browser: browserName(), os: osName(), engine: t.kind === 'package' ? 'app runtime' : engine }
  if (t.appVersion) info.appVersion = t.appVersion
  if (t.error) info.error = t.error.slice(0, 300)
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v))
}
const INFO_LABEL: Record<string, string> = { shasta: 'Shasta version', browser: 'Browser', os: 'System', engine: 'Page engine', appVersion: 'App version', error: 'Error shown' }

/** Mounted once (App.tsx). */
export function ReportHost() {
  const target = useReport((s) => s.target)
  const close = useReport((s) => s.close)
  return <ReportDialog target={target} onClose={close} />
}

function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const engine = useSettings((s) => s.settings.pageEngine)
  const library = useStore((s) => s.library)
  const [choice, setChoice] = useState('')
  const [details, setDetails] = useState('')
  const [withInfo, setWithInfo] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  // a fresh dialog for every app it is opened for
  useEffect(() => {
    if (!target) return
    setChoice(target.problem ? `p:${target.problem}` : '')
    setDetails('')
    setWithInfo(true)
    setError('')
    setSent(false)
  }, [target])

  if (!target) return <Dialog open={false} />
  const installed = library?.installed.find((i) => i.app.id === target.appId)?.app
  const official = target.official ?? installed?.store?.official ?? false
  const thing = (target.isGame ?? installed?.category?.isGame) ? 'game' : 'app'
  const reportedAt = seen()[target.appId]
  const info = techInfo(target, engine)
  const [kind, value] = (choice ? choice.split(':') : ['', '']) as ['p' | 'r' | '', string]

  const send = async () => {
    setSending(true)
    setError('')
    try {
      await api.post(`/api/apps/${target.appId}/report`, {
        reason: kind === 'p' ? 'broken' : value,
        problem: kind === 'p' ? value : undefined,
        details,
        info: withInfo ? info : undefined,
      })
      remember(target.appId)
      setSent(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {sent ? (
          <>
            <DialogHeader>
              <div className="mb-1 grid size-11 place-items-center rounded-full bg-shasta-field text-shasta-fg"><Check className="size-5" /></div>
              <DialogTitle>Thanks, it's sent</DialogTitle>
              <DialogDescription>
                {official
                  ? `The Shasta team got your report about ${target.name} and usually fixes broken ${thing}s quickly. You don't need to report it again; if it's still broken after it's fixed, just send another.`
                  : `The Store owner got your report about ${target.name} and will look at it.`}
              </DialogDescription>
            </DialogHeader>
            {kind === 'p' && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-shasta-muted">
                <li>Reloading the {thing} sometimes helps in the meantime.</li>
                {value === 'controls' && <li>Click inside the {thing} first, or turn on Game mode from the menu.</li>}
                {(value === 'wont-load' || value === 'stuck-loading') && <li>On a school network, the {thing}'s site may be blocked there. Try it somewhere else.</li>}
              </ul>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report a problem with {target.name}</DialogTitle>
              <DialogDescription>
                {official
                  ? `This is one of Shasta's own ${thing}s, so your report goes straight to the Shasta team (it's also posted in the staff channel of Shasta's Discord) and gets fixed.`
                  : 'Your report goes to the Store owner, who can fix or unpublish it.'}{' '}
                Reports are anonymous: nothing identifies you.
              </DialogDescription>
            </DialogHeader>
            {reportedAt && <p className="rounded-lg bg-shasta-field px-3 py-2 text-xs text-shasta-muted">You reported this {timeAgo(reportedAt)}. Sending another adds to it; the team sees them together.</p>}
            <fieldset>
              <legend className="mb-2 text-sm font-medium">What's wrong?</legend>
              <div className="flex flex-wrap gap-1.5">
                {PROBLEMS.map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={choice === `p:${v}`}
                    onClick={() => setChoice(`p:${v}`)}
                    className={cn('h-8 rounded-full px-3 text-sm ring-1 transition-[color,background-color,box-shadow] duration-150 ease-shasta outline-none focus-visible:ring-2 focus-visible:ring-shasta-accent', choice === `p:${v}` ? 'bg-shasta-raised text-shasta-fg ring-shasta-fg/30' : 'text-shasta-muted ring-shasta-line hover:bg-shasta-hover hover:text-shasta-fg')}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <details className="mt-2 text-sm" open={kind === 'r'}>
                <summary className="cursor-pointer text-xs text-shasta-muted">It works, but something about it isn't right</summary>
                <div className="mt-1.5 grid gap-0.5">
                  {OTHER_REASONS.map(([v, l]) => (
                    <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-shasta-hover">
                      <input type="radio" name="report-reason" checked={choice === `r:${v}`} onChange={() => setChoice(`r:${v}`)} className="accent-[var(--sh-accent)]" /> {l}
                    </label>
                  ))}
                </div>
              </details>
            </fieldset>
            <label className="grid gap-1 text-xs text-shasta-muted">
              Anything else? (optional)
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder={kind === 'p' ? 'e.g. "black screen after the logo", "level 3 never loads", "the jump key does nothing"' : 'What should the team know?'}
                className="rounded-lg bg-shasta-field p-2 text-sm text-shasta-fg ring-1 ring-shasta-line placeholder:text-shasta-muted/70"
              />
            </label>
            <div className="rounded-lg bg-shasta-field px-3 py-2 text-xs">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span>
                  <span className="font-medium text-shasta-fg">Include technical details</span>
                  <span className="block text-shasta-muted">Helps the team fix it faster. Nothing that identifies you.</span>
                </span>
                <Switch checked={withInfo} onCheckedChange={setWithInfo} aria-label="Include technical details" className="data-checked:bg-shasta-accent" />
              </label>
              {withInfo && (
                <details className="mt-1.5 text-shasta-muted">
                  <summary className="cursor-pointer">Exactly what is sent</summary>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {Object.entries(info).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt>{INFO_LABEL[k] ?? k}</dt>
                        <dd className="break-all text-shasta-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </div>
            {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={sending || !choice} onClick={send}>{sending && <Loader2 className="sh-spin" />} Send report</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
