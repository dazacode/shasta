// Pieces the Social hub's sections share (pages/Social.tsx): where to go next, the section header, friend requests,
// the block sheet, friends sorted with the ones playing first, and a friend card painted in that friend's own look.
import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import type { Friend, Person, Presence } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialKeys, useProfile } from '@/social/queries'
import { useSocial } from '@/social/store'
import { ProfileCard, Sheet, SocialAvatar } from '@/components/social'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SectionId = 'home' | 'chat' | 'messages' | 'friends' | 'you'
export const SECTION_IDS: readonly SectionId[] = ['home', 'chat', 'messages', 'friends', 'you']

/** Moves around the hub: a section, plus who to talk to (Messages) or whose profile to show (Friends). */
export interface Go {
  (to: SectionId, opts?: { friendId?: string; handle?: string }): void
}

/** A section's title row: the heading (focused when the person moved here, for keyboards and screen readers), a line
 * under it and the section's actions. */
export function SectionHeader({ title, sub, actions, className, headingRef }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; className?: string; headingRef?: React.Ref<HTMLHeadingElement> }) {
  return (
    <header className={cn('flex flex-wrap items-end gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        <h1 ref={headingRef} tabIndex={-1} className="sh-title text-balance outline-none">{title}</h1>
        {sub && <p className="mt-1 text-shasta-muted">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** What a friend is playing right now: the live value first, then the one the friends list came with. */
export const playingOf = (presence: Record<string, Presence>, f: Friend): Presence | null => presence[f.id] ?? f.playing ?? null

/** Friends with the ones playing on top, then by name. */
export function useSortedFriends() {
  const friends = useSocial((s) => s.friends)
  const presence = useSocial((s) => s.presence)
  return useMemo(() => [...friends].sort((a, b) => Number(!!playingOf(presence, b)) - Number(!!playingOf(presence, a)) || a.handle.localeCompare(b.handle)), [friends, presence])
}

/** Friend requests: accept or "Not now". Someone shows up here only after scanning your code in person. */
export function RequestList({ compact = false }: { compact?: boolean }) {
  const requests = useSocial((s) => s.requests)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!requests.length) return null
  const answer = async (id: string, accept: boolean) => {
    setBusy(id)
    setError(null)
    try {
      if (accept) await social.acceptRequest(id)
      else await social.declineRequest(id)
      await useSocial.getState().refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section aria-label="Friend requests" className={cn('rounded-2xl bg-shasta-home ring-1 ring-shasta-line', compact ? 'p-3' : 'p-4')}>
      <h2 className="px-1 text-sm font-medium">
        {requests.length === 1 ? 'Someone wants to be friends' : `${requests.length} people want to be friends`}
      </h2>
      <ul className="mt-2 grid gap-1">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-xl p-1.5">
            <SocialAvatar avatar={r.from.avatar} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">@{r.from.handle}</span>
              <span className="block truncate text-xs text-shasta-muted">Scanned your code</span>
            </span>
            <Button className="h-9 px-3" disabled={busy === r.id} onClick={() => void answer(r.id, true)}>
              Accept
            </Button>
            <Button variant="ghost" className="h-9 px-2.5" disabled={busy === r.id} onClick={() => void answer(r.id, false)} aria-label={`Decline @${r.from.handle}`}>
              Not now
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="px-1 pt-1 text-sm text-shasta-danger" role="alert">{error}</p>}
    </section>
  )
}

/** A friend in their own colours (their profile look; loaded per friend and cached), with Message. */
export function FriendCard({ friend, presence, go }: { friend: Friend; presence: Presence | null; go: Go }) {
  const profile = useProfile(friend.handle)
  return (
    <ProfileCard
      person={friend}
      theme={profile.data?.theme}
      presence={presence}
      onOpen={(p) => go('friends', { handle: p.handle })}
      actions={
        <Button variant="outline" className="h-9 px-3" onClick={() => go('messages', { friendId: friend.id })}>
          <MessageCircle /> Message
        </Button>
      }
    />
  )
}

export function BlockSheet({ person, open, onOpenChange, onDone }: { person: Person; open: boolean; onOpenChange(o: boolean): void; onDone(): void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Block @${person.handle}?`} description="You won't see each other's profile, posts or what you're playing, and neither of you can message or add the other again. They aren't told.">
      {error && <p className="mb-2 text-sm text-shasta-danger" role="alert">{error}</p>}
      <div className="grid gap-2">
        <Button
          variant="destructive"
          className="h-11"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await social.block(person.id)
              await useSocial.getState().refresh()
              void qc.invalidateQueries({ queryKey: socialKeys.blocks })
              onOpenChange(false)
              onDone()
            } catch (e) {
              setError(errorText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          Block
        </Button>
        <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}
