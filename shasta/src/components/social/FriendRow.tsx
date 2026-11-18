// A friend (or any person card) in a list: avatar, @handle, status or mood, and what they're playing when they share
// it. Presence is only ever a Store app's name (never a site, URL or title), and only when that friend turned it on.
import type { ReactNode } from 'react'
import { Gamepad2 } from 'lucide-react'
import type { Person, Presence } from '@/social/types'
import { MOODS, playingFor } from '@/social/format'
import { cn } from '@/lib/utils'
import { SocialAvatar } from './SocialAvatar'

export interface PresenceLineProps {
  presence: Presence | null | undefined
  className?: string
  /** "now" for tests */
  now?: number
}

/** "Playing Hextris · 20 min" (or nothing). */
export function PresenceLine({ presence, className, now }: PresenceLineProps) {
  if (!presence?.app) return null
  return (
    <p className={cn('flex min-w-0 items-center gap-1.5 text-sm text-shasta-accent', className)}>
      <Gamepad2 className="size-4 shrink-0" aria-hidden />
      <span className="truncate">
        Playing <span className="font-medium">{presence.app.name}</span> · {playingFor(presence.since, now).replace(/^for /, '')}
        {presence.device === 'phone' ? ' · on their phone' : ''}
      </span>
    </p>
  )
}

export interface FriendRowProps {
  person: Person
  presence?: Presence | null
  /** opens their profile; the row becomes a button */
  onOpen?(person: Person): void
  /** buttons on the right (Accept / Decline, Message ...) */
  actions?: ReactNode
  /** a line under the name instead of status/mood (e.g. "Wants to be friends") */
  note?: ReactNode
  className?: string
}

export function FriendRow({ person, presence, onOpen, actions, note, className }: FriendRowProps) {
  const sub = note ?? (person.status ? person.status : person.mood ? `Feeling ${MOODS[person.mood].toLowerCase()}` : null)
  const body = (
    <>
      <SocialAvatar avatar={person.avatar} size={44} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium">@{person.handle}</span>
        {sub && <span className="block truncate text-sm text-shasta-muted">{sub}</span>}
        <PresenceLine presence={presence} />
      </span>
    </>
  )
  return (
    <div className={cn('flex min-h-14 items-center gap-3 py-2', className)}>
      {onOpen ? (
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left sh-press" onClick={() => onOpen(person)} aria-label={`Open @${person.handle}'s profile`}>
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
