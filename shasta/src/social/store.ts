// The live social state shared by the phone app and the desktop (docs/social-protocol.md "Client modules"): who I am,
// my friends and what they're playing, requests, conversations and unread counts. REST fills it on start; the socket
// keeps it current. Lists the screens page through (feed, threads) live in react-query (queries.ts), which hears the
// same events through onSocialEvent.
// React rule: never `useSocial(s => s.list.filter(...))` (a new array each render, React error #185); select the
// array and useMemo.
import { create } from 'zustand'
import type { Conversation, Friend, FriendRequest, Me, Presence, ServerFrame, ShowcaseApp, SocialEvent } from './types'
import { ApiError, social } from './api'
import { loadToken, onTokenChange, saveToken } from './auth'
import { SOCIAL_AVAILABLE } from './origin'
import { openSocialSocket, type SocialSocket, type SocketState } from './socket'

export type SocialStatus = 'off' | 'signed-out' | 'loading' | 'ready' | 'suspended'

export interface SocialState {
  status: SocialStatus
  /** the socket, for a quiet "reconnecting" hint; status stays 'ready' while it is down */
  live: SocketState | 'idle'
  me: Me | null
  friends: Friend[]
  requests: FriendRequest[]
  presence: Record<string, Presence>
  conversations: Conversation[]
  /** total unread messages */
  unread: number
  /** accountId -> until when (ms) they count as typing to me */
  typing: Record<string, number>
  suspendedUntil: number | null
  error: string | null

  start(): Promise<void>
  /** signs this device out locally; `revoke` also ends its session on the server first */
  signOut(revoke?: boolean): Promise<void>
  refresh(): Promise<void>
  setMe(me: Me): void
  sendTyping(to: string): void
  /** desktops only: the Store app in front (null = none); the server ignores it unless presence is on */
  reportPresence(appId: string | null): void
  markRead(conversationId: string, upTo: number): void
}

const TYPING_MS = 5000
const sumUnread = (list: Conversation[]) => list.reduce((n, c) => n + (c.unread || 0), 0)

// ---- events for the paged lists (react-query) and the desktop's launch handler --------------------------------------

type EventListener = (e: SocialEvent) => void
const eventListeners = new Set<EventListener>()
/** Every live event, after the store has applied it. Returns the unsubscribe. */
export function onSocialEvent(fn: EventListener): () => void {
  eventListeners.add(fn)
  return () => eventListeners.delete(fn)
}

type LaunchListener = (app: ShowcaseApp) => void
const launchListeners = new Set<LaunchListener>()
/** "Play on Chromebook" arrived (desktops). Returns the unsubscribe. */
export function onLaunch(fn: LaunchListener): () => void {
  launchListeners.add(fn)
  return () => launchListeners.delete(fn)
}

let sock: SocialSocket | null = null
let lastTyping = new Map<string, number>()
let lastPresence = { at: 0, appId: undefined as string | null | undefined }
let presenceTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribeToken: (() => void) | null = null

const upsertConversation = (list: Conversation[], c: Conversation) => [c, ...list.filter((x) => x.id !== c.id)].sort((a, b) => b.lastAt - a.lastAt)

/** Applies one live event to the state. Pure: exported for tests. */
export function applyEvent(s: Pick<SocialState, 'me' | 'friends' | 'requests' | 'presence' | 'conversations' | 'typing'>, e: SocialEvent): Partial<SocialState> {
  switch (e.type) {
    case 'message': {
      const mine = e.message.from === s.me?.id
      const prev = s.conversations.find((c) => c.id === e.conversation.id)
      const unread = mine ? 0 : Math.max(e.conversation.unread ?? 0, (prev?.unread ?? 0) + 1)
      const conversations = upsertConversation(s.conversations, { ...prev, ...e.conversation, unread: mine ? (prev?.unread ?? 0) : unread })
      const typing = { ...s.typing }
      delete typing[e.message.from]
      return { conversations, unread: sumUnread(conversations), typing }
    }
    case 'message_read': {
      if (e.by !== s.me?.id) return {}
      const conversations = s.conversations.map((c) => (c.id === e.conversationId ? { ...c, unread: 0 } : c))
      return { conversations, unread: sumUnread(conversations) }
    }
    case 'friend_request':
      return { requests: [e.request, ...s.requests.filter((r) => r.id !== e.request.id)] }
    case 'friend_added':
      return {
        friends: [...s.friends.filter((f) => f.id !== e.friend.id), e.friend].sort((a, b) => a.handle.localeCompare(b.handle)),
        requests: s.requests.filter((r) => r.from.id !== e.friend.id),
      }
    case 'friend_removed': {
      const presence = { ...s.presence }
      delete presence[e.accountId]
      return { friends: s.friends.filter((f) => f.id !== e.accountId), presence }
    }
    default:
      return {}
  }
}

export const useSocial = create<SocialState>()((set, get) => {
  const onFrame = (f: ServerFrame) => {
    switch (f.t) {
      case 'ready':
        // a fresh connection: the server may have forgotten this device's presence, so the next report always goes
        lastPresence = { at: lastPresence.at, appId: undefined }
        set({ me: f.me, status: 'ready', suspendedUntil: null })
        break
      case 'presence':
        if ('list' in f) set({ presence: Object.fromEntries(f.list.map((p) => [p.accountId, p])) })
        else {
          const presence = { ...get().presence }
          if (f.p.app) presence[f.p.accountId] = f.p as Presence
          else delete presence[f.p.accountId]
          set({ presence })
        }
        break
      case 'typing':
        set({ typing: { ...get().typing, [f.from]: Date.now() + TYPING_MS } })
        break
      case 'launch':
        launchListeners.forEach((fn) => fn(f.app))
        break
      case 'ev': {
        const e = f.e
        if (e.type === 'account_deleted') {
          void get().signOut()
          return
        }
        if (e.type === 'moderation' && e.action === 'suspended') set({ status: 'suspended', suspendedUntil: e.until ?? null })
        set(applyEvent(get(), e))
        eventListeners.forEach((fn) => fn(e))
        break
      }
    }
  }

  const onState = (s: SocketState) => {
    set({ live: s })
    if (s === 'signed-out') void get().signOut()
    if (s === 'suspended') set({ status: 'suspended' })
  }

  return {
    status: SOCIAL_AVAILABLE ? 'loading' : 'off',
    live: 'idle',
    me: null,
    friends: [],
    requests: [],
    presence: {},
    conversations: [],
    unread: 0,
    typing: {},
    suspendedUntil: null,
    error: null,

    async start() {
      if (!SOCIAL_AVAILABLE) return set({ status: 'off' })
      unsubscribeToken ??= onTokenChange((t) => {
        if (!t && get().status !== 'signed-out') void get().signOut()
      })
      if (!(await loadToken())) return set({ status: 'signed-out' })
      if (get().status !== 'ready') set({ status: 'loading', error: null })
      await get().refresh()
      if (get().status === 'ready' && !sock) sock = openSocialSocket({ onFrame, onState })
    },

    async refresh() {
      try {
        const [me, friends, conversations] = await Promise.all([social.me(), social.friends(), social.conversations()])
        set({ me, friends: friends.friends, requests: friends.requests, conversations, unread: sumUnread(conversations), status: 'ready', error: null })
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return get().signOut()
        if (e instanceof ApiError && e.code === 'suspended') {
          const until = (e.details as { until?: number } | undefined)?.until ?? null
          return set({ status: 'suspended', suspendedUntil: until })
        }
        // offline or the server is down: keep what we had; a fresh start shows the error
        set({ error: e instanceof Error ? e.message : String(e), status: get().me ? 'ready' : 'loading' })
      }
    },

    async signOut(revoke = false) {
      const me = get().me
      if (revoke && me) await social.removeDevice(me.device.id).catch(() => {})
      sock?.close()
      sock = null
      lastTyping = new Map()
      await saveToken(null)
      set({ status: SOCIAL_AVAILABLE ? 'signed-out' : 'off', live: 'idle', me: null, friends: [], requests: [], presence: {}, conversations: [], unread: 0, typing: {} })
    },

    setMe: (me) => set({ me }),

    sendTyping(to) {
      const now = Date.now()
      if (now - (lastTyping.get(to) ?? 0) < 3000) return
      lastTyping.set(to, now)
      sock?.send({ t: 'typing', to })
    },

    reportPresence(appId) {
      if (lastPresence.appId === appId) return
      // at most one report per 5 s per device: the newest wins
      clearTimeout(presenceTimer)
      const wait = Math.max(0, lastPresence.at + 5000 - Date.now())
      presenceTimer = setTimeout(() => {
        lastPresence = { at: Date.now(), appId }
        sock?.send({ t: 'presence', appId })
      }, wait)
    },

    markRead(conversationId, upTo) {
      const conversations = get().conversations.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c))
      set({ conversations, unread: sumUnread(conversations) })
      void social.markRead(conversationId, upTo).catch(() => {})
    },
  }
})

/** Is this person typing to me right now? (call with Date.now() from a ticking component) */
export const isTyping = (typing: Record<string, number>, accountId: string, now = Date.now()) => (typing[accountId] ?? 0) > now
