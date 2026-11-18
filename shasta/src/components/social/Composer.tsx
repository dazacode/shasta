// The message box. When the server answers a send with a 422 nudge (server/src/social/safety.ts: another app, a phone
// number, an address, a school, age, pictures, meeting up), it opens "Double-check before you share" instead of
// sending; the person can edit, or send anyway (resent with confirmed: true). Never a lecture, never a block.
import { useRef, useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import type { NudgeKind } from '@/social/types'
import { errorText, nudgeOf } from '@/social/api'
import { NUDGE_COPY } from '@/social/format'
import { LIMITS } from '@/social/schemas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Sheet } from './Sheet'

export interface ComposerProps {
  /** sends; throws the ApiError on failure (a 422 nudge opens the double-check sheet) */
  onSend(text: string, confirmed: boolean): Promise<void>
  /** called while typing (the store throttles it to one frame per 3 s) */
  onTyping?(): void
  disabled?: boolean
  /** why it's disabled, shown instead of the box */
  disabledText?: string
  placeholder?: string
  className?: string
}

export function Composer({ onSend, onTyping, disabled, disabledText, placeholder = 'Message', className }: ComposerProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nudge, setNudge] = useState<{ kind: NudgeKind; text: string } | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const send = async (value: string, confirmed: boolean) => {
    setBusy(true)
    setError(null)
    setText('')
    try {
      await onSend(value, confirmed)
      setNudge(null)
    } catch (e) {
      setText(value)
      const kind = nudgeOf(e)
      if (kind && !confirmed) setNudge({ kind, text: value })
      else {
        setNudge(null)
        setError(errorText(e))
      }
    } finally {
      setBusy(false)
    }
  }

  if (disabled && disabledText) return <p className={cn('p-3 text-center text-sm text-shasta-muted', className)}>{disabledText}</p>
  const tooLong = text.length > LIMITS.message
  return (
    <>
      <form
        className={cn('flex items-end gap-2 p-2', className)}
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim() && !tooLong && !busy) void send(text.trim(), false)
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="composer" className="sr-only">Message</label>
          <textarea
            id="composer"
            ref={box}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            enterKeyHint="send"
            onChange={(e) => {
              setText(e.target.value)
              if (e.target.value) onTyping?.()
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`
            }}
            onKeyDown={(e) => {
              // Enter sends on a keyboard; on a phone the send button does (Enter adds a line there)
              if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            className="block max-h-36 min-h-11 w-full resize-none rounded-2xl bg-shasta-field px-4 py-2.5 text-base outline-none placeholder:text-shasta-faint"
          />
          {(error || tooLong) && (
            <p className="px-2 pt-1 text-sm text-shasta-danger" role="alert">
              {tooLong ? `That's ${text.length - LIMITS.message} characters too long.` : error}
            </p>
          )}
        </div>
        <Button type="submit" size="icon" className="size-11 rounded-full" disabled={disabled || busy || !text.trim() || tooLong} aria-label="Send">
          <SendHorizontal className="size-5" />
        </Button>
      </form>
      <Sheet open={!!nudge} onOpenChange={(o) => !o && setNudge(null)} title="Double-check before you share" description={nudge ? NUDGE_COPY[nudge.kind] : undefined}>
        <blockquote className="rounded-xl bg-shasta-field p-3 text-sm whitespace-pre-wrap break-words">{nudge?.text}</blockquote>
        <div className="mt-4 grid gap-2">
          <Button
            className="h-11"
            onClick={() => {
              setNudge(null)
              requestAnimationFrame(() => box.current?.focus())
            }}
          >
            Edit message
          </Button>
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => nudge && void send(nudge.text, true)}>
            Send anyway
          </Button>
        </div>
        <p className="mt-3 text-xs text-shasta-faint">If someone is pressuring you, you can block or report them from their profile. Talking to a trusted adult helps too.</p>
      </Sheet>
    </>
  )
}
