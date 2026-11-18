// Messages: conversations with friends (mutual friends only, text only), and one conversation. Sends are idempotent
// (clientId), shown at once and confirmed by the server; a 422 nudge opens "Double-check before you share" (Composer).
// The first-ever message shows the receiver a safety card; Report can carry the last messages, previewed first.
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Flag, PenSquare } from 'lucide-react'
import type { Friend, Message } from '@/social/types'
import { errorText, social } from '@/social/api'
import { dropMessage, putMessage, socialKeys, threadMessages, useThread } from '@/social/queries'
import { isTyping, useSocial } from '@/social/store'
import { ago, clientId } from '@/social/format'
import { SocialAvatar } from '@/components/social/SocialAvatar'
import { MessageThread } from '@/components/social/MessageThread'
import { Composer } from '@/components/social/Composer'
import { ReportDialog } from '@/components/social/ReportDialog'
import { Sheet } from '@/components/social/Sheet'
import { FriendRow } from '@/components/social/FriendRow'
import { useNow } from '@/components/social/Countdown'
import { cn } from '@/lib/utils'
import { useNav } from '../nav'
import { BigButton, Screen } from '../ui'
import { openApp } from '../library'

export function MessagesTab() {
  const conversations = useSocial((s) => s.conversations)
  const friends = useSocial((s) => s.friends)
  const push = useNav((s) => s.push)
  const [picking, setPicking] = useState(false)
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-shasta-muted">Conversations</h2>
        <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-shasta-accent hover:bg-shasta-hover" onClick={() => setPicking(true)} disabled={!friends.length}>
          <PenSquare className="size-5" /> New
        </button>
      </div>
      {conversations.length ? (
        <ul className="divide-y divide-shasta-line rounded-2xl bg-shasta-home ring-1 ring-shasta-line">
          {conversations.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left hover:bg-shasta-hover" onClick={() => push({ r: 'thread', friendId: c.with.id })}>
                <SocialAvatar avatar={c.with.avatar} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn('truncate', c.unread ? 'font-semibold' : 'font-medium')}>@{c.with.handle}</span>
                    <span className="ml-auto shrink-0 text-xs text-shasta-faint">{ago(c.lastAt)}</span>
                  </span>
                  <span className={cn('block truncate text-sm', c.unread ? 'text-shasta-fg' : 'text-shasta-muted')}>{c.preview ?? 'No messages yet'}</span>
                </span>
                {c.unread > 0 && (
                  <span className="grid h-6 min-w-6 place-items-center rounded-full bg-shasta-accent px-1.5 text-xs font-medium text-shasta-accent-fg" aria-label={`${c.unread} unread`}>
                    {c.unread > 99 ? '99+' : c.unread}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-shasta-home p-4 text-sm ring-1 ring-shasta-line">{friends.length ? 'No messages yet. Tap New to write to a friend.' : 'You can message friends once you have some. Add one in person from the Add tab.'}</p>
      )}
      <Sheet open={picking} onOpenChange={setPicking} title="Message a friend">
        <div className="divide-y divide-shasta-line">
          {friends.map((f) => (
            <FriendRow
              key={f.id}
              person={f}
              onOpen={() => {
                setPicking(false)
                push({ r: 'thread', friendId: f.id })
              }}
            />
          ))}
        </div>
      </Sheet>
    </div>
  )
}

export function ThreadScreen({ friendId }: { friendId: string }) {
  const me = useSocial((s) => s.me)
  const friends = useSocial((s) => s.friends)
  const conversations = useSocial((s) => s.conversations)
  const typingMap = useSocial((s) => s.typing)
  const push = useNav((s) => s.push)
  const back = useNav((s) => s.back)
  const qc = useQueryClient()
  const now = useNow(1000)
  const conversation = useMemo(() => conversations.find((c) => c.with.id === friendId) ?? null, [conversations, friendId])
  const friend: Friend | undefined = useMemo(() => friends.find((f) => f.id === friendId), [friends, friendId])
  const other = friend ?? conversation?.with
  const thread = useThread(conversation?.id ?? null)
  const messages = useMemo(() => threadMessages(thread.data), [thread.data])
  const [reporting, setReporting] = useState<Message | 'account' | null>(null)
  const [blocking, setBlocking] = useState(false)

  // read up to the newest message while the chat is open
  const newest = messages[messages.length - 1]
  useEffect(() => {
    if (conversation && newest && newest.from !== me?.id && conversation.unread > 0) useSocial.getState().markRead(conversation.id, newest.createdAt)
  }, [conversation, newest, me?.id])

  if (!other || !me)
    return (
      <Screen title="Messages">
        <p className="text-shasta-muted">This conversation isn't available any more.</p>
      </Screen>
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

  const canMessage = !!friend
  return (
    <Screen
      title={
        <button type="button" className="flex min-h-11 items-center gap-2" onClick={() => push({ r: 'person', handle: other.handle })}>
          <SocialAvatar avatar={other.avatar} size={32} /> @{other.handle}
        </button>
      }
      actions={
        <>
          <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-shasta-hover" onClick={() => setReporting('account')} aria-label={`Report @${other.handle}`}>
            <Flag className="size-5" />
          </button>
          <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-shasta-hover" onClick={() => setBlocking(true)} aria-label={`Block @${other.handle}`}>
            <Ban className="size-5" />
          </button>
        </>
      }
      bodyClass="flex min-h-0 flex-col !py-0 !pb-0"
      className="h-dvh"
    >
      {thread.isError && <p className="p-3 text-sm text-shasta-danger">{errorText(thread.error)}</p>}
      <MessageThread
        className="min-h-0 flex-1"
        messages={messages}
        meId={me.id}
        other={other}
        first={conversation?.first}
        typing={isTyping(typingMap, other.id, now)}
        hasOlder={thread.hasNextPage}
        loadingOlder={thread.isFetchingNextPage}
        onLoadOlder={() => void thread.fetchNextPage()}
        onOpenApp={openApp}
        onReportMessage={(m) => setReporting(m)}
        onReport={() => setReporting('account')}
        onBlock={() => setBlocking(true)}
      />
      <div className="border-t border-shasta-line bg-shasta-bg pb-[env(safe-area-inset-bottom)]">
        <Composer onSend={send} onTyping={() => useSocial.getState().sendTyping(other.id)} disabled={!canMessage} disabledText={canMessage ? undefined : `You and @${other.handle} aren't friends any more, so you can't send messages.`} />
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
      <Sheet open={blocking} onOpenChange={setBlocking} title={`Block @${other.handle}?`} description="You won't see each other's profile, posts or what you're playing, and neither of you can message or add the other again. They aren't told.">
        <div className="grid gap-2">
          <BigButton
            variant="danger"
            onClick={async () => {
              await social.block(other.id).catch(() => {})
              setBlocking(false)
              await useSocial.getState().refresh()
              void qc.invalidateQueries({ queryKey: socialKeys.blocks })
              back()
            }}
          >
            Block
          </BigButton>
          <BigButton variant="ghost" onClick={() => setBlocking(false)}>
            Cancel
          </BigButton>
        </div>
      </Sheet>
    </Screen>
  )
}
