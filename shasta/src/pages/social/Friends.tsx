// Social's Friends: requests, then every friend as a card in their own look (playing first), and a friend's full
// profile when one is opened. Adding happens in person only: "Add a friend" shows YOUR code for them to scan. No
// search, no suggestions.
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { ArrowLeft, Ban, Flag, MessageCircle, UserMinus, UserPlus } from 'lucide-react'
import { errorText, social } from '@/social/api'
import { socialKeys, useGuestbook, useProfile, type FeedPage } from '@/social/queries'
import { useSocial } from '@/social/store'
import { ProfileView, ReportDialog, Sheet } from '@/components/social'
import { Button } from '@/components/ui/button'
import { useUi } from '@/stores/uiStore'
import { BlockSheet, FriendCard, RequestList, SectionHeader, playingOf, useSortedFriends, type Go } from './common'
import { openStoreApp } from './social'

export function FriendsSection({ handle, go, onAddFriend }: { handle: string | null; go: Go; onAddFriend(): void }) {
  if (handle) return <PersonView key={handle.toLowerCase()} handle={handle} go={go} />
  return <FriendsList go={go} onAddFriend={onAddFriend} />
}

function FriendsList({ go, onAddFriend }: { go: Go; onAddFriend(): void }) {
  const sorted = useSortedFriends()
  const presence = useSocial((s) => s.presence)
  const playing = useMemo(() => sorted.filter((f) => playingOf(presence, f)).length, [sorted, presence])
  return (
    <div className="mx-auto w-full max-w-[1240px] px-8 pt-8 pb-16">
      <SectionHeader
        title="Friends"
        sub={sorted.length ? `${sorted.length} ${sorted.length === 1 ? 'friend' : 'friends'}${playing ? `, ${playing} playing now` : ''}. Added in person, never by search.` : 'Added in person, never by search.'}
        actions={
          <Button className="h-10 px-4" onClick={onAddFriend}>
            <UserPlus /> Add a friend
          </Button>
        }
      />
      <div className="mt-6 max-w-xl">
        <RequestList />
      </div>
      {sorted.length ? (
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {sorted.map((f) => (
            <li key={f.id} className="grid">
              <FriendCard friend={f} presence={playingOf(presence, f)} go={go} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 grid max-w-xl gap-4 rounded-2xl bg-shasta-home p-6 ring-1 ring-shasta-line">
          <p className="sh-heading">No friends yet</p>
          <ol className="grid gap-2 text-sm text-shasta-muted">
            <li><span className="font-medium text-shasta-fg">Be with your friend.</span> Friends are only added in person, so nobody you don't know can add you.</li>
            <li><span className="font-medium text-shasta-fg">Show your code.</span> Open Add a friend; the code changes every minute.</li>
            <li><span className="font-medium text-shasta-fg">They scan it with their phone,</span> and their request shows up here for you to accept.</li>
          </ol>
          <Button className="h-10 justify-self-start px-4" onClick={onAddFriend}>
            <UserPlus /> Add a friend
          </Button>
        </div>
      )}
    </div>
  )
}

function PersonView({ handle, go }: { handle: string; go: Go }) {
  const me = useSocial((s) => s.me)
  const qc = useQueryClient()
  const profile = useProfile(handle)
  const guestbook = useGuestbook(handle)
  const [sheet, setSheet] = useState<'unfriend' | 'block' | 'report' | null>(null)
  const [busy, setBusy] = useState(false)
  const feed = qc.getQueryData<InfiniteData<FeedPage>>(socialKeys.feed)
  const p = profile.data
  const posts = useMemo(() => (p ? (feed?.pages.flatMap((x) => x.posts) ?? []).filter((x) => x.author.id === p.id) : []), [feed, p])

  useEffect(() => {
    if (p?.friend === 'self') go('you')
  }, [p?.friend, go])

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-[860px] px-8 pt-6">
        <Button variant="ghost" className="h-9 px-2.5" onClick={() => go('friends')}>
          <ArrowLeft /> All friends
        </Button>
      </div>
      <div className="mx-auto w-full max-w-[860px] px-8 pt-3 pb-16">
        {profile.isPending && <p className="py-6 text-sm text-shasta-muted">Loading…</p>}
        {profile.isError && <p className="py-6 text-sm text-shasta-muted">{(profile.error as { status?: number }).status === 404 ? 'This profile isn’t available.' : errorText(profile.error)}</p>}
        {p && me && (
          <ProfileView
            className="overflow-hidden rounded-3xl ring-1 ring-shasta-line"
            profile={p}
            meId={me.id}
            guestbook={guestbook.data}
            posts={posts}
            onOpenPerson={(x) => (x.id === me.id ? go('you') : go('friends', { handle: x.handle }))}
            onOpenApp={openStoreApp}
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
                  <Button className="h-10 px-4" onClick={() => go('messages', { friendId: p.id })}>
                    <MessageCircle /> Message
                  </Button>
                  <Button variant="outline" className="h-10 px-3" onClick={() => setSheet('unfriend')} aria-label="Unfriend">
                    <UserMinus />
                  </Button>
                  <Button variant="outline" className="h-10 px-3" onClick={() => setSheet('block')} aria-label="Block">
                    <Ban />
                  </Button>
                  <Button variant="outline" className="h-10 px-3" onClick={() => setSheet('report')} aria-label="Report">
                    <Flag />
                  </Button>
                </>
              )
            }
          />
        )}
      </div>
      {p && (
        <>
          <Sheet open={sheet === 'unfriend'} onOpenChange={(o) => !o && setSheet(null)} title={`Unfriend @${p.handle}?`} description="You stop seeing each other's posts and what you're playing, and you leave each other's crew. To be friends again, scan each other's code.">
            <div className="grid gap-2">
              <Button
                variant="destructive"
                className="h-11"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await social.unfriend(p.id)
                    await useSocial.getState().refresh()
                    setSheet(null)
                    go('friends')
                  } catch (e) {
                    useUi.getState().toast(errorText(e), { tone: 'error' })
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Unfriend
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setSheet(null)}>
                Cancel
              </Button>
            </div>
          </Sheet>
          <BlockSheet person={p} open={sheet === 'block'} onOpenChange={(o) => !o && setSheet(null)} onDone={() => go('friends')} />
          <ReportDialog open={sheet === 'report'} onOpenChange={(o) => !o && setSheet(null)} kind="profile" targetId={p.id} targetLabel={`@${p.handle}`} onSubmit={(r) => social.report(r)} />
        </>
      )}
    </div>
  )
}
