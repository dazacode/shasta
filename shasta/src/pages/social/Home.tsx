// Social's Home (signed in): what is going on, in plain words; friends playing now as game-art cards; the posts from
// you and your friends with the composer on top; and beside it your own card in your colours, requests and friends.
// Nothing is made up: every number is a real count, empty is said plainly with how to fill it.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, UserPlus } from 'lucide-react'
import type { Post } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialKeys, useFeed, useProfile } from '@/social/queries'
import { useSocial } from '@/social/store'
import { Feed, FriendRow, PostComposer, ProfileCard, ReportDialog } from '@/components/social'
import { Button } from '@/components/ui/button'
import { PlayingCard } from './PlayingCard'
import { RequestList, SectionHeader, playingOf, useSortedFriends, type Go } from './common'
import { openStoreApp } from './social'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function HomeSection({ go, onAddFriend }: { go: Go; onAddFriend(): void }) {
  const me = useSocial((s) => s.me)
  const presence = useSocial((s) => s.presence)
  const unread = useSocial((s) => s.unread)
  const requests = useSocial((s) => s.requests)
  const sorted = useSortedFriends()
  const playing = useMemo(() => sorted.flatMap((f) => (playingOf(presence, f) ? [{ f, p: playingOf(presence, f)! }] : [])), [sorted, presence])
  if (!me) return null

  const title = !sorted.length ? 'Add your first friend' : playing.length ? `${plural(playing.length, 'friend is', 'friends are')} playing now` : 'Nobody is playing right now'
  const notes = [unread ? plural(unread, 'unread message', 'unread messages') : null, requests.length ? plural(requests.length, 'friend request', 'friend requests') : null].filter(Boolean)
  const sub = notes.length ? `You have ${notes.join(' and ')}.` : sorted.length ? `${plural(sorted.length, 'friend', 'friends')}. You're all caught up on messages.` : 'Friends are added in person: they scan your code with their phone.'

  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-x-10 gap-y-8 px-8 pt-8 pb-16 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <SectionHeader
          title={title}
          sub={
            notes.length ? (
              <>
                {sub}{' '}
                {unread > 0 && (
                  <button type="button" className="text-shasta-accent hover:underline" onClick={() => go('messages')}>
                    Open messages
                  </button>
                )}
              </>
            ) : (
              sub
            )
          }
        />

        <section aria-labelledby="home-playing" className="mt-8">
          <h2 id="home-playing" className="sh-heading">Playing now</h2>
          {playing.length ? (
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {playing.slice(0, 6).map(({ f, p }, i) => (
                <PlayingCard key={f.id} friend={f} presence={p} index={i} onOpenFriend={() => go('friends', { handle: f.handle })} />
              ))}
            </div>
          ) : (
            <p className="mt-2 max-w-xl text-sm text-shasta-muted">
              When friends choose to share what they're playing, their game shows up here with a button to play it too. Only Store games, never websites.
            </p>
          )}
        </section>

        <section aria-labelledby="home-posts" className="mt-10 max-w-[680px]">
          <h2 id="home-posts" className="sh-heading mb-3">Posts</h2>
          <HomeFeed go={go} />
        </section>
      </div>

      <aside className="grid content-start gap-5" aria-label="You and your friends">
        <MeCard go={go} />
        <RequestList compact />
        <FriendsPeek go={go} onAddFriend={onAddFriend} />
      </aside>
    </div>
  )
}

function HomeFeed({ go }: { go: Go }) {
  const me = useSocial((s) => s.me)
  const qc = useQueryClient()
  const feed = useFeed()
  const [reporting, setReporting] = useState<Post | null>(null)
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data])
  const refreshFeed = () => qc.invalidateQueries({ queryKey: socialKeys.feed })
  return (
    <>
      <Feed
        posts={posts}
        meId={me?.id}
        caughtUp={!feed.hasNextPage}
        loading={feed.isPending}
        loadingMore={feed.isFetchingNextPage}
        error={feed.isError ? errorText(feed.error) : null}
        onLoadMore={() => void feed.fetchNextPage()}
        header={
          <PostComposer
            placeholder="What's new? Only your friends see it."
            onPost={async (text) => {
              try {
                await social.post({ text })
              } catch (e) {
                throw new Error(errorText(e))
              }
              await refreshFeed()
            }}
          />
        }
        onReact={async (p, sticker) => {
          await social.react(p.id, sticker).catch(() => {})
          await refreshFeed()
        }}
        onUnreact={async (p) => {
          await social.unreact(p.id).catch(() => {})
          await refreshFeed()
        }}
        onDelete={async (p) => {
          if (!confirm('Delete this post?')) return
          await social.deletePost(p.id).catch(() => {})
          await refreshFeed()
        }}
        onReport={setReporting}
        onOpenApp={openStoreApp}
        onOpenPerson={(p) => (p.id === me?.id ? go('you') : go('friends', { handle: p.handle }))}
      />
      {reporting && <ReportDialog open onOpenChange={(o) => !o && setReporting(null)} kind="post" targetId={reporting.id} targetLabel="this post" onSubmit={(r) => social.report(r)} />}
    </>
  )
}

/** Your own card, in your own look. Edits happen on the phone (the account lives there). */
function MeCard({ go }: { go: Go }) {
  const me = useSocial((s) => s.me)
  const profile = useProfile(me?.handle ?? null)
  if (!me) return null
  // until the profile is here, a quiet placeholder of the same size (no jump when it lands)
  if (!profile.data) return <div className="h-[212px] rounded-2xl bg-shasta-home ring-1 ring-shasta-line" aria-hidden />
  return (
    <ProfileCard
      size="lg"
      person={profile.data}
      theme={profile.data.theme}
      presence={profile.data.playing}
      onOpen={() => go('you')}
      actions={
        <p className="text-xs text-shasta-muted">
          {me.settings.presence ? 'Friends see the Store game you play.' : "Friends don't see what you play."} Edit your profile on your phone.
        </p>
      }
    />
  )
}

/** A few friends, the ones playing first, and the way to all of them. */
function FriendsPeek({ go, onAddFriend }: { go: Go; onAddFriend(): void }) {
  const sorted = useSortedFriends()
  const presence = useSocial((s) => s.presence)
  return (
    <section aria-labelledby="home-friends" className="rounded-2xl bg-shasta-home p-3 ring-1 ring-shasta-line">
      <div className="flex items-center gap-2 px-1">
        <h2 id="home-friends" className="flex-1 text-sm font-medium">Friends</h2>
        {sorted.length > 0 && (
          <button type="button" className="flex h-8 items-center gap-0.5 rounded-lg px-2 text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg" onClick={() => go('friends')}>
            See all <ChevronRight className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {sorted.length ? (
        <div className="mt-1">
          {sorted.slice(0, 6).map((f) => (
            <FriendRow key={f.id} person={f} presence={playingOf(presence, f)} onOpen={(p) => go('friends', { handle: p.handle })} className="rounded-xl px-1 hover:bg-shasta-hover" />
          ))}
        </div>
      ) : (
        <p className="px-1 pt-1 pb-2 text-sm text-shasta-muted">No friends yet. Show your code to a friend who's with you, and they scan it with their phone.</p>
      )}
      <Button variant="outline" className="mt-2 h-9 w-full" onClick={onAddFriend}>
        <UserPlus /> Add a friend
      </Button>
    </section>
  )
}
