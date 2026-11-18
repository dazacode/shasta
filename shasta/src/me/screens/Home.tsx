// Home: friend requests, friends (what they're playing first, when they share it), and the friends-only feed with
// its composer. Nothing made up: an empty list says so and how to fill it.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Person, Post } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialKeys, useFeed } from '@/social/queries'
import { useSocial } from '@/social/store'
import { FriendRow } from '@/components/social/FriendRow'
import { Feed, PostComposer } from '@/components/social/Feed'
import { ReportDialog } from '@/components/social/ReportDialog'
import { Button } from '@/components/ui/button'
import { useNav } from '../nav'
import { openApp } from '../library'

export function HomeTab() {
  const me = useSocial((s) => s.me)
  const friends = useSocial((s) => s.friends)
  const requests = useSocial((s) => s.requests)
  const presence = useSocial((s) => s.presence)
  const push = useNav((s) => s.push)
  const setTab = useNav((s) => s.setTab)
  const qc = useQueryClient()
  const feed = useFeed()
  const [reporting, setReporting] = useState<Post | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sorted = useMemo(() => [...friends].sort((a, b) => Number(!!presence[b.id]) - Number(!!presence[a.id]) || a.handle.localeCompare(b.handle)), [friends, presence])
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data])
  const caughtUp = !feed.hasNextPage
  const openPerson = (p: Person) => push({ r: 'person', handle: p.handle })

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
  const refreshFeed = () => qc.invalidateQueries({ queryKey: socialKeys.feed })

  return (
    <div className="grid gap-6">
      {requests.length > 0 && (
        <section aria-label="Friend requests">
          <h2 className="mb-1 text-sm font-medium text-shasta-muted">Wants to be friends</h2>
          <div className="rounded-2xl bg-shasta-home px-3 ring-1 ring-shasta-line">
            {requests.map((r) => (
              <FriendRow
                key={r.id}
                person={r.from}
                note="Scanned your code"
                actions={
                  <>
                    <Button className="h-11 px-4" disabled={busy === r.id} onClick={() => void answer(r.id, true)}>
                      Accept
                    </Button>
                    <Button variant="ghost" className="h-11 px-3" disabled={busy === r.id} onClick={() => void answer(r.id, false)} aria-label={`Decline @${r.from.handle}`}>
                      Not now
                    </Button>
                  </>
                }
              />
            ))}
          </div>
          {error && <p className="mt-2 text-sm text-shasta-danger" role="alert">{error}</p>}
        </section>
      )}

      <section aria-label="Friends">
        <h2 className="mb-1 text-sm font-medium text-shasta-muted">Friends</h2>
        {sorted.length ? (
          <div className="divide-y divide-shasta-line rounded-2xl bg-shasta-home px-3 ring-1 ring-shasta-line">
            {sorted.map((f) => (
              <FriendRow key={f.id} person={f} presence={presence[f.id] ?? f.playing} onOpen={openPerson} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-shasta-home p-4 text-sm ring-1 ring-shasta-line">
            <p>No friends yet. Friends are added in person: open Add, and show your code to a friend who's with you (or scan theirs).</p>
            <Button variant="outline" className="mt-3 h-11 px-4" onClick={() => setTab('add')}>
              Add a friend
            </Button>
          </div>
        )}
      </section>

      <Feed
        posts={posts}
        meId={me?.id}
        caughtUp={caughtUp}
        loading={feed.isPending}
        loadingMore={feed.isFetchingNextPage}
        error={feed.isError ? errorText(feed.error) : null}
        onLoadMore={() => void feed.fetchNextPage()}
        header={
          <PostComposer
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
        onOpenApp={openApp}
        onOpenPerson={openPerson}
      />
      {reporting && <ReportDialog open onOpenChange={(o) => !o && setReporting(null)} kind="post" targetId={reporting.id} targetLabel="this post" onSubmit={(r) => social.report(r)} />}
    </div>
  )
}
