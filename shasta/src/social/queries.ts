// react-query hooks for the paged and per-screen social data (feed, threads, profiles, devices), shared by the phone
// app and the desktop page. The live socket keeps them fresh through wireSocialQueries: a new message lands in its
// open thread, a friend's post at the top of the feed, without refetching.
import { useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import type { Message, Post } from './types'
import { social } from './api'
import { onSocialEvent } from './store'

export const socialKeys = {
  feed: ['social', 'feed'] as const,
  thread: (conversationId: string) => ['social', 'thread', conversationId] as const,
  profile: (handle: string) => ['social', 'profile', handle.toLowerCase()] as const,
  guestbook: (handle: string) => ['social', 'guestbook', handle.toLowerCase()] as const,
  devices: ['social', 'devices'] as const,
  blocks: ['social', 'blocks'] as const,
}

export type FeedPage = { posts: Post[]; caughtUp: boolean }
export type ThreadPage = { messages: Message[]; first: boolean }

/** Newest first, 20 at a time; `hasNextPage` false once the server says "all caught up". */
export function useFeed(enabled = true) {
  return useInfiniteQuery({
    queryKey: socialKeys.feed,
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => social.feed(pageParam || undefined),
    getNextPageParam: (last: FeedPage) => (last.caughtUp || !last.posts.length ? undefined : last.posts[last.posts.length - 1].createdAt),
  })
}

/**
 * One conversation, oldest first within a page; older pages load on scroll up. `first` on a page = it reaches the very
 * first message, so there is nothing older.
 */
export function useThread(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: socialKeys.thread(conversationId ?? ''),
    enabled: !!conversationId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => social.messages(conversationId!, pageParam || undefined),
    getNextPageParam: (last: ThreadPage) => (last.first || !last.messages.length ? undefined : last.messages[0].createdAt),
  })
}

/** Every message of a thread in display order (oldest first). */
export const threadMessages = (data: InfiniteData<ThreadPage> | undefined): Message[] => (data ? [...data.pages].reverse().flatMap((p) => p.messages) : [])

export const useProfile = (handle: string | null) => useQuery({ queryKey: socialKeys.profile(handle ?? ''), enabled: !!handle, queryFn: () => social.profile(handle!) })
export const useGuestbook = (handle: string | null) => useQuery({ queryKey: socialKeys.guestbook(handle ?? ''), enabled: !!handle, queryFn: () => social.guestbook(handle!) })
export const useDevices = () => useQuery({ queryKey: socialKeys.devices, queryFn: social.devices })
export const useBlocks = () => useQuery({ queryKey: socialKeys.blocks, queryFn: social.blocks })

/** Adds a message to its thread's newest page (or replaces the optimistic copy with the same clientId). */
export function putMessage(qc: QueryClient, m: Message) {
  qc.setQueryData<InfiniteData<ThreadPage>>(socialKeys.thread(m.conversationId), (d) => {
    if (!d) return d
    const [newest, ...rest] = d.pages
    if (!newest) return d
    const others = newest.messages.filter((x) => x.id !== m.id && x.clientId !== m.clientId)
    return { ...d, pages: [{ ...newest, messages: [...others, m].sort((a, b) => a.createdAt - b.createdAt) }, ...rest] }
  })
}

/** Removes a not-yet-sent copy (a send that failed). */
export function dropMessage(qc: QueryClient, conversationId: string, clientId: string) {
  qc.setQueryData<InfiniteData<ThreadPage>>(socialKeys.thread(conversationId), (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.filter((x) => x.clientId !== clientId) })) } : d,
  )
}

/** Hooks the live events into the caches. Call once per QueryClient; returns the unsubscribe. */
export function wireSocialQueries(qc: QueryClient): () => void {
  return onSocialEvent((e) => {
    switch (e.type) {
      case 'message':
        putMessage(qc, e.message)
        break
      case 'post':
        qc.setQueryData<InfiniteData<FeedPage>>(socialKeys.feed, (d) => {
          if (!d?.pages[0] || d.pages.some((p) => p.posts.some((x) => x.id === e.post.id))) return d
          return { ...d, pages: [{ ...d.pages[0], posts: [e.post, ...d.pages[0].posts] }, ...d.pages.slice(1)] }
        })
        break
      case 'guestbook':
        void qc.invalidateQueries({ queryKey: ['social', 'guestbook'] })
        break
      case 'device_linked':
      case 'device_removed':
        void qc.invalidateQueries({ queryKey: socialKeys.devices })
        break
      case 'friend_added':
      case 'friend_removed':
        void qc.invalidateQueries({ queryKey: ['social', 'profile'] })
        void qc.invalidateQueries({ queryKey: socialKeys.feed })
        break
    }
  })
}
