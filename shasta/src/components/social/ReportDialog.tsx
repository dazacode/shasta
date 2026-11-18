// Report a message, post, note, profile or account to Shasta's staff. With "include the last messages", the reporter
// sees EXACTLY which messages go with the report before sending (the server copies the last 20 of that conversation).
// The reported person never learns who reported them.
import { useState } from 'react'
import type { Message, ReportKind, ReportReason } from '@/social/types'
import type { ReportInput } from '@/social/api'
import { errorText } from '@/social/api'
import { REPORT_REASONS, clock } from '@/social/format'
import { Button } from '@/components/ui/button'
import { Sheet } from './Sheet'

export interface ReportDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  kind: ReportKind
  targetId: string
  /** "@sam" or "this post" */
  targetLabel: string
  /** the conversation's messages (newest last) when the report can carry them; the last 20 are previewed */
  messages?: Message[]
  /** to label "you" vs them in the preview */
  meId?: string
  onSubmit(report: ReportInput): Promise<unknown>
}

export function ReportDialog(props: ReportDialogProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange} title={`Report ${props.targetLabel}`}>
      {/* a fresh form every time it opens */}
      {props.open && <ReportBody key={props.targetId} {...props} />}
    </Sheet>
  )
}

function ReportBody({ onOpenChange, kind, targetId, targetLabel, messages, meId, onSubmit }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [include, setInclude] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const canInclude = !!messages?.length
  const preview = (messages ?? []).slice(-20)

  const submit = async () => {
    if (!reason) return setError('Pick what is wrong.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ kind, targetId, reason, note: note.trim() || undefined, includeMessages: canInclude ? include : undefined })
      setSent(true)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (sent)
    return (
      <div aria-live="polite">
        <p className="font-medium">Thanks for telling us</p>
        <p className="mt-1 mb-3 text-sm text-shasta-muted">Shasta's staff will look at it. {targetLabel} won't be told who reported.</p>
        {reason === 'self_harm' && (
          <p className="mb-3 rounded-xl bg-shasta-field p-3 text-sm">
            If someone is in danger right now, tell a trusted adult or call your local emergency number. In the US you can call or text 988 any time.
          </p>
        )}
        <Button className="h-11 w-full" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>
    )

  return (
    <>
      <p className="mb-2 text-sm text-shasta-muted">What's wrong?</p>
      <fieldset className="grid gap-1">
        <legend className="sr-only">Reason</legend>
        {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
          <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-shasta-hover">
            <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-5 accent-[var(--sh-accent)]" />
            <span>{REPORT_REASONS[r]}</span>
          </label>
        ))}
      </fieldset>
      <label className="mt-3 block text-sm">
        <span className="text-shasta-muted">Anything else staff should know (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} className="mt-1 w-full rounded-xl bg-shasta-field p-3 text-base outline-none" />
      </label>
      {canInclude && (
        <div className="mt-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="size-5 accent-[var(--sh-accent)]" />
            <span>Include the last messages</span>
          </label>
          {include && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-xl bg-shasta-field p-3 text-sm" aria-label="These messages go with the report">
              <p className="mb-2 text-xs text-shasta-muted">These {preview.length} messages are sent with your report, and only staff read them:</p>
              <ul className="grid gap-1">
                {preview.map((m) => (
                  <li key={m.id} className="break-words">
                    <span className="font-medium">{m.from === meId ? 'You' : targetLabel}</span> <span className="text-shasta-faint">{clock(m.createdAt)}</span>: {m.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-shasta-danger" role="alert">
          {error}
        </p>
      )}
      <Button busy={busy} className="mt-4 h-11 w-full" onClick={() => void submit()} disabled={busy || !reason}>
        Send report
      </Button>
    </>
  )
}
