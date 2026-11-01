import { useState } from 'react'
import { Check, Copy, Download, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUi } from '@/stores/uiStore'
import { useStore } from './storeStore'

/** Shown once, right after a recovery key is created. The server keeps only a hash, so this is the only copy. */
export function RecoveryKeyDialog() {
  const key = useStore((s) => s.pendingRecoveryKey)
  const dismiss = useStore((s) => s.dismissRecoveryKey)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(key!)
      setCopied(true)
      setSaved(true)
    } catch {
      useUi.getState().toast('Copying was blocked. Select the key and copy it by hand.', { tone: 'error' })
    }
  }
  const download = () => {
    const blob = new Blob([`Shasta Store staff recovery key\n\n${key}\n\nEnter this under Store > Account > "Restore staff access" on any device to get your staff access back.\nAnyone with this key can act as you in the Store. Keep it private.\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'shasta-recovery-key.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setSaved(true)
  }
  const close = () => {
    dismiss()
    setCopied(false)
    setSaved(false)
  }

  return (
    <Dialog open={!!key} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-4 text-shasta-faint" /> Save your recovery key</DialogTitle>
          <DialogDescription>
            This is for Store staff access only (your library and settings do not use it). If you sign in on another device, or clear this browser's data, this key gets your staff access back. It is shown only once.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-xl bg-shasta-field px-4 py-3 text-center font-mono text-base tracking-wider break-all select-all" data-testid="recovery-key">{key}</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={copy}>{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}</Button>
          <Button variant="secondary" className="flex-1" onClick={download}><Download /> Download</Button>
        </div>
        <p className="text-xs text-shasta-muted">Anyone who has this key can use your account, so keep it private. You can create a new key at any time under Account; that stops the old one working.</p>
        <DialogFooter>
          <Button onClick={close}>{saved ? "I've saved it" : 'Skip for now'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
