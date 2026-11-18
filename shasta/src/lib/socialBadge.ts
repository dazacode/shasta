// A tiny mirror of the social store for the browser's always-loaded chrome (the toolbar menu's Friends badge). The
// social store itself (social/store.ts: Better Auth client, socket) loads lazily with lib/socialDesktop.ts, so the
// toolbar reads these two numbers from here instead of importing it.
import { create } from 'zustand'

export interface SocialBadge {
  signedIn: boolean
  /** unread messages */
  unread: number
  /** friend requests waiting for an answer */
  requests: number
}

export const useSocialBadge = create<SocialBadge>()(() => ({ signedIn: false, unread: 0, requests: 0 }))
