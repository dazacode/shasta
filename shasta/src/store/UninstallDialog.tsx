import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useStore } from './storeStore'

/** Uninstalling touches only this device's library. Saved data of uploaded apps can be wiped too. */
export function UninstallDialog({ app, open, onClose }: { app: { id: string; name: string; kind: 'package' | 'linked' }; open: boolean; onClose: () => void }) {
  const [clear, setClear] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Uninstall {app.name}?</DialogTitle>
          <DialogDescription>It is removed from your library and launcher. It stays in the Store, and other people's libraries are not affected.</DialogDescription>
        </DialogHeader>
        {app.kind === 'package' && (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} className="mt-0.5 accent-[var(--sh-accent)]" />
            <span>Also delete this app's saved data (game saves and settings kept in this browser)</span>
          </label>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await useStore.getState().uninstall(app.id, { clearData: clear })
              setBusy(false)
              setClear(false)
              onClose()
            }}
          >
            {busy && <Loader2 className="sh-spin" />} Uninstall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
