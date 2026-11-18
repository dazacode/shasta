// Adding people, in person only: "My code" is a QR of `<social origin>/me#f=<token>` that the server makes single-use
// and valid for 60 s, refreshed here every ~50 s (a screenshot dies fast); "Scan a friend" reads theirs; "Link a
// computer" reads a Chromebook's `#l=` code. No search, no suggestions. The scanner only accepts Shasta's own links.
import { useEffect, useRef, useState } from 'react'
import { Camera, Laptop, ScanLine, UserPlus } from 'lucide-react'
import type { Person } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialOrigin } from '@/social/origin'
import { useSocial } from '@/social/store'
import { QrImage } from '@/components/DiscordQr'
import { CountdownRing } from '@/components/social/Countdown'
import { SocialAvatar } from '@/components/social/SocialAvatar'
import { scannedArrival } from '../arrival'
import { useNav } from '../nav'
import { BigButton, Note, Screen, Spinner } from '../ui'

const REFRESH_BEFORE_MS = 10_000

function useFriendCode(active: boolean) {
  const [code, setCode] = useState<{ token: string; expiresAt: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const next = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const c = await social.friendCode()
        if (!live) return
        const total = Math.max(1000, c.expiresAt - Date.now())
        setCode({ ...c, total })
        setError(null)
        timer = setTimeout(() => void next(), Math.max(5000, total - REFRESH_BEFORE_MS))
      } catch (e) {
        if (!live) return
        setError(errorText(e))
        timer = setTimeout(() => void next(), 15_000)
      }
    }
    // a phone put away stops making codes; coming back makes a fresh one at once
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer)
        void next()
      }
    }
    void next()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
  return { code, error }
}

export function AddTab() {
  const push = useNav((s) => s.push)
  const me = useSocial((s) => s.me)
  const { code, error } = useFriendCode(true)
  return (
    <div className="grid gap-5">
      <section className="grid justify-items-center gap-3 rounded-2xl bg-shasta-home p-5 text-center ring-1 ring-shasta-line" aria-label="My friend code">
        <h2 className="font-medium">My code</h2>
        {code ? (
          <>
            <QrImage value={`${socialOrigin()}/me#f=${code.token}`} label={`QR code to add @${me?.handle ?? 'me'} as a friend`} className="size-60 p-2" />
            <CountdownRing key={code.token} expiresAt={code.expiresAt} total={code.total} />
          </>
        ) : error ? (
          <p className="py-10 text-sm text-shasta-danger" role="alert">{error}</p>
        ) : (
          <Spinner label="Making your code…" />
        )}
        <p className="max-w-xs text-sm text-shasta-muted">Show this to a friend who's with you. It changes every minute and works once, so a screenshot stops working.</p>
      </section>
      <div className="grid gap-2">
        <BigButton onClick={() => push({ r: 'scan', mode: 'friend' })}>
          <ScanLine /> Scan a friend's code
        </BigButton>
        <BigButton variant="secondary" onClick={() => push({ r: 'scan', mode: 'link' })}>
          <Laptop /> Link a computer
        </BigButton>
      </div>
    </div>
  )
}

/** The camera, reading QR codes until it finds a Shasta one. */
export function ScanScreen({ mode }: { mode: 'friend' | 'link' }) {
  const video = useRef<HTMLVideoElement>(null)
  const replace = useNav((s) => s.replace)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let stream: MediaStream | null = null
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (ctrl.signal.aborted) return
        const v = video.current!
        v.srcObject = stream
        await v.play().catch(() => {})
        const { scanVideo } = await import('../scanner')
        while (!ctrl.signal.aborted) {
          const raw = await scanVideo(v, ctrl.signal)
          const a = scannedArrival(raw)
          if (a === 'foreign' || !a) {
            setHint("That isn't a Shasta code.")
            await new Promise((r) => setTimeout(r, 1200))
            continue
          }
          if (mode === 'link' && a.kind !== 'link') {
            setHint("That's a friend code. To link a computer, scan the code on the computer's screen.")
            await new Promise((r) => setTimeout(r, 1500))
            continue
          }
          if (mode === 'friend' && a.kind !== 'friend') {
            setHint("That's a computer's link code. Use Link a computer for it.")
            await new Promise((r) => setTimeout(r, 1500))
            continue
          }
          navigator.vibrate?.(30)
          replace({ r: 'arrival', arrival: a })
          return
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError((e as Error).name === 'NotAllowedError' ? 'Shasta needs the camera to scan. Allow it in your browser settings, or use your camera app instead.' : "The camera couldn't start on this phone. Try your camera app instead.")
      }
    })()
    return () => {
      ctrl.abort()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [mode, replace, attempt])

  return (
    <Screen title={mode === 'friend' ? "Scan a friend's code" : 'Link a computer'}>
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className="size-full object-cover" aria-label="Camera view" />
        <div className="pointer-events-none absolute inset-[15%] rounded-2xl ring-2 ring-white/80" aria-hidden />
      </div>
      <p className="mt-4 text-center text-shasta-muted" aria-live="polite">
        {hint ?? (mode === 'friend' ? 'Point the camera at the code on your friend’s phone.' : 'On the computer, open Shasta and choose “Continue on your phone”, then point the camera at its code.')}
      </p>
      {error && (
        <Note tone="warn" className="mt-4">
          <p>{error}</p>
          <BigButton className="mt-3" variant="secondary" onClick={() => {
              setError(null)
              setAttempt((n) => n + 1)
            }}
          >
            <Camera /> Try again
          </BigButton>
        </Note>
      )}
    </Screen>
  )
}

/** A friend code arrived (scanned here, or opened from the camera app): send the request. */
export function FriendArrival({ token, onDone }: { token: string; onDone(): void }) {
  const [state, setState] = useState<{ s: 'sending' } | { s: 'sent'; to: Person } | { s: 'error'; msg: string }>({ s: 'sending' })
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    social.scanFriend(token).then(
      (r) => setState({ s: 'sent', to: r.request.to }),
      (e) => {
        const code = (e as { code?: string; status?: number }).code
        const status = (e as { status?: number }).status
        setState({
          s: 'error',
          msg:
            code === 'band' || code === 'blocked' || status === 403
              ? "You can't add this person."
              : status === 409
                ? "You're already friends."
                : status === 404 || status === 410 || code === 'expired'
                  ? 'That code ran out. Ask your friend to show their code again and scan it.'
                  : errorText(e),
        })
      },
    )
  }, [token])
  return (
    <Screen title="Add a friend">
      <div className="grid justify-items-center gap-4 pt-8 text-center" aria-live="polite">
        {state.s === 'sending' && <Spinner label="Sending a friend request…" />}
        {state.s === 'sent' && (
          <>
            <SocialAvatar avatar={state.to.avatar} size={96} />
            <p className="text-xl font-medium">Request sent to @{state.to.handle}</p>
            <p className="text-shasta-muted">They need to accept it on their phone. Then you'll see each other here.</p>
          </>
        )}
        {state.s === 'error' && (
          <>
            <UserPlus className="size-12 text-shasta-muted" aria-hidden />
            <p className="text-lg">{state.msg}</p>
          </>
        )}
        <BigButton className="mt-4" onClick={onDone} disabled={state.s === 'sending'}>
          Done
        </BigButton>
      </div>
    </Screen>
  )
}
