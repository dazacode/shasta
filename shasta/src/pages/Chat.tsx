import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ChevronDown, CornerUpLeft, FileText, Hash, Loader2, Lock, LogOut, Menu, MessagesSquare, Pencil, ShieldAlert, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ApiError, chatApi, connectChat, loadToken, saveToken, sentIds, type ChatEvent, type ChatLive } from '@/lib/chat'
import { NAME_MAX, NAME_MIN, groupMessages, initials, mergeMessages, nameHue, parseMessage, type ChatInfo, type ChatMessage, type Chatter, type Inline } from '@/lib/chatFormat'
import { APP_API_ORIGIN, MEDIA_CORS } from '@/lib/appApi'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'

/** same-origin /api addresses go to the backend in the installed app */
const media = (url: string) => (APP_API_ORIGIN && url.startsWith('/api/') ? APP_API_ORIGIN + url : url)
const openLink = (href: string) => useTabs.getState().newTab(href)
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
function dayLabel(t: number) {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`)

// ---- message body -----------------------------------------------------------------------------------------------------

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={shown ? undefined : 'Spoiler, click to show'}
      onClick={() => setShown(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setShown(true)
      }}
      className={cn('rounded px-0.5', shown ? 'bg-white/10' : 'cursor-pointer bg-[#1e1f22] text-transparent select-none')}
    >
      {children}
    </span>
  )
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>
          case 'code':
            return <code key={i} className="rounded bg-[#2b2d31] px-1 py-0.5 font-mono text-[0.85em]">{n.v}</code>
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                onClick={(e) => {
                  e.preventDefault()
                  openLink(n.href)
                }}
                className="text-[#00a8fc] underline-offset-2 hover:underline"
              >
                {n.v}
              </a>
            )
          case 'bold':
            return <strong key={i}><InlineView nodes={n.c} /></strong>
          case 'italic':
            return <em key={i}><InlineView nodes={n.c} /></em>
          case 'strike':
            return <s key={i}><InlineView nodes={n.c} /></s>
          case 'spoiler':
            return <Spoiler key={i}><InlineView nodes={n.c} /></Spoiler>
        }
      })}
    </>
  )
}

function MessageBody({ content }: { content: string }) {
  const blocks = useMemo(() => parseMessage(content), [content])
  if (!content) return null
  return (
    <div className="whitespace-pre-wrap break-words">
      {blocks.map((b, i) =>
        b.t === 'codeblock' ? (
          <pre key={i} className="my-1 max-w-full overflow-x-auto rounded border border-[#1e1f22] bg-[#2b2d31] p-2 font-mono text-[0.85em]">{b.v}</pre>
        ) : (
          <div key={i}><InlineView nodes={b.c} /></div>
        ),
      )}
    </div>
  )
}

// The page uses a fixed dark palette with the layout people know from Discord (server rail, channel list, user panel,
// "Message #channel" box), so it feels familiar whatever Shasta theme is on. Colours live here only.
const PALETTE = {
  '--c-rail': '#1e1f22',
  '--c-side': '#2b2d31',
  '--c-main': '#313338',
  '--c-panel': '#232428',
  '--c-hover': '#2e3035',
  '--c-sel': '#404249',
  '--c-input': '#383a40',
  '--c-text': '#dbdee1',
  '--c-muted': '#949ba4',
  '--c-head': '#f2f3f5',
  '--c-accent': '#5865f2',
} as React.CSSProperties

function stamp(t: number) {
  const d = new Date(t)
  const label = dayLabel(t)
  if (label === 'Today' || label === 'Yesterday') return `${label} at ${time(t)}`
  return `${d.toLocaleDateString()} ${time(t)}`
}

function Avatar({ author, size = 40 }: { author: Pick<ChatMessage['author'], 'name' | 'color' | 'avatarUrl'>; size?: number }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size }
  if (author.avatarUrl && !failed)
    return <img src={media(author.avatarUrl)} crossOrigin={MEDIA_CORS} alt="" style={style} className="shrink-0 rounded-full object-cover" onError={() => setFailed(true)} />
  return (
    <div aria-hidden className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ ...style, fontSize: size * 0.38, background: author.color ?? `hsl(${nameHue(author.name)} 55% 50%)` }}>
      {initials(author.name)}
    </div>
  )
}

function Tag({ children, title }: { children: ReactNode; title: string }) {
  return <span title={title} className="translate-y-[-1px] rounded-[3px] bg-[var(--c-accent)] px-1 py-px text-[10px] font-semibold leading-[15px] text-white uppercase">{children}</span>
}

function Attachments({ items }: { items: ChatMessage['attachments'] }) {
  if (!items.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {items.map((a, i) =>
        a.type === 'image' ? (
          <a
            key={i}
            href={media(a.url)}
            onClick={(e) => {
              e.preventDefault()
              openLink(new URL(media(a.url), location.href).href)
            }}
            title={a.name}
          >
            <img
              src={media(a.url)}
              crossOrigin={MEDIA_CORS}
              alt={a.name}
              loading="lazy"
              width={a.width}
              height={a.height}
              className="max-h-80 max-w-[min(100%,26rem)] rounded-lg object-contain"
              style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}`, height: 'auto' } : undefined}
            />
          </a>
        ) : (
          <a key={i} href={media(a.url)} download={a.name} className="flex max-w-sm items-center gap-3 rounded-lg border border-[var(--c-rail)] bg-[var(--c-side)] p-3 hover:border-[#4e5058]">
            <FileText className="size-8 shrink-0 text-[var(--c-muted)]" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-[#00a8fc]">{a.name}</span>
              <span className="text-xs text-[var(--c-muted)]">{fileSize(a.size)}</span>
            </span>
          </a>
        ),
      )}
    </div>
  )
}

function MessageItem({ m, head, onReply, canReply }: { m: ChatMessage; head: boolean; onReply: (m: ChatMessage) => void; canReply: boolean }) {
  const mine = sentIds.has(m.id)
  return (
    <div className={cn('group relative pr-12 pl-[72px] hover:bg-[var(--c-hover)]', head ? 'mt-[17px] min-h-11 py-0.5' : 'py-0.5')}>
      {m.replyTo && (
        <div className="relative mb-1 flex min-w-0 items-center gap-1 text-[13px] text-[var(--c-muted)]">
          <span aria-hidden className="absolute top-1/2 -left-[38px] h-2.5 w-8 rounded-tl-md border-t-2 border-l-2 border-[#4e5058]" />
          <CornerUpLeft className="size-3 shrink-0 sm:hidden" aria-hidden />
          <span className="shrink-0 font-medium text-[var(--c-head)] opacity-80">@{m.replyTo.author}</span>
          <span className="truncate">{m.replyTo.content || 'Click to see attachment'}</span>
        </div>
      )}
      {head ? (
        <>
          <div className="absolute top-0.5 left-4" style={m.replyTo ? { top: 26 } : undefined}>
            <Avatar author={m.author} />
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 leading-[22px]">
            <span className="font-medium text-[var(--c-head)]" style={m.author.color ? { color: m.author.color } : undefined}>{m.author.name}</span>
            {m.author.bot && <Tag title="Bot">bot</Tag>}
            {m.author.web && <Tag title="Sent from Shasta web chat">web</Tag>}
            <time className="ml-1 text-xs text-[var(--c-muted)]" dateTime={new Date(m.createdAt).toISOString()}>{stamp(m.createdAt)}</time>
          </p>
        </>
      ) : (
        <time className="invisible absolute top-1 left-0 w-[64px] text-right text-[11px] leading-[22px] text-[var(--c-muted)] group-hover:visible" dateTime={new Date(m.createdAt).toISOString()}>
          {time(m.createdAt)}
        </time>
      )}
      <div className={cn('text-[15px] leading-[22px] text-[var(--c-text)]', mine && 'text-[var(--c-head)]')}>
        <MessageBody content={m.content} />
        {m.editedAt && <span className="ml-1 text-[10px] text-[var(--c-muted)]">(edited)</span>}
      </div>
      <Attachments items={m.attachments} />
      {canReply && (
        <div className="absolute -top-4 right-4 hidden rounded-md border border-[var(--c-rail)] bg-[var(--c-main)] shadow-md group-focus-within:flex group-hover:flex">
          <Tooltip>
            <TooltipTrigger
              render={
                <button onClick={() => onReply(m)} aria-label={`Reply to ${m.author.name}`} className="grid size-8 place-items-center rounded-md text-[var(--c-muted)] hover:bg-[var(--c-hover)] hover:text-[var(--c-head)]">
                  <CornerUpLeft className="size-5" aria-hidden />
                </button>
              }
            />
            <TooltipContent>Reply</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

// ---- join / rename (a modal, like Discord's) -------------------------------------------------------------------------

function NameDialog({ info, initial, onDone, onClose, rename }: { info: ChatInfo; initial?: string; onDone: (name: string) => Promise<void>; onClose: () => void; rename?: boolean }) {
  const [name, setName] = useState(initial ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  const valid = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError('')
    try {
      await onDone(trimmed)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="absolute inset-0 z-30 grid place-items-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-name-title"
        className="w-full max-w-[440px] overflow-hidden rounded-lg bg-[var(--c-main)] text-[var(--c-text)] shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="p-4 pb-0 text-center">
          <h2 id="chat-name-title" className="text-xl font-bold text-[var(--c-head)]">{rename ? 'Change your chat name' : `Join ${info.server.name}`}</h2>
          {!rename && <p className="mt-1 text-sm text-[var(--c-muted)]">Talk in this Discord server right from Shasta. No Discord account needed.</p>}
        </div>
        <div className="grid gap-3 p-4">
          {!rename && (
            <ul className="grid gap-1.5 rounded-md bg-[var(--c-side)] p-3 text-[13px] leading-snug text-[var(--c-muted)]">
              <li>• Everyone in <strong className="text-[var(--c-text)]">{info.server.name}</strong> can read what you send.</li>
              <li>• So moderators can stop abuse, Shasta keeps a random chat ID on this device and a scrambled code for the network you post from (never your address). If a chat name is banned, no new names can be made from its network for 7 days. None of this is linked to your browsing.</li>
              <li>• Don't share personal info: full name, school, address, phone number, passwords.</li>
              <li>• Automatic moderation checks every message.</li>
            </ul>
          )}
          {!rename && info.rules.trim() && (
            <details className="rounded-md bg-[var(--c-side)] px-3 py-2 text-[13px]">
              <summary className="cursor-pointer font-semibold text-[var(--c-head)]">Server rules</summary>
              <p className="mt-2 whitespace-pre-wrap text-[var(--c-muted)]">{info.rules}</p>
            </details>
          )}
          <label className="grid gap-2">
            <span className={cn('text-xs font-bold uppercase', error ? 'text-[#fa777c]' : 'text-[#b5bac1]')}>
              Chat name{error && <span className="font-medium normal-case italic"> - {error}</span>}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              autoFocus
              className="h-10 rounded-[3px] bg-[var(--c-rail)] px-2.5 text-base text-[var(--c-text)] outline-none focus:ring-2 focus:ring-[#00a8fc]"
            />
            <span className="text-xs text-[var(--c-muted)]">{NAME_MIN}–{NAME_MAX} characters. In Discord it shows as "{trimmed || 'Sam'} (web a1b2)".</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 bg-[var(--c-side)] p-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--c-head)] hover:underline">Cancel</button>
          <button type="submit" disabled={!valid || busy} className="flex items-center gap-2 rounded-[3px] bg-[var(--c-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {rename ? 'Save' : 'Join'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---- page ---------------------------------------------------------------------------------------------------------------

interface ChannelState {
  messages: ChatMessage[]
  loaded: boolean
  hasMore: boolean
  error: string
}
const EMPTY: ChannelState = { messages: [], loaded: false, hasMore: true, error: '' }

/** shasta://chat: read and write in the project's Discord server without a Discord account. */
export default function ChatPage() {
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [infoError, setInfoError] = useState('')
  const [channelId, setChannelId] = useState<string | null>(null)
  const [channels, setChannels] = useState<Record<string, ChannelState>>({})
  const [token, setToken] = useState<string | null>(() => loadToken())
  const [chatter, setChatter] = useState<Chatter | null>(null)
  const [dialog, setDialog] = useState<'join' | 'rename' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const [slowUntil, setSlowUntil] = useState<Record<string, number>>({})
  const [now, setNow] = useState(Date.now())
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const scroller = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const channelRef = useRef<string | null>(null)
  const restore = useRef<number | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const focusAfterJoin = useRef(false)
  // after joining, put the cursor in the message box (it only exists once the dialog is gone)
  useEffect(() => {
    if (!focusAfterJoin.current || dialog || !chatter) return
    focusAfterJoin.current = false
    requestAnimationFrame(() => composer.current?.focus())
  }, [dialog, chatter])
  useLayoutEffect(() => {
    channelRef.current = channelId
  }, [channelId])

  const loadInfo = useCallback(async () => {
    try {
      const i = await chatApi.info()
      setInfo(i)
      setInfoError('')
      setChannelId((cur) => (cur && i.channels.some((c) => c.id === cur) ? cur : (i.channels[0]?.id ?? null)))
    } catch (e) {
      setInfoError(e instanceof ApiError && (e.status === 404 || e.noBackend) ? '' : errText(e))
      if (e instanceof ApiError && (e.status === 404 || e.noBackend)) setInfo({ enabled: false, paused: false, server: { name: '', iconUrl: null }, channels: [], rules: '', maxLength: 2000 })
    }
  }, [])

  const loadLatest = useCallback(async (id: string) => {
    try {
      const { messages } = await chatApi.messages(id)
      setChannels((s) => {
        const cur = s[id] ?? EMPTY
        return { ...s, [id]: { messages: mergeMessages(cur.messages, messages), loaded: true, hasMore: cur.loaded ? cur.hasMore : messages.length >= 50, error: '' } }
      })
    } catch (e) {
      setChannels((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), loaded: true, error: errText(e) } }))
    }
  }, [])

  useEffect(() => {
    void loadInfo()
  }, [loadInfo])

  // not connected (bot reconnecting, server restarting): keep checking instead of giving up
  const unavailable = !!infoError || (!!info && !info.enabled)
  useEffect(() => {
    if (!unavailable) return
    const t = setInterval(() => void loadInfo(), 15_000)
    return () => clearInterval(t)
  }, [unavailable, loadInfo])

  // who am I (the token may have been forgotten by the server)
  useEffect(() => {
    if (!token) {
      setChatter(null)
      return
    }
    let live = true
    chatApi.me(token).then(
      (r) => {
        if (live) setChatter(r.chatter)
      },
      (e) => {
        if (!live) return
        if (e instanceof ApiError && e.unauthorized) {
          saveToken(null)
          setToken(null)
        }
      },
    )
    return () => {
      live = false
    }
  }, [token])

  useEffect(() => {
    if (channelId && !channels[channelId]?.loaded) void loadLatest(channelId)
  }, [channelId, channels, loadLatest])

  // live updates; after a reconnect, catch up on what was missed
  const live = useRef<ChatLive | null>(null)
  const [connected, setConnected] = useState(true)
  const [typers, setTypers] = useState<Record<string, Record<string, number>>>({})
  useEffect(() => {
    if (!info?.enabled) return
    let opened = false
    const onEvent = (e: ChatEvent) => {
      if (e.type === 'info') return void loadInfo()
      if (e.type === 'typing') {
        setTypers((t) => ({ ...t, [e.channelId]: { ...t[e.channelId], [`${e.web ? 'w' : 'd'}:${e.name}`]: e.until } }))
        return
      }
      if (e.type === 'delete') {
        setChannels((s) => (s[e.channelId] ? { ...s, [e.channelId]: { ...s[e.channelId], messages: s[e.channelId].messages.filter((m) => m.id !== e.id) } } : s))
        return
      }
      const m = e.message
      // whoever just sent a message has stopped typing
      if (e.type === 'message') {
        setTypers((t) => {
          const key = `${m.author.web ? 'w' : 'd'}:${m.author.name}`
          if (!t[m.channelId]?.[key]) return t
          const { [key]: _gone, ...rest } = t[m.channelId]
          return { ...t, [m.channelId]: rest }
        })
      }
      setChannels((s) => {
        const cur = s[m.channelId]
        if (!cur) return s
        if (e.type === 'update' && !cur.messages.some((x) => x.id === m.id)) return s
        return { ...s, [m.channelId]: { ...cur, messages: mergeMessages(cur.messages, [m]) } }
      })
      if (e.type === 'message' && m.channelId === channelRef.current && !atBottomRef.current && !sentIds.has(m.id)) setUnseen((n) => n + 1)
    }
    const conn = connectChat(onEvent, (up) => {
      setConnected(up)
      if (up && opened && channelRef.current) void loadLatest(channelRef.current)
      if (up) opened = true
    })
    live.current = conn
    return () => {
      conn.close()
      live.current = null
    }
  }, [info?.enabled, loadInfo, loadLatest])

  // while the live connection is down, still check for new messages every few seconds
  useEffect(() => {
    if (connected || !channelId) return
    const t = setInterval(() => void loadLatest(channelId), 5000)
    return () => clearInterval(t)
  }, [connected, channelId, loadLatest])

  // typing indicators expire on their own
  const typingNow = useMemo(() => {
    const list = Object.entries((channelId && typers[channelId]) || {})
      .filter(([key, until]) => until > now && !(chatter && key === `w:${chatter.name}`))
      .map(([key]) => key.slice(2))
    return list
  }, [typers, channelId, now, chatter])
  useEffect(() => {
    if (!typingNow.length) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [typingNow.length])
  const lastTypingSent = useRef(0)
  const announceTyping = () => {
    if (!token || !channelId || Date.now() - lastTypingSent.current < 5000) return
    lastTypingSent.current = Date.now()
    live.current?.typing(channelId, token)
  }

  // slow mode / time-out countdowns
  const waitingUntil = Math.max(channelId ? (slowUntil[channelId] ?? 0) : 0, chatter?.status === 'timed_out' ? (chatter.timeoutUntil ?? 0) : 0)
  useEffect(() => {
    if (waitingUntil <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waitingUntil])

  const state = (channelId && channels[channelId]) || EMPTY
  const rows = useMemo(() => groupMessages(state.messages), [state.messages])
  const channel = info?.channels.find((c) => c.id === channelId) ?? null

  // stick to the bottom, or keep the reading position when older messages are added above
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current
      restore.current = null
    } else if (atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [rows])

  useEffect(() => {
    atBottomRef.current = true
    setAtBottom(true)
    setUnseen(0)
    setReplyTo(null)
    setSendError('')
    setMenuOpen(false)
  }, [channelId])

  const loadOlder = async () => {
    if (!channelId || loadingOlder || !state.hasMore || !state.messages.length) return
    const el = scroller.current
    setLoadingOlder(true)
    try {
      const { messages } = await chatApi.messages(channelId, state.messages[0].id)
      if (el) restore.current = el.scrollHeight - el.scrollTop
      setChannels((s) => {
        const cur = s[channelId] ?? EMPTY
        return { ...s, [channelId]: { ...cur, messages: mergeMessages(cur.messages, messages), hasMore: messages.length >= 50 } }
      })
    } catch {
      /* try again on the next scroll */
    } finally {
      setLoadingOlder(false)
    }
  }

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    atBottomRef.current = bottom
    setAtBottom(bottom)
    if (bottom) setUnseen(0)
    if (el.scrollTop < 80) void loadOlder()
  }

  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setUnseen(0)
  }

  const join = async (name: string) => {
    const r = await chatApi.join(name)
    saveToken(r.token)
    setToken(r.token)
    setChatter(r.chatter)
    setDialog(null)
    focusAfterJoin.current = true
  }
  const rename = async (name: string) => {
    if (!token) return
    const r = await chatApi.rename(token, name)
    setChatter(r.chatter)
    setDialog(null)
  }
  const leave = async () => {
    if (token) await chatApi.leave(token).catch(() => {})
    saveToken(null)
    setToken(null)
    setChatter(null)
    setDialog(null)
  }

  const maxLength = info?.maxLength ?? 2000
  const waitLeft = Math.max(0, Math.ceil((waitingUntil - now) / 1000))
  const timedOut = chatter?.status === 'timed_out' && (chatter.timeoutUntil ?? 0) > now
  const banned = chatter?.status === 'banned'
  const readOnly = !!channel?.readOnly
  const canPost = !!chatter && !banned && !timedOut && !info?.paused && !!channel && !readOnly
  const tooLong = draft.length > maxLength

  const send = async () => {
    const content = draft.trim()
    if (!token || !channelId || !content || tooLong || sending || waitLeft > 0) return
    setSending(true)
    setSendError('')
    try {
      const { message } = await chatApi.send(token, channelId, content, replyTo?.id)
      setDraft('')
      setReplyTo(null)
      lastTypingSent.current = 0
      atBottomRef.current = true
      setChannels((s) => {
        const cur = s[channelId] ?? EMPTY
        return { ...s, [channelId]: { ...cur, messages: mergeMessages(cur.messages, [message]) } }
      })
      if (channel?.slowmode) setSlowUntil((s) => ({ ...s, [channelId]: Date.now() + channel.slowmode * 1000 }))
    } catch (e) {
      if (e instanceof ApiError) {
        const d = (e.details ?? {}) as { retryAfterMs?: number; until?: number }
        if (e.unauthorized) {
          saveToken(null)
          setToken(null)
        } else if (e.code === 'banned') setChatter((c) => (c ? { ...c, status: 'banned' } : c))
        else if (e.code === 'timed_out' && d.until) setChatter((c) => (c ? { ...c, status: 'timed_out', timeoutUntil: d.until! } : c))
        else if ((e.code === 'slowmode' || e.code === 'rate_limited') && d.retryAfterMs) setSlowUntil((s) => ({ ...s, [channelId]: Date.now() + d.retryAfterMs! }))
        else if (e.code === 'paused') void loadInfo()
      }
      setSendError(errText(e))
    } finally {
      setSending(false)
      setNow(Date.now())
      composer.current?.focus()
    }
  }

  // ---- render -----------------------------------------------------------------------------------------------------------

  if (!info || !info.enabled) {
    return (
      <div style={PALETTE} className="grid h-full place-items-center bg-[var(--c-main)] p-6 text-[var(--c-muted)]" role="status">
        {!info && !infoError ? (
          <Loader2 className="size-6 animate-spin" aria-label="Loading chat" />
        ) : (
          <div className="grid max-w-sm justify-items-center gap-3 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-[var(--c-side)]"><MessagesSquare className="size-7" aria-hidden /></div>
            <p className="text-lg font-semibold text-[var(--c-head)]">{infoError ? 'Chat could not load' : "Chat isn't set up on this Shasta server"}</p>
            <p className="text-sm">{infoError || "Community chat needs the server's Discord bot to be connected. It may be reconnecting right now."}</p>
            <button onClick={() => void loadInfo()} className="rounded-[3px] bg-[var(--c-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4]">Check again</button>
            <p className="text-xs">Shasta checks again on its own every few seconds.</p>
          </div>
        )}
      </div>
    )
  }

  const serverIcon = (size: number) =>
    info.server.iconUrl ? (
      <img src={media(info.server.iconUrl)} crossOrigin={MEDIA_CORS} alt="" style={{ width: size, height: size }} className="rounded-[16px] object-cover" />
    ) : (
      <div aria-hidden style={{ width: size, height: size }} className="grid place-items-center rounded-[16px] bg-[var(--c-accent)] text-sm font-semibold text-white">{initials(info.server.name)}</div>
    )

  const sidebar = (
    <div className="flex h-full min-h-0">
      {/* server rail */}
      <div className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-[var(--c-rail)] pt-3">
        <div className="relative">
          <span aria-hidden className="absolute top-1/2 -left-3 h-10 w-1 -translate-y-1/2 rounded-r bg-white" />
          <Tooltip>
            <TooltipTrigger render={<div tabIndex={0} aria-label={info.server.name}>{serverIcon(48)}</div>} />
            <TooltipContent side="right">{info.server.name}</TooltipContent>
          </Tooltip>
        </div>
        <div aria-hidden className="h-0.5 w-8 rounded bg-[#35363c]" />
      </div>

      {/* channels */}
      <div className="flex w-60 min-w-0 flex-col bg-[var(--c-side)]">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--c-rail)] px-4 shadow-sm">
          <h1 className="truncate font-semibold text-[var(--c-head)]">{info.server.name}</h1>
          <ChevronDown className="size-4 shrink-0 text-[var(--c-head)]" aria-hidden />
        </div>
        <nav aria-label="Channels" className="min-h-0 flex-1 overflow-y-auto px-2 pt-4">
          <p className="mb-1 flex items-center gap-0.5 px-0.5 text-xs font-semibold tracking-wide text-[var(--c-muted)] uppercase">
            <ChevronDown className="size-3" aria-hidden /> Text channels
          </p>
          <div className="grid gap-0.5">
            {info.channels.map((c) => (
              <button
                key={c.id}
                title={c.topic || undefined}
                onClick={() => setChannelId(c.id)}
                aria-current={c.id === channelId ? 'page' : undefined}
                className={cn(
                  'flex h-8 w-full items-center gap-1.5 rounded px-2 text-left text-[15px] font-medium',
                  c.id === channelId ? 'bg-[var(--c-sel)] text-white' : 'text-[var(--c-muted)] hover:bg-[#35373c] hover:text-[var(--c-text)]',
                )}
              >
                <Hash className="size-5 shrink-0 opacity-70" aria-hidden />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            {!info.channels.length && <p className="px-2 py-1 text-sm text-[var(--c-muted)]">No channels yet.</p>}
          </div>
        </nav>

        {/* user panel */}
        <div className="flex h-[52px] shrink-0 items-center gap-2 bg-[var(--c-panel)] px-2">
          {chatter ? (
            <>
              <div className="relative">
                <Avatar author={{ name: chatter.name, color: null, avatarUrl: null }} size={32} />
                <span aria-hidden className={cn('absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[3px] border-[var(--c-panel)]', banned ? 'bg-[#f23f43]' : timedOut ? 'bg-[#f0b232]' : 'bg-[#23a55a]')} />
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold text-[var(--c-head)]">{chatter.name}</p>
                <p className="truncate text-xs text-[var(--c-muted)]">{banned ? 'Blocked' : timedOut ? 'Timed out' : 'Web chat'}</p>
              </div>
              <PanelButton label="Change chat name" onClick={() => setDialog('rename')}><Pencil className="size-[18px]" /></PanelButton>
              <PanelButton label="Leave chat (forget this name)" onClick={() => void leave()}><LogOut className="size-[18px]" /></PanelButton>
            </>
          ) : (
            <button onClick={() => setDialog('join')} className="h-9 w-full rounded-[3px] bg-[var(--c-accent)] text-sm font-medium text-white hover:bg-[#4752c4]">Pick a chat name</button>
          )}
        </div>
      </div>
    </div>
  )

  const noChannel = !channel

  return (
    <div style={PALETTE} className="relative flex h-full min-h-0 bg-[var(--c-main)] text-[var(--c-text)]">
      <aside className="hidden shrink-0 md:block">{sidebar}</aside>
      {menuOpen && (
        <div className="absolute inset-0 z-20 flex md:hidden">
          <aside className="h-full shadow-2xl">{sidebar}</aside>
          <button aria-label="Close channel list" className="flex-1 bg-black/50" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--c-rail)] px-4 shadow-sm">
          <button className="-ml-1 text-[var(--c-muted)] hover:text-[var(--c-head)] md:hidden" aria-label="Channels" onClick={() => setMenuOpen(true)}>
            <Menu className="size-6" aria-hidden />
          </button>
          <Hash className="size-6 shrink-0 text-[var(--c-muted)]" aria-hidden />
          <h2 className="truncate font-semibold text-[var(--c-head)]">{channel?.name ?? info.server.name}</h2>
          {channel?.topic && (
            <>
              <span aria-hidden className="mx-1 hidden h-6 w-px bg-[#3f4147] sm:block" />
              <p className="hidden min-w-0 truncate text-sm text-[var(--c-muted)] sm:block">{channel.topic}</p>
            </>
          )}
        </header>

        <div className="relative min-h-0 flex-1">
          {noChannel ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <div className="grid max-w-sm justify-items-center gap-3">
                <div className="grid size-16 place-items-center rounded-full bg-[var(--c-side)]"><Hash className="size-8 text-[var(--c-muted)]" aria-hidden /></div>
                <p className="text-lg font-semibold text-[var(--c-head)]">Nothing to read yet</p>
                <p className="text-sm text-[var(--c-muted)]">The moderators of {info.server.name} haven't opened any channels to Shasta yet. Check back soon.</p>
              </div>
            </div>
          ) : (
            <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pb-6" role="log" aria-live="polite" aria-label={`Messages in ${channel.name}`}>
              {state.loaded && !state.hasMore && (
                <div className="mx-4 mt-4 mb-2">
                  <div className="mb-2 grid size-[68px] place-items-center rounded-full bg-[#41434a]"><Hash className="size-10 text-white" aria-hidden /></div>
                  <p className="text-[32px] leading-10 font-bold text-[var(--c-head)]">Welcome to #{channel.name}!</p>
                  <p className="text-[var(--c-muted)]">This is the start of the #{channel.name} channel.</p>
                </div>
              )}
              {loadingOlder && <div className="grid place-items-center py-2"><Loader2 className="size-5 animate-spin text-[var(--c-muted)]" aria-label="Loading older messages" /></div>}
              {!state.loaded && <div className="grid h-full place-items-center"><Loader2 className="size-6 animate-spin text-[var(--c-muted)]" aria-label="Loading messages" /></div>}
              {state.error && !state.messages.length && (
                <div className="grid h-full place-items-center text-sm text-[var(--c-muted)]">
                  <div className="grid justify-items-center gap-2">
                    <p>{state.error}</p>
                    <button onClick={() => void loadLatest(channel.id)} className="rounded-[3px] bg-[var(--c-accent)] px-4 py-2 font-medium text-white hover:bg-[#4752c4]">Try again</button>
                  </div>
                </div>
              )}
              {rows.map(({ message, head, newDay }) => (
                <Fragment key={message.id}>
                  {newDay && (
                    <div className="mx-4 mt-6 mb-2 flex items-center text-xs font-semibold text-[var(--c-muted)]" role="separator">
                      <span className="h-px flex-1 bg-[#3f4147]" /><span className="px-1">{dayLabel(message.createdAt)}</span><span className="h-px flex-1 bg-[#3f4147]" />
                    </div>
                  )}
                  <MessageItem
                    m={message}
                    head={head || newDay}
                    canReply={canPost}
                    onReply={(m) => {
                      setReplyTo(m)
                      composer.current?.focus()
                    }}
                  />
                </Fragment>
              ))}
            </div>
          )}
          {!noChannel && !atBottom && (
            <button onClick={toBottom} className="absolute right-4 bottom-2 left-4 flex h-8 items-center justify-between rounded-md bg-[var(--c-accent)] px-3 text-sm font-medium text-white shadow-lg">
              <span>{unseen ? `${unseen} new message${unseen === 1 ? '' : 's'}` : "You're viewing older messages"}</span>
              <span className="flex items-center gap-1">Jump to present <ArrowDown className="size-4" aria-hidden /></span>
            </button>
          )}
        </div>

        {!noChannel && (
          <footer className="relative shrink-0 px-4 pb-6">
            {!canPost && typingNow.length > 0 && (
              <div className="absolute bottom-0.5 left-4 text-xs text-[var(--c-muted)]"><Typing names={typingNow} /></div>
            )}
            {readOnly ? (
              <Notice icon={<Lock className="size-4 shrink-0" aria-hidden />}>You do not have permission to send messages in this channel.</Notice>
            ) : !chatter ? (
              <button onClick={() => setDialog('join')} className="flex h-11 w-full items-center justify-between rounded-lg bg-[var(--c-input)] px-4 text-left text-[var(--c-muted)] hover:text-[var(--c-text)]">
                <span>Message #{channel.name}</span>
                <span className="rounded-[3px] bg-[var(--c-accent)] px-3 py-1 text-sm font-medium text-white">Pick a chat name to talk</span>
              </button>
            ) : banned ? (
              <Notice>You can't post from Shasta anymore: a moderator blocked this chat name. You can still read along.</Notice>
            ) : timedOut ? (
              <Notice>A moderator paused your posting. You can write again in {formatWait(waitLeft)}.</Notice>
            ) : info.paused ? (
              <Notice>Chat from Shasta is paused by the moderators. You can still read along.</Notice>
            ) : (
              <>
                {sendError && <p className="mb-1.5 text-sm text-[#fa777c]" role="alert">{sendError}</p>}
                <div className="overflow-hidden rounded-lg bg-[var(--c-input)]">
                  {replyTo && (
                    <div className="flex h-9 items-center gap-2 bg-[var(--c-side)] px-4 text-sm text-[var(--c-muted)]">
                      <span className="min-w-0 truncate">Replying to <span className="font-semibold text-[var(--c-text)]">{replyTo.author.name}</span></span>
                      <button className="ml-auto grid size-5 place-items-center rounded-full bg-[var(--c-muted)] text-[var(--c-side)] hover:bg-[var(--c-text)]" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                        <X className="size-3.5" strokeWidth={3} aria-hidden />
                      </button>
                    </div>
                  )}
                  <form
                    className="flex items-start"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void send()
                    }}
                  >
                    <textarea
                      ref={composer}
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value)
                        if (sendError) setSendError('')
                        if (e.target.value.trim()) announceTyping()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          void send()
                        }
                        if (e.key === 'Escape' && replyTo) setReplyTo(null)
                      }}
                      rows={Math.min(8, Math.max(1, draft.split('\n').length))}
                      placeholder={waitLeft > 0 ? `Slow mode is on. Wait ${formatWait(waitLeft)}.` : `Message #${channel.name}`}
                      aria-label={`Message #${channel.name}`}
                      aria-invalid={tooLong || undefined}
                      className="max-h-[50vh] min-h-11 flex-1 resize-none bg-transparent px-4 py-[11px] text-[15px] leading-[22px] text-[var(--c-text)] outline-none placeholder:text-[#6d6f78]"
                    />
                    {sending && <Loader2 className="m-3 size-5 shrink-0 animate-spin text-[var(--c-muted)]" aria-label="Sending" />}
                  </form>
                </div>
                <div className="flex h-5 items-center justify-between pt-1 text-xs text-[var(--c-muted)]">
                  <span>{typingNow.length ? <Typing names={typingNow} /> : waitLeft > 0 ? `Slow mode: ${formatWait(waitLeft)}` : channel.slowmode ? `Slow mode is on (${formatWait(channel.slowmode)})` : ''}</span>
                  <span className={cn(tooLong && 'font-semibold text-[#fa777c]')}>{draft.length > maxLength * 0.8 ? maxLength - draft.length : ''}</span>
                </div>
              </>
            )}
          </footer>
        )}
      </section>

      {dialog === 'join' && <NameDialog info={info} onDone={join} onClose={() => setDialog(null)} />}
      {dialog === 'rename' && chatter && <NameDialog info={info} rename initial={chatter.name} onDone={rename} onClose={() => setDialog(null)} />}
    </div>
  )
}

/** Discord's "Alex is typing..." line */
function Typing({ names }: { names: string[] }) {
  const who =
    names.length === 1 ? <><b className="text-[var(--c-text)]">{names[0]}</b> is typing</> :
    names.length === 2 ? <><b className="text-[var(--c-text)]">{names[0]}</b> and <b className="text-[var(--c-text)]">{names[1]}</b> are typing</> :
    names.length === 3 ? <><b className="text-[var(--c-text)]">{names[0]}</b>, <b className="text-[var(--c-text)]">{names[1]}</b> and <b className="text-[var(--c-text)]">{names[2]}</b> are typing</> :
    <>Several people are typing</>
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
      <span aria-hidden className="inline-flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-[var(--c-text)]" style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }} />
        ))}
      </span>
      <span className="truncate">{who}…</span>
    </span>
  )
}

function PanelButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button onClick={onClick} aria-label={label} className="grid size-8 place-items-center rounded text-[#b5bac1] hover:bg-[#3d3e45] hover:text-[var(--c-head)]">
            {children}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Notice({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <p className="flex min-h-11 items-center gap-2 rounded-lg bg-[var(--c-input)] px-4 py-2 text-sm text-[var(--c-muted)]" role="status">
      {icon ?? <ShieldAlert className="size-4 shrink-0" aria-hidden />} {children}
    </p>
  )
}

function formatWait(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.ceil(s / 60)} min`
  if (s < 86_400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86_400)} days`
}
