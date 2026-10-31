// "Scan to join" for the Discord: most people (students on a school Chromebook) have their phone with them, and a QR
// code gets them into the server without typing the invite. The code is drawn here (uqr), never by an outside service.
import { useMemo, type CSSProperties } from 'react'
import { QrCode } from 'lucide-react'
import { encode } from 'uqr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DISCORD_INVITE } from '@/lib/supporter'
import { cn } from '@/lib/utils'

/** A QR code as one SVG path, dark on white (phones read that best in both themes), with the quiet zone it needs. */
export function QrImage({ value, className, label }: { value: string; className?: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 })
    let d = ''
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)))
    return { size: qr.size, path: d }
  }, [value])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={cn('rounded-xl bg-white', className)} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} fill="#0b0c12" />
    </svg>
  )
}

const shortLink = (url: string) => url.replace(/^https?:\/\//, '')

/** The code itself with its caption, for pages that are about the Discord. */
export function DiscordQrCard({ className }: { className?: string }) {
  if (!DISCORD_INVITE) return null
  return (
    <div className={cn('flex items-center gap-4 rounded-2xl bg-shasta-home p-4 ring-1 ring-shasta-line', className)}>
      <QrImage value={DISCORD_INVITE} label="QR code to join the Shasta Discord" className="size-32 shrink-0 p-1" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">Join from your phone</p>
        <p className="mt-1 text-shasta-muted">Point your phone's camera at the code and tap the link that appears.</p>
        <p className="mt-2 truncate font-mono text-xs text-shasta-muted">{shortLink(DISCORD_INVITE)}</p>
      </div>
    </div>
  )
}

/** "Scan with phone" next to every Join the Discord link: opens the code in a popup. */
export function DiscordQrButton({ size = 'default', className, tabIndex, style }: { size?: 'default' | 'lg' | 'sm'; className?: string; tabIndex?: number; style?: CSSProperties }) {
  if (!DISCORD_INVITE) return null
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size={size} className={className} tabIndex={tabIndex} style={style} />}>
        <QrCode /> Scan with phone
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Join the Discord on your phone</DialogTitle>
          <DialogDescription>Open your phone's camera, point it at the code and tap the link that appears.</DialogDescription>
        </DialogHeader>
        <div className="grid justify-items-center gap-3 py-2">
          <QrImage value={DISCORD_INVITE} label="QR code to join the Shasta Discord" className="size-60 p-2 shadow-sm ring-1 ring-shasta-line" />
          <p className="font-mono text-sm text-shasta-muted">{shortLink(DISCORD_INVITE)}</p>
          <a className="text-sm font-medium text-shasta-accent hover:underline" href={DISCORD_INVITE} target="_blank" rel="noreferrer noopener">
            Or open it on this computer
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
