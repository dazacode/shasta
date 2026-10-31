// "Play with your phone": the QR code a phone scans to become a controller (lib/phonePad.ts), the code to type if
// the camera won't scan, and who is connected. Shown on the game splash and in the Controls dialog.
import { Loader2, Smartphone, X } from 'lucide-react'
import { QrImage } from '@/components/DiscordQr'
import { kickPhonePad, startPhonePads, stopPhonePads, usePhonePads } from '@/lib/phonePad'
import { cn } from '@/lib/utils'

export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308']

export function PhonePadCard({ dark = false, className }: { dark?: boolean; className?: string }) {
  const { status, code, link, error, pads } = usePhonePads()
  const on = pads.filter((p) => p.on)
  const muted = dark ? 'text-white/60' : 'text-shasta-muted'
  // nothing is opened until the person asks: no room, no socket
  if (status === 'off') {
    return (
      <button
        onClick={startPhonePads}
        className={cn('flex w-full items-center gap-3 rounded-2xl p-3 text-left text-sm outline-none focus-visible:ring-2', dark ? 'bg-white/10 ring-1 ring-white/10 hover:bg-white/15 focus-visible:ring-white/60' : 'bg-shasta-field ring-1 ring-shasta-line hover:bg-shasta-hover focus-visible:ring-shasta-accent', className)}
      >
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', dark ? 'bg-white/10' : 'bg-shasta-bg')}><Smartphone className="size-5" aria-hidden /></span>
        <span className="min-w-0">
          <span className="block font-medium">Use your phone as a controller</span>
          <span className={cn('block text-xs', muted)}>Scan a code with its camera. No app, no account.</span>
        </span>
      </button>
    )
  }
  return (
    <div className={cn('flex items-center gap-4 rounded-2xl p-3', dark ? 'bg-white/10 ring-1 ring-white/10' : 'bg-shasta-field ring-1 ring-shasta-line', className)}>
      <div className="grid size-32 shrink-0 place-items-center">
        {status === 'open' && link ? (
          <QrImage value={link} label="QR code: scan it with your phone's camera to use it as a controller" className="size-32 p-1" />
        ) : (
          <Loader2 className={cn('sh-spin size-6', muted)} aria-hidden />
        )}
      </div>
      <div className="min-w-0 text-sm" aria-live="polite">
        <p className="flex items-center gap-1.5 font-medium"><Smartphone className="size-4" aria-hidden /> Play with your phone</p>
        {status === 'error' ? (
          <p className="mt-1 text-shasta-warn" role="alert">{error}</p>
        ) : status === 'open' && !link ? (
          <p className={cn('mt-1', muted)}>Open this Shasta on your phone and enter the code.</p>
        ) : (
          <p className={cn('mt-1', muted)}>Point your phone's camera at the code and tap the link. Up to 4 players, one phone each.</p>
        )}
        {code && (
          <p className={cn('mt-2 font-mono text-xs', muted)}>
            Code <span className={cn('select-all text-base font-semibold tracking-[0.2em]', dark ? 'text-white' : 'text-shasta-fg')}>{code}</span>
          </p>
        )}
        {on.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {on.map((p) => (
              <li key={p.slot} className="flex items-center gap-1 rounded-full py-0.5 pl-2 pr-0.5 text-xs font-medium text-white" style={{ background: PLAYER_COLORS[p.slot - 1] }}>
                Player {p.slot}
                <button onClick={() => kickPhonePad(p.slot)} className="grid size-4 place-items-center rounded-full hover:bg-black/20" aria-label={`Disconnect player ${p.slot}'s phone`}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {status === 'open' && (
          <button onClick={stopPhonePads} className={cn('mt-2 text-xs underline-offset-2 hover:underline', muted)}>
            Stop phone controllers
          </button>
        )}
      </div>
    </div>
  )
}
