import { VenetianMask } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { markPrivateExplained } from '@/lib/privateTab'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'

/** Shown the first time someone opens a Private tab. The wording is deliberately plain about the limits. */
export function PrivateTabDialog() {
  const open = useUi((s) => s.privateExplainer)
  const set = useUi((s) => s.setPrivateExplainer)
  return (
    <Dialog open={open} onOpenChange={set}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><VenetianMask className="size-4 text-shasta-accent" /> Private tab</DialogTitle>
          <DialogDescription>What a private tab does, and what it doesn't.</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-2 pl-5 text-sm">
          <li>Shasta does <strong>not</strong> save its history, tab session, site icons, downloads list or bookmarks on this device.</li>
          <li>Websites' cookies and storage are <strong>shared</strong> with your normal tabs and stay after you close it. Logging in here also logs you in there.</li>
          <li>It does <strong>not</strong> hide anything from your network, the proxy server's operator, or the websites you visit.</li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => set(false)}>Cancel</Button>
          <Button
            onClick={() => {
              markPrivateExplained()
              set(false)
              useTabs.getState().newPrivateTab()
              useUi.getState().requestOmniboxFocus()
            }}
          >
            Open private tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
