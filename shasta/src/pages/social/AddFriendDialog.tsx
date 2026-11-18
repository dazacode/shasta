// "Add a friend" on the desktop: YOUR friend code as a QR (`<social origin>/me#f=<token>`), for a friend who is with
// you to scan with their phone. The server makes each code single-use and valid for 60 s; a new one is fetched about
// every 50 s while the dialog is open and the window is visible, so a screenshot stops working fast. Adding happens in
// person only: no search, no suggestions. The friend's scan becomes a request you accept here or on your phone.
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { errorText, social } from '@/social/api'
import { socialOrigin } from '@/social/origin'
import { useSocial } from '@/social/store'
import { QrImage } from '@/components/DiscordQr'
import { CountdownRing, Sheet } from '@/components/social'

const REFRESH_BEFORE_MS = 10_000

function useFriendCode() {
  const [code, setCode] = useState<{ token: string; expiresAt: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
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
    // a hidden window stops making codes; coming back makes a fresh one at once
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      void next()
    }
    void next()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return { code, error }
}

export function AddFriendDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add a friend" description="Friends are added in person. Ask a friend who's with you to scan this code with their phone's camera, or with Shasta on their phone (Add, then Scan a friend's code).">
      {/* mounted only while open: codes are made only while someone can see them, and a closed dialog keeps none */}
      {open && <CodeBody />}
    </Sheet>
  )
}

function CodeBody() {
  const handle = useSocial((s) => s.me?.handle)
  const { code, error } = useFriendCode()
  return (
    <div className="grid justify-items-center gap-3 text-center">
      {code ? (
        <>
          <QrImage value={`${socialOrigin()}/me#f=${code.token}`} label={`QR code to add @${handle ?? 'me'} as a friend`} className="size-60 p-2" />
          <CountdownRing key={code.token} expiresAt={code.expiresAt} total={code.total} />
        </>
      ) : error ? (
        <p className="py-16 text-sm text-shasta-danger" role="alert">{error}</p>
      ) : (
        <p className="flex items-center gap-2 py-24 text-sm text-shasta-muted">
          <Loader2 className="size-4 sh-spin" aria-hidden /> Making your code…
        </p>
      )}
      <p className="max-w-xs text-sm text-shasta-muted">It changes every minute and works once, so a screenshot stops working. When they scan it, their request shows up here for you to accept.</p>
      <p className="max-w-xs text-xs text-shasta-faint">To scan someone else's code, use Shasta on your phone.</p>
    </div>
  )
}
