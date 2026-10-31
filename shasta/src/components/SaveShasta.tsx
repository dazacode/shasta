// The "Save Shasta" popup (lib/saveShasta.ts). The PHONE leads: school computers often block installing apps (PWA/IWA)
// and get wiped, but the phone is the student's own. Scanning the code opens Shasta there, which first asks them to join
// the Discord (where new addresses are posted when one gets blocked: the one thing that really keeps people with us),
// then shows how to add Shasta to the home screen. Bookmarking and installing on the computer come after.
// One instance, mounted in App; opened from the main menu and What's new.
import { useState, type ReactNode } from 'react'
import { AppWindow, Check, Copy, Download, ExternalLink, MessagesSquare, MoreVertical, Share, Star } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { DISCORD_INVITE } from '@/lib/supporter'
import { trackEvent } from '@/lib/usage'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QrImage } from './DiscordQr'
import { installShasta, phoneAddress, platform, runningInstalled, siteAddress, useSaveShasta } from '@/lib/saveShasta'
import { useUi } from '@/stores/uiStore'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

function Way({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl bg-shasta-home p-3 ring-1 ring-shasta-line">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-shasta-accent/15 text-shasta-accent [&_svg]:size-5">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-shasta-muted">{children}</div>
      </div>
    </div>
  )
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-shasta-field px-2 py-1 font-mono text-xs text-shasta-fg hover:bg-shasta-hover"
      onClick={() => {
        void navigator.clipboard?.writeText(address).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      <span className="truncate">{address.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
      {copied ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
    </button>
  )
}

/** On a phone (opened from the QR code): the steps for this phone's home screen. */
function PhoneSteps({ canInstall }: { canInstall: boolean }) {
  const p = platform()
  if (p === 'ios')
    return (
      <div className="grid gap-2 text-sm">
        <Way icon={<Share />} title="Tap Share">The square with an arrow, at the bottom of Safari (top right in Chrome).</Way>
        <Way icon={<AppWindow />} title="Then “Add to Home Screen”">Scroll down the list if you don't see it, then tap Add.</Way>
      </div>
    )
  if (canInstall)
    return (
      <div className="grid justify-items-center gap-2">
        <Button size="lg" onClick={() => void installShasta()}>
          <Download /> Add Shasta to my home screen
        </Button>
        <p className="text-center text-xs text-shasta-muted">Your phone asks once; then Shasta is an icon like your other apps.</p>
      </div>
    )
  return (
    <div className="grid gap-2 text-sm">
      <Way icon={<MoreVertical />} title="Tap ⋮">The three dots at the top right of Chrome.</Way>
      <Way icon={<AppWindow />} title="Then “Add to Home screen”">Or “Install app”. Then tap Install (or Add).</Way>
    </div>
  )
}

export function SaveShastaHost() {
  const { open, phone, installEvent, installed } = useSaveShasta()
  const close = () => useSaveShasta.setState({ open: false })
  const address = siteAddress()
  const phoneLink = phoneAddress()
  const already = installed || runningInstalled()
  const chromeos = platform() === 'chromeos'
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {phone ? (
          <>
            <DialogHeader>
              <DialogTitle>Keep Shasta on your phone</DialogTitle>
              <DialogDescription>Two quick steps, and you'll always find your way back, even if a school network blocks the address.</DialogDescription>
            </DialogHeader>
            {DISCORD_INVITE && (
              <div className="rounded-xl bg-[#5865f2]/12 p-4 ring-1 ring-[#5865f2]/40">
                <p className="font-medium">1. Join our Discord</p>
                <p className="mt-0.5 text-sm text-shasta-muted">If Shasta ever gets blocked, the new link is posted there first.</p>
                <a className={buttonVariants({ size: 'lg', className: 'mt-3 w-full bg-[#5865f2] text-white hover:bg-[#4752c4]' })} href={DISCORD_INVITE} target="_blank" rel="noreferrer noopener" onClick={() => trackEvent('save.discord')}>
                  <MessagesSquare /> Join the Discord <ExternalLink />
                </a>
              </div>
            )}
            <p className="mt-1 font-medium">{DISCORD_INVITE ? '2. ' : ''}Add Shasta to your home screen</p>
            <PhoneSteps canInstall={!!installEvent} />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Save Shasta so you never lose it</DialogTitle>
              <DialogDescription>School computers get reset and addresses get blocked. Your phone keeps Shasta safe.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {phoneLink && (
                <div className="flex items-center gap-4 rounded-xl bg-shasta-accent/10 p-4 ring-1 ring-shasta-accent/30">
                  <QrImage value={phoneLink} label="QR code to open Shasta on your phone" className="size-32 shrink-0 p-1 ring-1 ring-shasta-line" />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">Scan with your phone</p>
                    <p className="mt-1 text-shasta-muted">
                      Your phone opens Shasta and helps you join our Discord (new links are posted there if this one gets blocked) and add Shasta to your home screen.
                    </p>
                  </div>
                </div>
              )}
              <Way icon={<Star />} title="Bookmark it on this computer">
                Click the <strong className="text-shasta-fg">☆ star</strong> at the right end of your browser's own address bar (the one at the very top of the window). Or
                click that bar and press {isMac ? '⌘D' : 'Ctrl+D'}.
                {address && <CopyAddress address={address} />}
              </Way>
              {already ? (
                <Way icon={<Check />} title="Installed">Shasta is already an app on this device.</Way>
              ) : installEvent ? (
                <Way icon={<Download />} title={chromeos ? 'Add it to your Chromebook launcher' : 'Install it as an app'}>
                  {chromeos ? 'If your school allows it, Shasta shows up in your launcher like any other app.' : 'Shasta gets its own icon (Start menu, Dock or desktop) and its own window.'}
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void installShasta().then((ok) => ok && useUi.getState().toast(chromeos ? 'Shasta is in your launcher now.' : 'Shasta is installed. Look for its icon.'))
                      }
                    >
                      <Download /> Install Shasta
                    </Button>
                  </div>
                </Way>
              ) : null}
              {DISCORD_INVITE && (
                <Way icon={<MessagesSquare />} title="Join the Discord">
                  New addresses are posted there first if this one gets blocked.
                  <div className="mt-2">
                    <a className={buttonVariants({ size: 'sm', variant: 'outline' })} href={DISCORD_INVITE} target="_blank" rel="noreferrer noopener" onClick={() => trackEvent('save.discord')}>
                      <ExternalLink /> Open the Discord
                    </a>
                  </div>
                </Way>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
