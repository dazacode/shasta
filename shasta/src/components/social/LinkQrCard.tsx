// The SHOW side of linking (social/linkFlow.ts startShow): the QR code to scan with a phone camera, then the 3-digit
// code to compare with the phone, and "Yes, that's my phone". Drives nothing itself: pass it the flow's state.
import { Loader2, RefreshCw, Smartphone } from 'lucide-react'
import type { ShowState } from '@/social/linkFlow'
import { QrImage } from '@/components/DiscordQr'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SocialAvatar } from './SocialAvatar'
import { CountdownRing } from './Countdown'

export interface LinkQrCardProps {
  state: ShowState
  onConfirm(): void
  /** "No, show a new code" / after expiry or an error */
  onRetry(): void
  onCancel?(): void
  /** what this screen is called in the copy, e.g. "this Chromebook" */
  deviceLabel?: string
  className?: string
}

export function LinkQrCard({ state, onConfirm, onRetry, onCancel, deviceLabel = 'this computer', className }: LinkQrCardProps) {
  return (
    <div className={cn('grid justify-items-center gap-4 rounded-2xl bg-shasta-home p-5 text-center ring-1 ring-shasta-line', className)} aria-live="polite">
      {state.s === 'starting' && (
        <p className="flex items-center gap-2 py-16 text-shasta-muted">
          <Loader2 className="size-5 sh-spin" aria-hidden /> Getting a code…
        </p>
      )}
      {state.s === 'waiting' && (
        <>
          <QrImage value={state.url} label="QR code: scan it with your phone's camera" className="size-56 p-2" />
          <div>
            <p className="font-medium">Scan with your phone's camera</p>
            <p className="mt-1 max-w-xs text-sm text-shasta-muted">Tap the link that appears. Your phone becomes your Shasta account; no password needed.</p>
          </div>
          <CountdownRing expiresAt={state.expiresAt} total={90_000} />
        </>
      )}
      {state.s === 'peer' && (
        <>
          {state.avatar ? <SocialAvatar avatar={state.avatar} size={64} /> : <Smartphone className="size-12 text-shasta-muted" aria-hidden />}
          <div>
            <p className="font-medium">{state.handle ? `Link ${deviceLabel} to @${state.handle}'s phone?` : `Link ${deviceLabel} to the phone that scanned?`}</p>
            <p className="mt-1 text-sm text-shasta-muted">Check that your phone shows the same code:</p>
          </div>
          <p className="font-mono text-5xl font-semibold tracking-[0.2em]" aria-label={`Code ${state.code.split('').join(' ')}`}>
            {state.code}
          </p>
          {state.confirmed ? (
            <p className="flex items-center gap-2 text-sm text-shasta-muted">
              <Loader2 className="size-4 sh-spin" aria-hidden /> Now tap “Link it” on your phone
            </p>
          ) : (
            <div className="grid w-full max-w-xs gap-2">
              <Button className="h-11" onClick={onConfirm}>
                Yes, that's my phone
              </Button>
              <Button variant="ghost" className="h-11" onClick={onRetry}>
                No, show a new code
              </Button>
            </div>
          )}
        </>
      )}
      {state.s === 'approved' && <p className="py-10 font-medium">Linked. Your friends and messages are here now.</p>}
      {(state.s === 'expired' || state.s === 'error') && (
        <>
          <p className="pt-8 font-medium">{state.s === 'expired' ? 'That code ran out of time.' : state.msg}</p>
          <Button className="mb-6 h-11" onClick={onRetry}>
            <RefreshCw /> Show a new code
          </Button>
        </>
      )}
      {onCancel && state.s !== 'approved' && (
        <Button variant="ghost" className="h-11" onClick={onCancel}>
          Not now
        </Button>
      )}
    </div>
  )
}
