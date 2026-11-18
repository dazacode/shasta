// Me: your profile exactly as friends see it, and everything about the account (library, devices, privacy, backups,
// the parents page, deleting it). Plus a friend's profile (PersonScreen), with Message, Unfriend, Block and Report.
import { useMemo, useState } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Ban, BookOpen, Flag, Gamepad2, HeartHandshake, KeyRound, MessageCircle, Palette, Shield, Smartphone, Trash2, UserMinus } from 'lucide-react'
import type { GuestbookNote } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialKeys, useGuestbook, useProfile, type FeedPage } from '@/social/queries'
import { useSocial } from '@/social/store'
import { ProfileView } from '@/components/social/ProfileView'
import { ReportDialog } from '@/components/social/ReportDialog'
import { Sheet } from '@/components/social/Sheet'
import { Button } from '@/components/ui/button'
import { useNav } from '../nav'
import { BigButton, Group, Note, Row, Screen, Spinner } from '../ui'
import { openApp } from '../library'

export function MeTab() {
  const me = useSocial((s) => s.me)
  const push = useNav((s) => s.push)
  const qc = useQueryClient()
  const profile = useProfile(me?.handle ?? null)
  const guestbook = useGuestbook(me?.handle ?? null)
  if (!me) return null
  const refreshBook = () => qc.invalidateQueries({ queryKey: socialKeys.guestbook(me.handle) })
  return (
    <div className="-mx-4 -mt-4">
      {me.temporary && (
        <div className="px-4 pt-4">
          <Note tone="warn">
            <p className="font-medium">Your account is temporary</p>
            <p className="mt-1">It lives only on this phone. Add a passkey or save a recovery code so you can't lose it.</p>
            <Button className="mt-3 h-11 px-4" onClick={() => push({ r: 'backups' })}>
              Add a backup
            </Button>
          </Note>
        </div>
      )}
      {profile.data ? (
        <ProfileView
          profile={profile.data}
          meId={me.id}
          guestbook={guestbook.data}
          onOpenPerson={(p) => push({ r: 'person', handle: p.handle })}
          onOpenApp={openApp}
          onApproveNote={async (n: GuestbookNote) => {
            await social.approveNote(n.id).catch(() => {})
            await refreshBook()
          }}
          onDeleteNote={async (n: GuestbookNote) => {
            await social.deleteNote(n.id).catch(() => {})
            await refreshBook()
          }}
          actions={
            <Button className="h-11 px-5" onClick={() => push({ r: 'edit' })}>
              <Palette /> Edit profile
            </Button>
          }
        />
      ) : profile.isError ? (
        <p className="p-4 text-sm text-shasta-danger">{errorText(profile.error)}</p>
      ) : (
        <Spinner label="Loading your profile…" />
      )}
      <div className="px-4 pt-2">
        <Group>
          <Row icon={<Gamepad2 />} label="My games" detail="Play on your Chromebook, or open here" onClick={() => push({ r: 'library' })} />
          <Row icon={<Smartphone />} label="Devices" detail="This phone and linked computers" onClick={() => push({ r: 'devices' })} />
          <Row icon={<Shield />} label="Privacy" detail="What friends see, quiet hours, blocked people" onClick={() => push({ r: 'privacy' })} />
          <Row icon={<KeyRound />} label="Backups" detail={me.temporary ? 'None yet: your account is temporary' : 'Passkeys and recovery code'} onClick={() => push({ r: 'backups' })} />
        </Group>
        <Group>
          <Row icon={<HeartHandshake />} label="For parents and guardians" onClick={() => push({ r: 'parents' })} />
          <Row icon={<BookOpen />} label="Open Shasta" detail="The full browser, on this phone" onClick={() => window.open('/', '_blank', 'noopener')} />
          <Row icon={<Trash2 />} label="Delete account" danger onClick={() => push({ r: 'delete' })} />
        </Group>
      </div>
    </div>
  )
}

export function PersonScreen({ handle }: { handle: string }) {
  const me = useSocial((s) => s.me)
  const push = useNav((s) => s.push)
  const back = useNav((s) => s.back)
  const qc = useQueryClient()
  const profile = useProfile(handle)
  const guestbook = useGuestbook(handle)
  const [sheet, setSheet] = useState<'unfriend' | 'block' | 'report' | null>(null)
  const [busy, setBusy] = useState(false)
  const feed = qc.getQueryData<InfiniteData<FeedPage>>(socialKeys.feed)
  const p = profile.data
  const posts = useMemo(() => (p ? (feed?.pages.flatMap((x) => x.posts) ?? []).filter((x) => x.author.id === p.id) : []), [feed, p])

  if (p?.friend === 'self') {
    return (
      <Screen title={`@${handle}`}>
        <MeTab />
      </Screen>
    )
  }
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await useSocial.getState().refresh()
      setSheet(null)
      back()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Screen title={`@${handle}`} bodyClass="!px-0 !py-0">
      {profile.isPending && <Spinner label="Loading…" />}
      {profile.isError && <p className="p-4 text-shasta-muted">{(profile.error as { status?: number }).status === 404 ? 'This profile isn’t available.' : errorText(profile.error)}</p>}
      {p && me && (
        <ProfileView
          profile={p}
          meId={me.id}
          guestbook={guestbook.data}
          posts={posts}
          onOpenPerson={(x) => push({ r: 'person', handle: x.handle })}
          onOpenApp={openApp}
          onSignGuestbook={async (note) => {
            try {
              await social.signGuestbook(p.handle, note)
            } catch (e) {
              throw new Error(errorText(e))
            }
            await qc.invalidateQueries({ queryKey: socialKeys.guestbook(p.handle) })
          }}
          onDeleteNote={async (n) => {
            await social.deleteNote(n.id).catch(() => {})
            await qc.invalidateQueries({ queryKey: socialKeys.guestbook(p.handle) })
          }}
          actions={
            p.friend === 'friends' && (
              <>
                <Button className="h-11 px-4" onClick={() => push({ r: 'thread', friendId: p.id })}>
                  <MessageCircle /> Message
                </Button>
                <Button variant="outline" className="h-11 px-3" onClick={() => setSheet('unfriend')} aria-label="Unfriend">
                  <UserMinus />
                </Button>
                <Button variant="outline" className="h-11 px-3" onClick={() => setSheet('block')} aria-label="Block">
                  <Ban />
                </Button>
                <Button variant="outline" className="h-11 px-3" onClick={() => setSheet('report')} aria-label="Report">
                  <Flag />
                </Button>
              </>
            )
          }
        />
      )}
      {p && (
        <>
          <Sheet open={sheet === 'unfriend'} onOpenChange={(o) => !o && setSheet(null)} title={`Unfriend @${p.handle}?`} description="You stop seeing each other's posts and what you're playing, and you leave each other's crew. To be friends again, scan each other's code.">
            <div className="grid gap-2">
              <BigButton variant="danger" disabled={busy} onClick={() => void act(() => social.unfriend(p.id))}>
                Unfriend
              </BigButton>
              <BigButton variant="ghost" onClick={() => setSheet(null)}>
                Cancel
              </BigButton>
            </div>
          </Sheet>
          <Sheet open={sheet === 'block'} onOpenChange={(o) => !o && setSheet(null)} title={`Block @${p.handle}?`} description="You won't see each other's profile, posts or what you're playing, and neither of you can message or add the other again. They aren't told.">
            <div className="grid gap-2">
              <BigButton
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await social.block(p.id)
                    await qc.invalidateQueries({ queryKey: socialKeys.blocks })
                  })
                }
              >
                Block
              </BigButton>
              <BigButton variant="ghost" onClick={() => setSheet(null)}>
                Cancel
              </BigButton>
            </div>
          </Sheet>
          <ReportDialog open={sheet === 'report'} onOpenChange={(o) => !o && setSheet(null)} kind="profile" targetId={p.id} targetLabel={`@${p.handle}`} onSubmit={(r) => social.report(r)} />
        </>
      )}
    </Screen>
  )
}
