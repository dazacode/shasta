import { useEffect } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** The plain-language explanation of what a proxy can see. Shown before first sign-in and always available in Settings → Privacy. */
export function ProxyDisclosureBody() {
  return (
    <div className="grid gap-2 text-sm leading-relaxed">
      <p>Shasta loads websites through a <strong>proxy server</strong>. Everything you do on a site passes through that server on its way to the website.</p>
      <ul className="grid list-disc gap-1.5 pl-5">
        <li>For https sites the connection is encrypted by your browser's transport and the proxy relays it, so the server <strong>should not be able to read page contents or passwords</strong>, but it can see <strong>which sites you connect to</strong>. For http sites nothing is encrypted. Whoever runs this Shasta server also controls the code your browser runs, so only sign in if you trust them.</li>
        <li>Browsing this way is <strong>not the same as visiting the site directly</strong> over HTTPS. Shasta can't show you the site's certificate, so there is no padlock to rely on.</li>
        <li>Private tabs and Shasta's settings do not change this. They do not hide your traffic from the proxy operator, the network or the websites you visit.</li>
        <li>Shasta itself does not read, store or send anywhere your passwords, cookies or sign-in tokens, and it never edits login forms. Sites you sign in to keep their own session cookies in this browser until you clear them.</li>
        <li>Some logins will not work: passkeys and security keys, "Sign in with …" pop-ups, CAPTCHAs and sites that block proxies may all fail. For those, open the original site directly in your browser.</li>
      </ul>
    </div>
  )
}

interface Props {
  open: boolean
  /** first sign-in: the page behind stays unusable until one of the buttons is chosen */
  blocking: boolean
  onContinue: () => void
  onOpenOriginal: () => void
  onGoBack?: () => void
  onClose: () => void
}

export function ProxyDisclosureDialog({ open, blocking, onContinue, onOpenOriginal, onGoBack, onClose }: Props) {
  // a page frame that already has keyboard focus would keep receiving keystrokes behind the dialog
  useEffect(() => {
    if (open && blocking && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [open, blocking])
  return (
    <Dialog open={open} onOpenChange={(o, details) => { if (!o && (!blocking || details?.reason === 'close-press')) onClose() }} disablePointerDismissal={blocking}>
      <DialogContent showCloseButton={!blocking} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="size-4 text-shasta-warn" /> Before you sign in through the proxy</DialogTitle>
          <DialogDescription className="sr-only">How browsing and signing in through Shasta's proxy works</DialogDescription>
        </DialogHeader>
        <ProxyDisclosureBody />
        <DialogFooter>
          {blocking ? (
            <>
              {onGoBack && <Button variant="ghost" onClick={onGoBack}>Go back</Button>}
              <Button variant="outline" onClick={onOpenOriginal}>Open the original site instead</Button>
              <Button onClick={onContinue}>I understand, continue</Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
