// Shasta social: the wire types. The contract is docs/social-protocol.md (change it first); the server mirrors this
// file in server/src/social/types.ts.

export type Band = 'teen' | 'older-teen' | 'adult'
export type DeviceKind = 'phone' | 'desktop'
export type Role = 'owner' | 'linked'
export type Mood = 'happy' | 'chill' | 'hyped' | 'tired' | 'focused' | 'gaming' | 'sad' | 'silly'
export type Font = 'system' | 'rounded' | 'serif' | 'mono' | 'pixel' | 'hand'
export type Block = 'about' | 'playing' | 'crew' | 'showcase' | 'guestbook' | 'stickers' | 'posts'
export type ReportKind = 'message' | 'profile' | 'post' | 'guestbook' | 'account'
export type ReportReason = 'bullying' | 'sexual' | 'scam' | 'self_harm' | 'spam' | 'other'
export type NudgeKind = 'other_app' | 'phone' | 'address' | 'school' | 'age' | 'photos' | 'meet'

export interface SocialSettings {
  /** friends see what I'm playing (default off) */
  presence: boolean
  /** 22:00-07:00: messages wait quietly (default on under 18) */
  quietHours: boolean
  /** friends see my posts */
  feedVisible: boolean
  /** friends can leave guestbook notes */
  guestbook: boolean
}

export interface Device {
  id: string
  kind: DeviceKind
  role: Role
  name: string
  createdAt: number
  seenAt: number
  /** a newly linked device can't add/remove devices or change backups until then */
  limitedUntil: number | null
  current?: boolean
}

export interface Me {
  id: string
  handle: string
  band: Band
  createdAt: number
  /** no passkey and no recovery code yet: losing this phone loses the account */
  temporary: boolean
  settings: SocialSettings
  device: Device
}

export interface Avatar {
  /** id from social/avatars.ts */
  preset: string
  bg: string
}

export interface Person {
  id: string
  handle: string
  avatar: Avatar
  mood: Mood | null
  status: string | null
}

export interface Theme {
  bg: string
  surface: string
  text: string
  accent: string
  font: Font
  /** curated id or 'none' */
  background: string
}

export interface ShowcaseApp {
  appId: string
  name: string
  slug: string
  scheme: 'game' | 'app'
  iconUrl: string | null
}

export interface PlacedSticker {
  id: string
  x: number
  y: number
  r: number
}

export interface Presence {
  accountId: string
  app: ShowcaseApp
  /** rounded down to 5 minutes */
  since: number
  device: DeviceKind
}

export interface Profile extends Person {
  theme: Theme
  blocks: Block[]
  about: string
  /** up to 8 mutual friends, shuffled by the server: never a ranking */
  crew: Person[]
  showcase: ShowcaseApp[]
  stickers: PlacedSticker[]
  playing: Presence | null
  friend: 'self' | 'friends' | 'none'
  since: number
}

export interface Friend extends Person {
  friendsSince: number
  playing: Presence | null
}

export interface FriendRequest {
  id: string
  from: Person
  createdAt: number
  expiresAt: number
}

export interface Post {
  id: string
  author: Person
  text: string
  app: ShowcaseApp | null
  createdAt: number
  myReaction: string | null
  /** only present for the author: who reacted (never a count shown to others) */
  reactions?: { sticker: string; by: Person }[]
}

export interface GuestbookNote {
  id: string
  author: Person
  text: string | null
  sticker: string | null
  createdAt: number
  status: 'pending' | 'shown'
}

export interface Conversation {
  id: string
  with: Person
  lastAt: number
  unread: number
  preview: string | null
  /** no messages were ever exchanged before the newest one: show the first-message safety card */
  first?: boolean
}

export interface Message {
  id: string
  clientId: string
  conversationId: string
  from: string
  text: string
  createdAt: number
  app: ShowcaseApp | null
}

export interface ProfileEdit {
  avatar: Avatar
  mood: Mood | null
  status: string | null
  about: string
  theme: Theme
  blocks: Block[]
  crew: string[]
  showcase: string[]
  stickers: PlacedSticker[]
}

/** What a desktop hands the phone during linking (docs/social-protocol.md "Linking", step 7). Untrusted on arrival. */
export interface SessionBundle {
  v: 1
  library: unknown
  settings: Record<string, unknown>
  playing: { appId: string } | null
}

export type SocialEvent =
  | { type: 'message'; message: Message; conversation: Conversation }
  | { type: 'message_read'; conversationId: string; upTo: number; by: string }
  | { type: 'friend_request'; request: FriendRequest }
  | { type: 'friend_added'; friend: Friend }
  | { type: 'friend_removed'; accountId: string }
  | { type: 'post'; post: Post }
  | { type: 'guestbook'; note: GuestbookNote }
  | { type: 'device_linked'; device: Device }
  | { type: 'device_removed'; deviceId: string }
  | { type: 'account_deleted' }
  | { type: 'moderation'; action: 'warning' | 'suspended' | 'held'; until?: number; reason?: string }

export type ServerFrame =
  | { t: 'ready'; me: Me; seq: number }
  | { t: 'ev'; seq: number; e: SocialEvent }
  | { t: 'presence'; list: Presence[] }
  | { t: 'presence'; p: Presence | { accountId: string; app: null } }
  | { t: 'launch'; app: ShowcaseApp }
  | { t: 'typing'; from: string }
  | { t: 'ping' }
