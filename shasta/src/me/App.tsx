// The phone app's top level: which screen this phone should see right now. In order: under 13 (remembered on this
// device), social unavailable on this origin, a computer to link (from a scan), loading, paused, signed out, and then
// the four tabs with whatever screen is pushed on top.
import { useEffect, useState } from 'react'
import { CircleUser, House, MessageCircle, UserPlus } from 'lucide-react'
import type { LinkInvite } from '@/social/link'
import { useSocial } from '@/social/store'
import { cn } from '@/lib/utils'
import { onArrival, type Arrival } from './arrival'
import { persistStorage } from './install'
import { useNav, type Route, type Tab } from './nav'
import { HomeTab } from './screens/Home'
import { MessagesTab, ThreadScreen } from './screens/Messages'
import { AddTab, FriendArrival, ScanScreen } from './screens/Add'
import { MeTab, PersonScreen } from './screens/MeTab'
import { EditProfileScreen } from './screens/EditProfile'
import { BackupsScreen, KeepAccount } from './screens/Keep'
import { DeleteScreen, DevicesScreen, LibraryScreen, ParentsScreen, PrivacyScreen } from './screens/Settings'
import { LinkScreen } from './screens/Link'
import { readYoung, Splash, Suspended, Unavailable, Welcome, Young } from './screens/Onboarding'

export function App({ arrival: first }: { arrival: Arrival }) {
  const status = useSocial((s) => s.status)
  const [young, setYoung] = useState(readYoung)
  // a computer to link takes over the whole screen until it's settled; a friend code waits for an account
  const [link, setLink] = useState<{ invite: LinkInvite; via: 'camera' | 'scanner' } | null>(first?.kind === 'link' ? first : null)
  const [friendToken, setFriendToken] = useState<string | null>(first?.kind === 'friend' ? first.token : null)

  useEffect(() => {
    void useSocial.getState().start()
    void persistStorage()
  }, [])
  useEffect(
    () =>
      onArrival((a) => {
        if (a.kind === 'link') setLink(a)
        else setFriendToken(a.token)
      }),
    [],
  )
  // a friend code that arrived from the camera, once there's an account to add the friend to
  useEffect(() => {
    if (friendToken && status === 'ready') {
      useNav.getState().push({ r: 'arrival', arrival: { kind: 'friend', token: friendToken, via: 'camera' } })
      setFriendToken(null)
    }
  }, [friendToken, status])

  if (young) return <Young />
  if (status === 'off') return <Unavailable />
  if (link)
    return (
      <LinkScreen
        key={link.invite.room}
        invite={link.invite}
        via={link.via}
        onYoung={() => setYoung(true)}
        onScanAgain={() => {
          setLink(null)
          if (useSocial.getState().status === 'ready') useNav.getState().push({ r: 'scan', mode: 'link' })
        }}
        onFinish={({ newAccount }) => {
          setLink(null)
          if (newAccount) useNav.getState().push({ r: 'keep' })
        }}
      />
    )
  if (status === 'loading') return <Splash />
  if (status === 'suspended') return <Suspended />
  if (status === 'signed-out')
    return (
      <Welcome
        notice={friendToken ? "Someone's friend code brought you here. Make your account first, then ask them to show their code again (it changes every minute)." : undefined}
        onYoung={() => setYoung(true)}
        onCreated={() => useNav.getState().push({ r: 'keep' })}
      />
    )
  return <Shell />
}

function RouteView({ route }: { route: Route }) {
  const back = useNav((s) => s.back)
  switch (route.r) {
    case 'thread':
      return <ThreadScreen friendId={route.friendId} />
    case 'person':
      return <PersonScreen handle={route.handle} />
    case 'edit':
      return <EditProfileScreen />
    case 'library':
      return <LibraryScreen />
    case 'devices':
      return <DevicesScreen />
    case 'privacy':
      return <PrivacyScreen />
    case 'backups':
      return <BackupsScreen />
    case 'delete':
      return <DeleteScreen />
    case 'parents':
      return <ParentsScreen />
    case 'keep':
      return <KeepAccount />
    case 'scan':
      return <ScanScreen mode={route.mode} />
    case 'arrival':
      return route.arrival.kind === 'friend' ? (
        <FriendArrival token={route.arrival.token} onDone={back} />
      ) : (
        <LinkScreen invite={route.arrival.invite} via={route.arrival.via} onYoung={back} onScanAgain={() => useNav.getState().replace({ r: 'scan', mode: 'link' })} onFinish={back} />
      )
  }
}

const TABS: { id: Tab; label: string; Icon: typeof House }[] = [
  { id: 'home', label: 'Home', Icon: House },
  { id: 'messages', label: 'Messages', Icon: MessageCircle },
  { id: 'add', label: 'Add', Icon: UserPlus },
  { id: 'me', label: 'Me', Icon: CircleUser },
]
const TITLES: Record<Tab, string> = { home: 'Shasta', messages: 'Messages', add: 'Add a friend', me: 'Me' }

function Shell() {
  const tab = useNav((s) => s.tab)
  const stack = useNav((s) => s.stack)
  const setTab = useNav((s) => s.setTab)
  const unread = useSocial((s) => s.unread)
  const requests = useSocial((s) => s.requests.length)
  const live = useSocial((s) => s.live)
  const top = stack[stack.length - 1]
  if (top) return <RouteView route={top} />
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="me-safe-top sticky top-0 z-20 border-b border-shasta-line bg-shasta-bg">
        <div className="me-safe-x flex h-14 items-center">
          <h1 className="flex-1 text-xl font-semibold tracking-tight">{TITLES[tab]}</h1>
          {live === 'reconnecting' && <span className="text-sm text-shasta-faint" role="status">Reconnecting…</span>}
        </div>
      </header>
      <main className="me-safe-x flex-1 pt-4 pb-28">
        {tab === 'home' && <HomeTab />}
        {tab === 'messages' && <MessagesTab />}
        {tab === 'add' && <AddTab />}
        {tab === 'me' && <MeTab />}
      </main>
      <nav className="me-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-shasta-line bg-shasta-bg" aria-label="Sections">
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map(({ id, label, Icon }) => {
            const badge = id === 'messages' ? unread : id === 'home' ? requests : 0
            return (
              <li key={id}>
                <button type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} className={cn('relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-xs', tab === id ? 'text-shasta-accent' : 'text-shasta-muted')}>
                  <Icon className="size-6" aria-hidden />
                  {label}
                  {badge > 0 && (
                    <span className="absolute top-2 left-1/2 ml-2 grid h-5 min-w-5 place-items-center rounded-full bg-shasta-danger px-1 text-[11px] font-medium text-white" aria-label={id === 'messages' ? `${badge} unread` : `${badge} friend requests`}>
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
