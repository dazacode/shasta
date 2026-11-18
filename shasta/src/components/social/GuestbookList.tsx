// A profile's guestbook: notes friends left. Nothing shows to others until the owner approves it; the owner sees the
// pending ones with Approve / Remove. An author can remove their own note.
import { Check, Trash2 } from 'lucide-react'
import type { GuestbookNote } from '@/social/types'
import { ago } from '@/social/format'
import { cn } from '@/lib/utils'
import { SocialAvatar } from './SocialAvatar'
import { StickerImg } from './Stickers'

export interface GuestbookListProps {
  notes: GuestbookNote[]
  /** the person looking is the book's owner */
  ownerView?: boolean
  meId?: string | null
  onApprove?(note: GuestbookNote): void
  onDelete?(note: GuestbookNote): void
  className?: string
}

export function GuestbookList({ notes, ownerView, meId, onApprove, onDelete, className }: GuestbookListProps) {
  const visible = ownerView ? notes : notes.filter((n) => n.status === 'shown')
  if (!visible.length) return <p className={cn('text-sm text-[var(--p-muted,var(--sh-muted))]', className)}>{ownerView ? 'No notes yet. Friends can leave you one here.' : 'No notes yet.'}</p>
  return (
    <ul className={cn('grid gap-2', className)}>
      {visible.map((n) => (
        <li key={n.id} className={cn('flex gap-3 rounded-xl bg-[var(--p-surface,var(--sh-card))] p-3 ring-1 ring-[var(--p-line,var(--sh-line))]', n.status === 'pending' && 'border border-dashed border-[var(--p-accent,var(--sh-accent))] ring-0')}>
          <SocialAvatar avatar={n.author.avatar} size={36} />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">@{n.author.handle}</span> <span className="text-[var(--p-muted,var(--sh-muted))]">{ago(n.createdAt)}</span>
              {n.status === 'pending' && <span className="ml-1 text-[var(--p-accent,var(--sh-accent))]">Waiting for you to approve</span>}
            </p>
            {n.text && <p className="mt-0.5 break-words">{n.text}</p>}
            {n.sticker && <StickerImg id={n.sticker} size={40} className="mt-1" />}
          </div>
          <div className="flex shrink-0 items-start gap-1">
            {ownerView && n.status === 'pending' && onApprove && (
              <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-[var(--p-line,var(--sh-hover))]" onClick={() => onApprove(n)} aria-label={`Show @${n.author.handle}'s note`}>
                <Check className="size-5" />
              </button>
            )}
            {onDelete && (ownerView || n.author.id === meId) && (
              <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-[var(--p-line,var(--sh-hover))]" onClick={() => onDelete(n)} aria-label="Remove this note">
                <Trash2 className="size-5" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
