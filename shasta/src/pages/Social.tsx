// shasta://social: everything social in Shasta in one place (docs/notes/social-ui.md). A rail of five places and the
// one that is open beside it:
//   Home      what friends are playing, posts, your card, requests (pages/social/Home.tsx)
//   Chat      the community chat bridged to Discord (pages/Chat.tsx): works for everyone, signed in or not, with its own
//             chat name, which is never linked to the social account (docs/notes/discord-chat.md)
//   Messages  conversations with friends (pages/social/Messages.tsx)
//   Friends   friends in their own colours, requests, Add a friend, a friend's profile (pages/social/Friends.tsx)
//   You       your profile, "what I'm playing", devices, sign out (pages/social/You.tsx)
// `#home|chat|messages|friends|you` picks the section; shasta://chat and shasta://friends still work (lib/url.ts).
// The phone is the account (docs/social-plan.md): before this computer is linked, every place but Chat shows the
// "Continue on your phone" code. Social is off on a shared Lite origin; Shasta itself works the same either way.
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Hash, House, MessageCircle, UserRound, Users } from 'lucide-react'
import { useProfile } from '@/social/queries'
import { useSocial } from '@/social/store'
import { SocialAvatar } from '@/components/social'
import { cn } from '@/lib/utils'
import ChatPage from './Chat'
import { AddFriendDialog } from './social/AddFriendDialog'
import { SECTION_IDS, type Go, type SectionId } from './social/common'
import { FriendsSection } from './social/Friends'
import { HomeSection } from './social/Home'
import { ContinueOnPhone, Loading, Suspended, Unavailable } from './social/LinkPhone'
import { MessagesSection } from './social/Messages'
import { SocialQueries } from './social/parts'
import { YouSection } from './social/You'

/** Older section names (the first desktop page had #me and #feed). */
const ALIASES: Record<string, SectionId> = { me: 'you', feed: 'home', posts: 'home' }

function sectionFromHash(hash: string): SectionId {
  const h = hash.toLowerCase().split('/')[0]
  return (SECTION_IDS as readonly string[]).includes(h) ? (h as SectionId) : (ALIASES[h] ?? 'home')
}

interface Place {
  id: SectionId
  label: string
  icon: ComponentType<{ className?: string }>
}
const PLACES: Place[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'chat', label: 'Chat', icon: Hash },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'friends', label: 'Friends', icon: Users },
  { id: 'you', label: 'You', icon: UserRound },
]

type View = { section: SectionId; friendId?: string; handle?: string }

export default function SocialPage({ section = '' }: { section?: string }) {
  // normally started with the window (lib/socialDesktop.ts); harmless to ask again
  useEffect(() => {
    if (useSocial.getState().status === 'loading') void useSocial.getState().start()
  }, [])
  return (
    <SocialQueries>
      <Hub hash={section} />
    </SocialQueries>
  )
}

function Hub({ hash }: { hash: string }) {
  const status = useSocial((s) => s.status)
  const [picked, setPicked] = useState<View | null>(null)
  const [seenHash, setSeenHash] = useState(hash)
  const [adding, setAdding] = useState(false)
  // a deep link (shasta://social#chat) wins over the last click until the link changes again (as Settings does)
  if (hash !== seenHash) {
    setSeenHash(hash)
    setPicked(null)
  }
  const view: View = picked ?? { section: sectionFromHash(hash) }
  const moved = useRef(false)
  const go: Go = useCallback((to, opts) => {
    moved.current = true
    setPicked({ section: to, friendId: opts?.friendId, handle: opts?.handle })
  }, [])

  // keyboard and screen reader users land in what they opened (not on the first paint)
  const main = useRef<HTMLDivElement>(null)
  const viewKey = `${view.section}:${view.friendId ?? ''}:${view.handle ?? ''}`
  useEffect(() => {
    if (!moved.current) return
    requestAnimationFrame(() => main.current?.querySelector<HTMLElement>('h1[tabindex="-1"], h2[tabindex="-1"]')?.focus({ preventScroll: true }))
  }, [viewKey])

  const ready = status === 'ready'
  return (
    <div className="@container h-full min-h-0 text-shasta-fg">
      <div className="flex h-full min-h-0 flex-col @3xl:flex-row">
        <Rail current={view.section} go={go} ready={ready} />
        <div ref={main} className="relative min-h-0 min-w-0 flex-1">
          <Section key={viewKey} view={view} status={status} go={go} onAddFriend={() => setAdding(true)} />
        </div>
      </div>
      {ready && <AddFriendDialog open={adding} onOpenChange={setAdding} />}
    </div>
  )
}

/** One place, faded in. Home, Friends and You scroll as a page; Chat and Messages fill the height and scroll inside. */
function Section({ view, status, go, onAddFriend }: { view: View; status: ReturnType<typeof useSocial.getState>['status']; go: Go; onAddFriend(): void }) {
  const calm = useReducedMotion()
  const full = view.section === 'chat' || (view.section === 'messages' && status === 'ready')
  let body: React.ReactNode
  if (view.section === 'chat') body = <ChatPage />
  else if (status === 'off') body = <Unavailable go={go} />
  else if (status === 'loading') body = <Loading go={go} />
  else if (status === 'suspended') body = <Suspended go={go} />
  else if (status === 'signed-out') body = <ContinueOnPhone section={view.section} go={go} />
  else if (view.section === 'home') body = <HomeSection go={go} onAddFriend={onAddFriend} />
  else if (view.section === 'messages') body = <MessagesSection friendId={view.friendId ?? null} go={go} />
  else if (view.section === 'friends') body = <FriendsSection handle={view.handle ?? null} go={go} onAddFriend={onAddFriend} />
  else body = <YouSection />
  return (
    <motion.div
      initial={calm ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn('absolute inset-0', full ? 'flex flex-col' : 'overflow-y-auto')}
    >
      {body}
    </motion.div>
  )
}

function Rail({ current, go, ready }: { current: SectionId; go: Go; ready: boolean }) {
  const unread = useSocial((s) => s.unread)
  const requests = useSocial((s) => s.requests.length)
  const live = useSocial((s) => s.live)
  const badge = (id: SectionId) => (!ready ? 0 : id === 'messages' ? unread : id === 'friends' ? requests : 0)
  return (
    <nav aria-label="Social" className="flex shrink-0 flex-col border-shasta-line bg-shasta-tab @max-3xl:border-b @3xl:w-[232px] @3xl:border-r">
      <div className="hidden px-5 pt-6 pb-4 @3xl:block">
        <p className="text-xl font-medium tracking-[-0.01em]">Social</p>
        <p className="mt-0.5 text-xs text-shasta-muted">{ready ? (live === 'reconnecting' ? 'Reconnecting…' : 'Friends, messages and chat') : 'Chat, and friends once you link your phone'}</p>
      </div>
      <ul className="flex gap-1 overflow-x-auto px-2 py-2 @3xl:grid @3xl:gap-0.5 @3xl:overflow-visible @3xl:px-3 @3xl:py-0">
        {PLACES.map(({ id, label, icon: Icon }) => {
          const n = badge(id)
          const here = current === id
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => go(id)}
                aria-current={here ? 'page' : undefined}
                className={cn('flex h-10 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors duration-150 ease-shasta', here ? 'sh-selected font-medium' : 'text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg')}
              >
                <Icon className={cn('size-[18px] shrink-0 stroke-[1.75]', here ? 'text-shasta-fg' : 'text-shasta-faint')} />
                <span className="flex-1">{label}</span>
                {n > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-shasta-accent px-1.5 text-xs font-medium text-shasta-accent-fg tabular-nums" aria-label={id === 'messages' ? `${n} unread` : `${n} ${n === 1 ? 'request' : 'requests'}`}>
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-auto hidden p-3 @3xl:block">{ready ? <MeChip current={current === 'you'} go={go} /> : <p className="px-2 pb-2 text-xs leading-relaxed text-shasta-faint">This computer isn't linked to a phone yet.</p>}</div>
    </nav>
  )
}

function MeChip({ current, go }: { current: boolean; go: Go }) {
  const me = useSocial((s) => s.me)
  const profile = useProfile(me?.handle ?? null)
  if (!me) return null
  return (
    <button type="button" onClick={() => go('you')} className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors duration-150 ease-shasta', current ? 'sh-selected' : 'hover:bg-shasta-hover')} aria-label={`You, @${me.handle}`}>
      <SocialAvatar avatar={profile.data?.avatar} size={36} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-medium">@{me.handle}</span>
        <span className="block truncate text-xs text-shasta-muted">{me.settings.presence ? 'Sharing what you play' : 'Not sharing what you play'}</span>
      </span>
    </button>
  )
}
