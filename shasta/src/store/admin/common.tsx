import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUi } from '@/stores/uiStore'
import { errorMessage } from '../api'
import { cn } from '@/lib/utils'

export const toast = (message: string, tone: 'info' | 'error' | 'success' = 'success') => useUi.getState().toast(message, { tone })

/** Runs a mutation: tracks the busy state, toasts the server's own message on failure, returns whether it worked. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(key)
    try {
      await fn()
      if (success) toast(success)
      return true
    } catch (e) {
      toast(errorMessage(e), 'error')
      return false
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-shasta-home ring-1 ring-shasta-line" />
      ))}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl bg-shasta-home p-4 ring-1 ring-shasta-line', className)}>{children}</div>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-shasta-muted">
      <span className="font-medium text-shasta-fg">{label}</span>
      {children}
      {hint && <span>{hint}</span>}
    </label>
  )
}

export const textarea = 'min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

interface ConfirmProps {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** when set, a reason is collected and must be non-empty */
  reason?: { label: string; required?: boolean; placeholder?: string }
  busy?: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}

/** One dialog for every confirmation, with or without a reason box. */
export function ConfirmDialog({ open, title, body, confirmLabel, destructive, reason, busy, onCancel, onConfirm }: ConfirmProps) {
  const [text, setText] = useState('')
  const [seed, setSeed] = useState(false)
  if (open !== seed) {
    setSeed(open)
    if (open) setText('')
  }
  const blocked = !!reason?.required && !text.trim()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body && <DialogDescription render={<div />}>{body}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!blocked && !busy) onConfirm(text.trim())
          }}
        >
          {reason && (
            <Field label={reason.label + (reason.required ? '' : ' (optional)')}>
              <textarea className={textarea} value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} maxLength={1000} autoFocus />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={blocked || busy}>
              {busy && <Loader2 className="sh-spin" />} {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export const KIND_LABEL = { package: 'Uploaded package', linked: 'Linked web app' } as const

export function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-xl bg-shasta-field px-3 py-3 ring-1 ring-shasta-accent/40">
      <code className="min-w-0 flex-1 break-all font-mono text-lg select-all">{value}</code>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => toast('Copy failed. Select the code and copy it by hand.', 'error'))
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
