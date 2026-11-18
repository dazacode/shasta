// Social's Messages: conversations beside the open one. Mutual friends only, text only; the shared MessageThread and
// Composer bring the first-message card, the "double-check" nudges and report/block. A new conversation starts from
// a friend (here, on their card, or on their profile).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Flag, MessageCircle } from 'lucide-react'
import type { Friend, Message } from '@/social/types'
import { errorText, social } from '@/social/api'
import { dropMessage, putMessage, threadMessages, useThread } from '@/social/queries'
import { isTyping, useSocial } from '@/social/store'
import { ago, clientId } from '@/social/format'
import { Composer, MessageThread, ReportDialog, SocialAvatar, useNow } from '@/components/social'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BlockSheet, useSortedFriends, type Go } from './common'
import { openStoreApp } from './social'

export function MessagesSection({ friendId, go }: { friendId: string | null; go: Go }) {
  const conversations = useSocial((s) => s.conversations)
  const friends = useSortedFriends()
  const list = useMemo(() => [...conversations].sort((a, b) => b.lastAt - a.lastAt), [conversations])
  // friends you haven't written to yet, to start with
  const fresh = useMemo(() => friends.filter((f) => !conversations.some((c) => c.with.id === f.id)), [friends, conversations])
  return (
    <div className="@container flex h-full min-h-0">
      <aside className={cn('min-h-0 w-full flex-col border-r border-shasta-line bg-shasta-tab @3xl:flex @3xl:w-[320px] @3xl:shrink-0', friendId ? 'hidden' : 'flex')} aria-label="Conversations">
        <div className="px-5 pt-6 pb-3">
          <h1 className="sh-title">Messages</h1>
          <p className="mt-1 text-sm text-shasta-muted">Friends only. Kept for 30 days.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          {list.length > 0 && (
            <ul className="grid gap-0.5">
              {list.map((c) => {
                const here = c.with.id === friendId
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => go('messages', { friendId: c.with.id })} aria-current={here ? 'page' : undefined} className={cn('flex min-h-16 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 ease-shasta', here ? 'sh-selected' : 'hover:bg-shasta-hover')}>
                      <SocialAvatar avatar={c.with.avatar} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={cn('truncate', c.unread ? 'font-semibold' : 'font-medium')}>@{c.with.handle}</span>
                          <span className="ml-auto shrink-0 text-xs text-shasta-faint">{ago(c.lastAt)}</span>
                        </span>
                        <span className={cn('block truncate text-sm', c.unread ? 'text-shasta-fg' : 'text-shasta-muted')}>{c.preview ?? 'No messages yet'}</span>
                      </span>
                      {c.unread > 0 && (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-shasta-accent px-1.5 text-xs font-medium text-shasta-accent-fg" aria-label={`${c.unread} unread`}>
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {fresh.length > 0 && (
            <section aria-labelledby="msg-start" className={list.length ? 'mt-5' : ''}>
              <h2 id="msg-start" className="px-2.5 pb-1 text-xs text-shasta-muted">Start a conversation</h2>
              <ul className="grid gap-0.5">
                {fresh.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => go('messages', { friendId: f.id })} aria-current={f.id === friendId ? 'page' : undefined} className={cn('flex h-12 w-full items-center gap-3 rounded-xl px-2.5 text-left text-sm transition-colors duration-150 ease-shasta', f.id === friendId ? 'sh-selected' : 'text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg')}>
                      <SocialAvatar avatar={f.avatar} size={32} />
                      <span className="truncate">@{f.handle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!list.length && !fresh.length && (
            <div className="px-3 pt-2 text-sm text-shasta-muted">
              <p>Messages are between friends. Once you've added a friend in person, you can write to them here.</p>
              <Button variant="outline" className="mt-3 h-9 px-3" onClick={() => go('friends')}>
                Go to Friends
              </Button>
            </div>
          )}
        </div>
      </aside>
      <main className={cn('min-h-0 min-w-0 flex-1 flex-col', friendId ? 'flex' : 'hidden @3xl:flex')}>
        {friendId ? (
          <ChatPane key={friendId} friendId={friendId} go={go} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="grid max-w-sm justify-items-center gap-3">
              <span className="grid size-14 place-items-center rounded-2xl bg-shasta-field text-shasta-muted">
                <MessageCircle className="size-7" aria-hidden />
              </span>
              <p className="sh-heading">{list.length ? 'Pick a conversation' : 'No messages yet'}</p>
              <p className="text-sm text-shasta-muted">
                {list.length ? 'Your messages with friends show up on the left.' : 'Pick a friend on the left to say hi. Messages are text only, and links work only for Store games.'}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function ChatPane({ friendId, go }: { friendId: string; go: Go }) {
  const me = useSocial((s) => s.me)
  const friends = useSocial((s) => s.friends)
  const conversations = useSocial((s) => s.conversations)
  const typingMap = useSocial((s) => s.typing)
  const qc = useQueryClient()
  const now = useNow(1000)
  const conversation = useMemo(() => conversations.find((c) => c.with.id === friendId) ?? null, [conversations, friendId])
  const friend: Friend | undefined = useMemo(() => friends.find((f) => f.id === friendId), [friends, friendId])
  const other = friend ?? conversation?.with
  const thread = useThread(conversation?.id ?? null)
  const messages = useMemo(() => threadMessages(thread.data), [thread.data])
  const [reporting, setReporting] = useState<Message | 'account' | null>(null)
  const [blocking, setBlocking] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus({ preventScroll: true }), [])

  // read up to the newest message while the conversation is open and the window is in front
  const newest = messages[messages.length - 1]
  useEffect(() => {
    if (conversation && newest && newest.from !== me?.id && conversation.unread > 0 && document.visibilityState === 'visible') useSocial.getState().markRead(conversation.id, newest.createdAt)
  }, [conversation, newest, me?.id])

  if (!other || !me)
    return (
      <div className="p-8">
        <p className="text-sm text-shasta-muted">This conversation isn't available any more.</p>
        <Button variant="outline" className="mt-3 h-9 px-3 @3xl:hidden" onClick={() => go('messages')}>
          All messages
        </Button>
      </div>
    )

  const send = async (text: string, confirmed: boolean) => {
    const cid = clientId()
    const local: Message | null = conversation ? { id: `local:${cid}`, clientId: cid, conversationId: conversation.id, from: me.id, text, createdAt: Date.now(), app: null } : null
    if (local) putMessage(qc, local)
    try {
      const m = await social.send({ to: other.id, clientId: cid, text, confirmed: confirmed || undefined })
      if (conversation) putMessage(qc, m)
      else await useSocial.getState().refresh() // a new conversation: its id comes from the server
    } catch (e) {
      if (conversation) dropMessage(qc, conversation.id, cid)
      throw e
    }
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-shasta-line px-4">
        <Button variant="ghost" className="h-9 px-2 @3xl:hidden" onClick={() => go('messages')}>
          All messages
        </Button>
        <h2 ref={heading} tabIndex={-1} className="min-w-0 outline-none">
          <button type="button" className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl pr-3 pl-1 hover:bg-shasta-hover" onClick={() => go('friends', { handle: other.handle })} title={`Open @${other.handle}'s profile`}>
            <SocialAvatar avatar={other.avatar} size={36} />
            <span className="min-w-0 text-left leading-tight">
              <span className="block truncate font-medium">@{other.handle}</span>
              <span className="block truncate text-xs font-normal text-shasta-muted">{isTyping(typingMap, other.id, now) ? 'Typing…' : (other.status ?? 'Friend')}</span>
            </span>
          </button>
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-9" onClick={() => setReporting('account')} aria-label={`Report @${other.handle}`}>
            <Flag className="size-[18px]" />
          </Button>
          <Button variant="ghost" size="icon" className="size-9" onClick={() => setBlocking(true)} aria-label={`Block @${other.handle}`}>
            <Ban className="size-[18px]" />
          </Button>
        </div>
      </header>
      {thread.isError && <p className="px-4 py-2 text-sm text-shasta-danger">{errorText(thread.error)}</p>}
      <MessageThread
        className="mx-auto min-h-0 w-full max-w-3xl flex-1"
        messages={messages}
        meId={me.id}
        other={other}
        first={conversation?.first}
        typing={isTyping(typingMap, other.id, now)}
        hasOlder={thread.hasNextPage}
        loadingOlder={thread.isFetchingNextPage}
        onLoadOlder={() => void thread.fetchNextPage()}
        onOpenApp={openStoreApp}
        onReportMessage={(m) => setReporting(m)}
        onReport={() => setReporting('account')}
        onBlock={() => setBlocking(true)}
      />
      <div className="shrink-0 border-t border-shasta-line">
        <Composer
          className="mx-auto w-full max-w-3xl"
          onSend={send}
          onTyping={() => useSocial.getState().sendTyping(other.id)}
          disabled={!friend}
          disabledText={friend ? undefined : `You and @${other.handle} aren't friends any more, so you can't send messages.`}
        />
      </div>
      {reporting && (
        <ReportDialog
          open
          onOpenChange={(o) => !o && setReporting(null)}
          kind={reporting === 'account' ? 'account' : 'message'}
          targetId={reporting === 'account' ? other.id : reporting.id}
          targetLabel={`@${other.handle}`}
          messages={messages.filter((m) => !m.id.startsWith('local:'))}
          meId={me.id}
          onSubmit={(r) => social.report(r)}
        />
      )}
      <BlockSheet person={other} open={blocking} onOpenChange={setBlocking} onDone={() => go('messages')} />
    </>
  )
}
