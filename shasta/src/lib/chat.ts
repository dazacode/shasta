// Community chat (shasta://chat): talks to the server's Discord bridge. Reading needs nothing; posting needs a chat
// name. The chat-only ID is a random token the server hands out at join, kept on this device in localStorage
// `shasta-chat` so moderators can stop abuse. It is never sent anywhere but /api/chat and is not linked to browsing.
import { api } from '@/store/api'
import { openLiveSocket } from './liveSocket'
import { SHARED_ORIGIN } from './edition'
import type { ChatInfo, ChatMessage, Chatter } from './chatFormat'

export { ApiError } from '@/store/api'

const KEY = 'shasta-chat'
// on a shared origin (Lite on jsDelivr) other sites' pages could read localStorage: the name lasts for the tab instead
const store = () => (SHARED_ORIGIN ? sessionStorage : localStorage)

export function loadToken(): string | null {
  try {
    const v = JSON.parse(store().getItem(KEY) ?? 'null') as { token?: unknown } | null
    return typeof v?.token === 'string' ? v.token : null
  } catch {
    return null
  }
}

export function saveToken(token: string | null) {
  try {
    if (token) store().setItem(KEY, JSON.stringify({ token }))
    else store().removeItem(KEY)
  } catch {
    /* private window or blocked storage: the chat name lasts until the tab closes */
  }
}

/** ids of messages this device sent in this session, to style them as "you" */
export const sentIds = new Set<string>()

export const chatApi = {
  info: () => api.get<ChatInfo>('/api/chat/info'),
  messages: (channelId: string, before?: string) =>
    api.get<{ messages: ChatMessage[] }>(`/api/chat/channels/${encodeURIComponent(channelId)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  join: (name: string) => api.post<{ token: string; chatter: Chatter }>('/api/chat/join', { name }),
  me: (token: string) => api.post<{ chatter: Chatter }>('/api/chat/me', { token }),
  rename: (token: string, name: string) => api.post<{ chatter: Chatter }>('/api/chat/name', { token, name }),
  leave: (token: string) => api.post<void>('/api/chat/leave', { token }),
  async send(token: string, channelId: string, content: string, replyTo?: string) {
    const r = await api.post<{ message: ChatMessage }>(`/api/chat/channels/${encodeURIComponent(channelId)}/messages`, { token, content, ...(replyTo ? { replyTo } : {}) })
    sentIds.add(r.message.id)
    return r
  },
}

export type ChatEvent =
  | { type: 'message' | 'update'; message: ChatMessage }
  | { type: 'delete'; channelId: string; id: string }
  | { type: 'typing'; channelId: string; name: string; web: boolean; until: number }
  | { type: 'info' }

export interface ChatLive {
  close(): void
  /** tell the others this chat name is typing (the server ignores it when not allowed) */
  typing(channelId: string, token: string): void
}

/** Live updates over /api/chat/ws; `onState` says whether it is connected (the page catches up on every reconnect). */
export function connectChat(onEvent: (e: ChatEvent) => void, onState: (connected: boolean) => void): ChatLive {
  const sock = openLiveSocket(
    '/api/chat/ws',
    (data) => {
      try {
        onEvent(JSON.parse(data) as ChatEvent)
      } catch {
        /* ignore a malformed event */
      }
    },
    onState,
  )
  return {
    close: () => sock.close(),
    typing: (channelId, token) => sock.send({ op: 'typing', channelId, token }),
  }
}
