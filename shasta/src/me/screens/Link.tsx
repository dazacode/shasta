// The phone's side of linking (social/linkFlow.ts joinLink): it opened `/me#l=...` from a computer's QR code. Shows
// the 3-digit code to compare and the computer's name; on "Link it" the phone (making its account first if it has
// none) approves, and the computer's games and settings come over (bundle.ts importBundle, only ever ADDED).
// A phone that already has an account and arrived from the CAMERA leads with the warning (QR phishing: someone may
// have sent a code to take over the account); the in-app scanner shows a calmer line.
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Laptop, ShieldAlert } from 'lucide-react'
import type { LinkInvite } from '@/social/link'
import type { Profile } from '@/social/types'
import { joinLink, type ScanHandle, type ScanState } from '@/social/linkFlow'
import { importBundle, type ImportResult } from '@/social/bundle'
import { socialKeys } from '@/social/queries'
import { useSocial } from '@/social/store'
import { BigButton, Note, Spinner } from '../ui'
import { Onboarding } from './Onboarding'

export function LinkScreen({ invite, via, onFinish, onYoung, onScanAgain }: { invite: LinkInvite; via: 'camera' | 'scanner'; onFinish(r: { newAccount: boolean }): void; onYoung(): void; onScanAgain(): void }) {
  const status = useSocial((s) => s.status)
  const me = useSocial((s) => s.me)
  const qc = useQueryClient()
  const [state, setState] = useState<ScanState | null>(null)
  const [onboarding, setOnboarding] = useState(false)
  const [imported, setImported] = useState<ImportResult | 'failed' | null>(null)
  const newAccount = useRef(false)
  const handle = useRef<ScanHandle | null>(null)
  // did this phone have an account when the code arrived? (decides the warning and the wording)
  const [hadAccount, setHadAccount] = useState<boolean | null>(null)

  // join once we know whether this phone has an account (its handle goes in the hello)
  useEffect(() => {
    if (status === 'loading' || handle.current) return
    setHadAccount(status === 'ready')
    const avatar = me ? qc.getQueryData<Profile>(socialKeys.profile(me.handle))?.avatar : undefined
    handle.current = joinLink(invite, setState, { me: me && avatar ? { handle: me.handle, avatar } : null })
  }, [status, me, invite, qc])
  useEffect(
    () => () => {
      handle.current?.cancel()
      handle.current = null
    },
    [],
  )

  // the bundle: imported once, as soon as linking is done
  useEffect(() => {
    if (state?.s !== 'done' || imported) return
    if (!state.bundle) return setImported({ added: 0, settings: 0 })
    importBundle(state.bundle).then(setImported, () => setImported('failed'))
  }, [state, imported])

  const approve = () => void handle.current?.approve().catch(() => {})
  const no = () => {
    handle.current?.cancel()
    onFinish({ newAccount: false })
  }

  if (onboarding)
    return (
      <Onboarding
        intro={
          <p className="mb-6 rounded-2xl bg-shasta-field p-4 text-sm">
            First, your account. Then {state && 'deviceName' in state ? state.deviceName : 'the computer'} links to it.
          </p>
        }
        onYoung={() => {
          handle.current?.cancel()
          onYoung()
        }}
        onBack={() => setOnboarding(false)}
        onCreated={() => {
          newAccount.current = true
          setOnboarding(false)
          approve()
        }}
      />
    )

  const body = (() => {
    if (!state || state.s === 'connecting')
      return (
        <>
          <Spinner label="Connecting to the computer…" />
          {state?.code && <Code code={state.code} />}
        </>
      )
    if (state.s === 'confirm') {
      const warn = hadAccount && via === 'camera'
      return (
        <>
          {warn && (
            <Note tone="warn" className="mb-5">
              <p className="flex items-center gap-2 font-medium">
                <ShieldAlert className="size-5 text-shasta-warn" aria-hidden /> Only continue if this code is on a screen in front of you right now.
              </p>
              <p className="mt-1">Nobody from Shasta will ever send you a code.</p>
            </Note>
          )}
          {/* the icon sits beside ONE text run: as direct flex children the words broke into three columns */}
          <p className="flex items-start gap-2 text-shasta-muted">
            <Laptop className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              A computer named <span className="font-medium text-shasta-fg">{state.deviceName}</span> wants to {hadAccount ? 'link to your account' : 'become part of your new account'}.
            </span>
          </p>
          <Code code={state.code} />
          <p className="text-center text-sm text-shasta-muted">{warn ? 'The computer must show this same code.' : 'Check that the computer shows the same code.'}</p>
          <div className="mt-6 grid gap-2">
            <BigButton onClick={() => (hadAccount ? approve() : setOnboarding(true))}>{hadAccount ? 'Link it' : 'Make my account and link it'}</BigButton>
            <BigButton variant="secondary" onClick={no}>
              No, that's not mine
            </BigButton>
          </div>
        </>
      )
    }
    if (state.s === 'approving')
      return (
        <>
          <Code code={state.code} />
          <Spinner label={state.waitingForOther ? 'Now tap “Yes, that’s my phone” on the computer' : 'Linking…'} />
        </>
      )
    if (state.s === 'done')
      return (
        <>
          <h2 className="text-xl font-medium">Linked</h2>
          <p className="mt-2 text-shasta-muted">
            {state.deviceName} is part of your account now. It can't add devices or change backups for 3 days, so a stolen code can't take your account.
          </p>
          {imported === null && <Spinner label="Bringing your games over…" />}
          {imported && imported !== 'failed' && (
            <p className="mt-3">{imported.added ? `${imported.added} ${imported.added === 1 ? 'game' : 'games'} came over from the computer.` : 'Your library on this phone is up to date.'}</p>
          )}
          {imported === 'failed' && <p className="mt-3 text-shasta-danger">Your games couldn't be saved on this phone (storage may be blocked). Everything else worked.</p>}
          <BigButton className="mt-6" disabled={imported === null} onClick={() => onFinish({ newAccount: newAccount.current })}>
            Continue
          </BigButton>
        </>
      )
    return (
      <>
        <h2 className="text-xl font-medium">{state.s === 'expired' ? 'That code ran out of time' : "That didn't work"}</h2>
        <p className="mt-2 text-shasta-muted">{state.s === 'expired' ? 'Codes last 90 seconds. Show a new one on the computer, then scan it.' : state.msg}</p>
        <div className="mt-6 grid gap-2">
          <BigButton onClick={onScanAgain}>Scan a new code</BigButton>
          <BigButton variant="ghost" onClick={() => onFinish({ newAccount: newAccount.current })}>
            {status === 'ready' ? 'Not now' : 'Back'}
          </BigButton>
        </div>
      </>
    )
  })()

  return (
    <div className="me-safe-top me-safe-bottom me-safe-x mx-auto flex min-h-dvh max-w-md flex-col justify-center py-8" aria-live="polite">
      <h1 className="mb-6 text-2xl font-semibold">Link a computer</h1>
      {body}
    </div>
  )
}

function Code({ code }: { code: string }) {
  return (
    <p className="my-6 text-center font-mono text-6xl font-semibold tracking-[0.2em]" aria-label={`Code ${code.split('').join(' ')}`}>
      {code}
    </p>
  )
}
