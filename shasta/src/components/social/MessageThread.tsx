// One conversation, virtualised (@tanstack/react-virtual) so a long chat stays light on a phone. Stays pinned to the
// newest message while you're at the bottom, keeps your place when older ones load above, shows the first-message
// safety card when this is the first time these two people talk, and "typing..." when the friend is.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Ban, Flag, Gamepad2, ShieldCheck } from 'lucide-react'
import type { Message, Person, ShowcaseApp } from '@/social/types'
import { clock } from '@/social/format'
import { cn } from '@/lib/utils'
import { SocialAvatar } from './SocialAvatar'

export interface FirstMessageCardProps {
  person: Person
  onBlock?(): void
  onReport?(): void
  className?: string
}

/** Shown to the person receiving a first-ever message. */
export function FirstMessageCard({ person, onBlock, onReport, className }: FirstMessageCardProps) {
  return (
    <div className={cn('rounded-2xl bg-shasta-field p-4 text-sm', className)} role="note">
      <p className="flex items-center gap-2 font-medium">
        <ShieldCheck className="size-5 text-shasta-accent" aria-hidden /> Your first chat with @{person.handle}
      </p>
      <ul className="mt-2 grid list-disc gap-1 pl-5 text-shasta-muted">
        <li>You added each other in person, by scanning a code.</li>
        <li>If anything feels off, you can block or report them. They won't be told who reported.</li>
        <li>Shasta will never ask for your password or a code in a message.</li>
      </ul>
      {(onBlock || onReport) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onReport && (
            <button type="button" onClick={onReport} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 ring-1 ring-shasta-line hover:bg-shasta-hover">
              <Flag className="size-4" /> Report
            </button>
          )}
          {onBlock && (
            <button type="button" onClick={onBlock} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 ring-1 ring-shasta-line hover:bg-shasta-hover">
              <Ban className="size-4" /> Block @{person.handle}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export interface MessageThreadProps {
  messages: Message[]
  meId: string
  other: Person
  /** this conversation is new: show the safety card at the top (to the receiver) */
  first?: boolean
  typing?: boolean
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?(): void
  onOpenApp?(app: ShowcaseApp): void
  onReportMessage?(m: Message): void
  onBlock?(): void
  onReport?(): void
  className?: string
}

type Row = { k: 'card' } | { k: 'day'; label: string; id: string } | { k: 'msg'; m: Message; mine: boolean; tail: boolean }

const dayOf = (ms: number) => new Date(ms).toDateString()
const dayLabel = (ms: number) => {
  const d = dayOf(ms)
  if (d === dayOf(Date.now())) return 'Today'
  if (d === dayOf(Date.now() - 86_400_000)) return 'Yesterday'
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
const keyOf = (r: Row) => (r.k === 'card' ? 'card' : r.k === 'day' ? r.id : r.m.clientId || r.m.id)

export function MessageThread({ messages, meId, other, first, typing, hasOlder, loadingOlder, onLoadOlder, onOpenApp, onReportMessage, onBlock, onReport, className }: MessageThreadProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    // the receiver sees the card once the first message is theirs to read
    if (first && !hasOlder && messages.length && messages[0].from !== meId) out.push({ k: 'card' })
    let day = ''
    messages.forEach((m, i) => {
      const d = dayOf(m.createdAt)
      if (d !== day) {
        day = d
        out.push({ k: 'day', label: dayLabel(m.createdAt), id: `day-${d}` })
      }
      const next = messages[i + 1]
      out.push({ k: 'msg', m, mine: m.from === meId, tail: !next || next.from !== m.from || next.createdAt - m.createdAt > 5 * 60_000 })
    })
    return out
  }, [messages, meId, first, hasOlder])

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: (i) => (rows[i]?.k === 'msg' ? 52 : rows[i]?.k === 'card' ? 180 : 36), overscan: 8, getItemKey: (i) => keyOf(rows[i]) })

  // keep the reader's place: pinned to the bottom when they were there, steady when older messages load above
  const atBottom = useRef(true)
  const firstKey = useRef<string | null>(null)
  const lastKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!rows.length) return
    const fk = keyOf(rows[0])
    const lk = keyOf(rows[rows.length - 1])
    if (firstKey.current && fk !== firstKey.current) {
      const i = rows.findIndex((r) => keyOf(r) === firstKey.current)
      if (i > 0) v.scrollToIndex(i, { align: 'start' })
    } else if (lk !== lastKey.current && (atBottom.current || lastKey.current === null)) {
      v.scrollToIndex(rows.length - 1, { align: 'end' })
    }
    firstKey.current = fk
    lastKey.current = lk
  }, [rows, v])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      if (el.scrollTop < 200 && hasOlder && !loadingOlder) onLoadOlder?.()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [hasOlder, loadingOlder, onLoadOlder])

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3" role="log" aria-label={`Messages with @${other.handle}`} aria-live="polite">
        {loadingOlder && <p className="py-2 text-center text-xs text-shasta-faint">Loading earlier messages…</p>}
        {!messages.length && <p className="py-10 text-center text-sm text-shasta-muted">No messages yet. Say hi to @{other.handle}.</p>}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const r = rows[it.index]
            return (
              <div key={it.key} data-index={it.index} ref={v.measureElement} className="absolute inset-x-0" style={{ transform: `translateY(${it.start}px)` }}>
                {r.k === 'card' ? (
                  <FirstMessageCard person={other} onBlock={onBlock} onReport={onReport} className="my-3" />
                ) : r.k === 'day' ? (
                  <p className="py-2 text-center text-xs text-shasta-faint">{r.label}</p>
                ) : (
                  <Bubble m={r.m} mine={r.mine} tail={r.tail} other={other} onOpenApp={onOpenApp} onReport={onReportMessage} />
                )}
              </div>
            )
          })}
        </div>
        {typing && (
          <p className="flex items-center gap-2 py-2 text-sm text-shasta-muted" aria-live="polite">
            <SocialAvatar avatar={other.avatar} size={22} /> @{other.handle} is typing…
          </p>
        )}
      </div>
    </div>
  )
}

function Bubble({ m, mine, tail, other, onOpenApp, onReport }: { m: Message; mine: boolean; tail: boolean; other: Person; onOpenApp?(app: ShowcaseApp): void; onReport?(m: Message): void }) {
  const sending = m.id.startsWith('local:')
  return (
    <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', tail ? 'pb-2' : 'pb-0.5')}>
      {!mine && <span className="w-7 shrink-0">{tail && <SocialAvatar avatar={other.avatar} size={28} />}</span>}
      <div className={cn('group max-w-[78%]', mine && 'items-end text-right')}>
        <div
          className={cn('inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-[15px] leading-snug', mine ? 'bg-shasta-accent text-shasta-accent-fg' : 'bg-shasta-field text-shasta-fg', sending && 'opacity-60')}
          onContextMenu={(e) => {
            if (!mine && onReport) {
              e.preventDefault()
              onReport(m)
            }
          }}
        >
          {m.text}
          {m.app && (
            <button type="button" onClick={() => onOpenApp?.(m.app!)} className={cn('mt-1.5 flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-sm font-medium', mine ? 'bg-black/15' : 'bg-shasta-home')}>
              <Gamepad2 className="size-4" aria-hidden /> {m.app.name}
            </button>
          )}
        </div>
        {tail && (
          <p className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-shasta-faint">
            {sending ? 'Sending…' : clock(m.createdAt)}
            {!mine && onReport && (
              <button type="button" className="min-h-8 underline-offset-2 hover:underline" onClick={() => onReport(m)}>
                Report
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
