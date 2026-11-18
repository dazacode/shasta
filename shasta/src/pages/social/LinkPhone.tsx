// Social before this computer is linked (and its other states: off on a shared address, loading, paused). The phone
// is the account: one honest invitation with a QR code to scan with the phone (social/linkFlow.ts startShow, the same
// 3-digit check on both screens). The community chat needs none of this, so every screen here points to it.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, Hash, Loader2 } from 'lucide-react'
import { startShow, type ShowHandle, type ShowState } from '@/social/linkFlow'
import { recentStoreAppId } from '@/social/presenceReporter'
import { useSocial } from '@/social/store'
import { LinkQrCard } from '@/components/social'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import type { Go, SectionId } from './common'
import { deviceName, fullSiteAddress, thisDevice } from './social'

/** What each section would hold, said before the QR code. */
const LEAD: Record<Exclude<SectionId, 'chat'>, string> = {
  home: 'See which friends are playing, post to your friends and keep up with messages, here and on your phone.',
  messages: 'Messages with your friends live on your phone and show up here too, so you can answer from either.',
  friends: 'Add friends in person by scanning each other’s code, then see what they’re playing and visit their profiles.',
  you: 'Your profile, in the colours, font and avatar you pick on your phone, plus the devices linked to it.',
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-8 pt-14 pb-16">{children}</div>
}

function ChatInstead({ go }: { go: Go }) {
  return (
    <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-shasta-muted">
      The community chat works without any of this.
      <Button variant="outline" className="h-9 px-3" onClick={() => go('chat')}>
        <Hash /> Open Chat
      </Button>
    </p>
  )
}

export function Loading({ go }: { go: Go }) {
  const error = useSocial((s) => s.error)
  return (
    <Centered>
      {error ? (
        <div role="alert">
          <h1 className="sh-title">Social can't load right now</h1>
          <p className="mt-3 text-shasta-muted">Can't reach Shasta's server, so your friends and messages can't load. Shasta itself still works.</p>
          <Button variant="outline" className="mt-4 h-10 px-4" onClick={() => void useSocial.getState().start()}>
            Try again
          </Button>
          <ChatInstead go={go} />
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-shasta-muted" role="status">
          <Loader2 className="size-4 sh-spin" aria-hidden /> Loading…
        </p>
      )}
    </Centered>
  )
}

export function Unavailable({ go }: { go: Go }) {
  const site = fullSiteAddress()
  return (
    <Centered>
      <h1 className="sh-title">Friends need the full Shasta site</h1>
      <p className="mt-3 leading-relaxed text-shasta-muted">
        This copy of Shasta runs on an address that other people's pages share, so a sign-in kept here could be read by them. Everything else in Shasta works here as usual.
      </p>
      {site && (
        <Button variant="outline" className="mt-4 h-10 px-4" onClick={() => window.open(`${site}/`, '_blank', 'noopener')}>
          <ExternalLink /> Open the full site
        </Button>
      )}
      <ChatInstead go={go} />
    </Centered>
  )
}

export function Suspended({ go }: { go: Go }) {
  const until = useSocial((s) => s.suspendedUntil)
  return (
    <Centered>
      <h1 className="sh-title">Your account is paused</h1>
      <p className="mt-3 leading-relaxed text-shasta-muted">
        Shasta's staff paused it because something broke the rules{until ? `, until ${new Date(until).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}` : ''}. Friends and messages come back after that. Shasta itself still works as usual.
      </p>
      <Button variant="outline" className="mt-4 h-10 px-4" onClick={() => void useSocial.getState().signOut(true)}>
        Sign out this computer
      </Button>
      <ChatInstead go={go} />
    </Centered>
  )
}

/** The show side of linking: one code at a time; a new one only when the person asks (codes are rate limited). */
function useShowFlow() {
  const [state, setState] = useState<ShowState>({ s: 'starting' })
  const [round, setRound] = useState(0)
  const handle = useRef<ShowHandle | null>(null)
  useEffect(() => {
    // the game in front (or the last one used) comes along, so the phone can carry on with it
    const playing = recentStoreAppId(useTabs.getState().tabs)
    const h = startShow({ kind: 'desktop', name: deviceName(), playing }, (s) => {
      setState(s)
      // linked: the token is saved; sign this computer in (the hub then shows friends)
      if (s.s === 'approved') void useSocial.getState().start()
    })
    handle.current = h
    return () => {
      h.cancel()
      handle.current = null
    }
  }, [round])
  return {
    state,
    confirm: () => void handle.current?.confirm().catch(() => useUi.getState().toast('That code ran out. Show a new one and try again.', { tone: 'error' })),
    retry: () => {
      setState({ s: 'starting' })
      setRound((r) => r + 1)
    },
  }
}

export function ContinueOnPhone({ section, go }: { section: Exclude<SectionId, 'chat'>; go: Go }) {
  const { state, confirm, retry } = useShowFlow()
  const open = useTabs.getState().openInternal
  const label = thisDevice()
  return (
    <div className="mx-auto grid w-full max-w-[1120px] items-start gap-x-16 gap-y-10 px-8 pt-12 pb-16 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="max-w-xl">
        <h1 className="sh-display">Continue on your phone</h1>
        <p className="mt-4 text-lg leading-relaxed text-shasta-muted">
          {LEAD[section]} Scan the code with your phone's camera: your phone becomes your Shasta account, and {label} stays linked to it.
        </p>
        <dl className="mt-8 grid gap-x-8 gap-y-5 text-sm leading-relaxed sm:grid-cols-2">
          <div>
            <dt className="font-medium">No password, no email</dt>
            <dd className="mt-0.5 text-shasta-muted">Your phone is the account. Add a passkey or a recovery code on it later so you can't lose it.</dd>
          </div>
          <div>
            <dt className="font-medium">Your Library comes along</dt>
            <dd className="mt-0.5 text-shasta-muted">Library, favourites, settings and the game you're playing, sealed so Shasta's server can't read them.</dd>
          </div>
          <div>
            <dt className="font-medium">Nothing about your browsing</dt>
            <dd className="mt-0.5 text-shasta-muted">No history, tabs, sites, cookies or passwords ever leave {label}.</dd>
          </div>
          <div>
            <dt className="font-medium">Friends in person only</dt>
            <dd className="mt-0.5 text-shasta-muted">You add a friend by scanning each other's code. No search, no strangers. For 13 and up.</dd>
          </div>
        </dl>
        <ChatInstead go={go} />
        <p className="mt-3 text-sm">
          <button type="button" onClick={() => open('privacy')} className="text-shasta-accent hover:underline">
            What Shasta keeps, and for how long
          </button>
        </p>
      </div>
      <div className="grid justify-items-center gap-3 lg:sticky lg:top-8">
        <LinkQrCard state={state} onConfirm={confirm} onRetry={retry} deviceLabel={label} className="w-full" />
        <p className="max-w-xs text-center text-xs text-shasta-muted">Already have an account on your phone? Scan this with Shasta on your phone: Add, then Link a computer.</p>
      </div>
    </div>
  )
}
