// One typed function per social route (docs/social-protocol.md). Every call carries the bearer token and never a
// cookie; every failure becomes an ApiError {status, code, details} with a message that is safe to show. A 401 on a
// request that carried a token signs this device out (the token is gone or revoked).
import type {
  Avatar, Conversation, Device, DeviceKind, Friend, FriendRequest, GuestbookNote, Me, Message, NudgeKind, Person, Post,
  Profile, ProfileEdit, ReportKind, ReportReason, SocialSettings,
} from './types'
import { loadToken, saveToken, takeTokenFrom } from './auth'
import { apiBase } from './origin'

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Readable words for the codes the contract names; anything else keeps the server's own message. */
const MESSAGES: Record<string, string> = {
  offline: "Can't reach Shasta right now. Check your connection and try again.",
  rate_limited: "That's a lot at once. Wait a little and try again.",
  automod: "That can't be posted here. Try saying it another way.",
  links: 'Only Shasta Store game links can be shared here.',
  limited: 'A newly linked device has to wait 3 days before it can do that. Use your phone.',
  too_young: "Shasta's social features are for 13 and up.",
  band: "You can't add this person.",
  blocked: "You can't add this person.",
  suspended: 'This account is paused for now.',
  unauthorized: 'This device was signed out.',
  not_found: "That isn't here any more.",
  // the server's codes (docs/social-protocol.md "Server notes")
  bad_handle: 'Only letters, numbers and _ (3 to 20).',
  handle_reserved: "That handle is reserved. Pick another.",
  cant_send: "You can't send messages to this person.",
  guestbook_off: 'Their guestbook is turned off.',
  new_account: 'New accounts can post 30 seconds after joining. Try again in a moment.',
  forbidden: 'Only your first phone can do that.',
  last_owner: 'This is the only phone that manages your account. Remove the linked computers first.',
  expired: 'That code ran out. Ask for a new one.',
  contrast: 'Those colours are hard to read together. Pick others.',
  confirm: "That isn't your handle.",
  kek_missing: "Messages are switched off on Shasta's server right now.",
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? e.message
  return 'Something went wrong. Try again.'
}

/** The double-check kind of a 422 nudge answer, else null. */
export function nudgeOf(e: unknown): NudgeKind | null {
  if (!(e instanceof ApiError) || e.status !== 422 || e.code !== 'nudge') return null
  const kind = (e.details as { kind?: unknown } | undefined)?.kind
  return typeof kind === 'string' ? (kind as NudgeKind) : null
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const token = await loadToken()
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/social/${path}`, {
      method,
      credentials: 'omit',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, MESSAGES.offline, 'offline')
  }
  takeTokenFrom(res)
  const text = res.status === 204 ? '' : await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* a proxy or hosting error page */
  }
  if (!res.ok) {
    // server/src/http.ts answers { error: { code, message, details } }; the contract also allows { error, code, details }
    const raw = (json ?? {}) as { error?: unknown; code?: unknown; message?: unknown; details?: unknown }
    const err = (raw.error && typeof raw.error === 'object' ? raw.error : raw) as { code?: unknown; message?: unknown; details?: unknown }
    const code = typeof err.code === 'string' ? err.code : res.status === 401 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'error'
    const message = typeof err.message === 'string' ? err.message : typeof raw.error === 'string' ? raw.error : res.status >= 500 ? 'Shasta had a problem. Try again in a moment.' : `Request failed (${res.status}).`
    if (res.status === 401 && token) await saveToken(null)
    throw new ApiError(res.status, message, code, err.details ?? raw.details)
  }
  return json as T
}

/** Lists may come bare or wrapped ({ devices: [...] }); either way the caller gets the array. */
const listOf = <T>(v: unknown, key: string): T[] => (Array.isArray(v) ? v : Array.isArray((v as Record<string, unknown> | null)?.[key]) ? ((v as Record<string, T[]>)[key]) : [])
const q = (before?: number) => (before ? `?before=${encodeURIComponent(String(before))}` : '')
const enc = encodeURIComponent

export interface NewDevice {
  kind: DeviceKind
  name: string
}
export interface ReportInput {
  kind: ReportKind
  targetId: string
  reason: ReportReason
  note?: string
  includeMessages?: boolean
}

export const social = {
  // ---- account + devices
  me: () => call<Me>('GET', 'me'),
  createAccount: async (b: { handle: string; age: number; avatar: Avatar; device: NewDevice }) => {
    const r = await call<{ me: Me; token: string }>('POST', 'account', b)
    await saveToken(r.token)
    return r
  },
  settings: (patch: Partial<SocialSettings>) => call<SocialSettings>('PATCH', 'me/settings', patch),
  deleteAccount: async (handle: string) => {
    const r = await call<{ ok: true }>('DELETE', 'me', { confirm: handle })
    await saveToken(null)
    return r
  },
  devices: async () => listOf<Device>(await call('GET', 'devices'), 'devices'),
  renameDevice: (id: string, name: string) => call<Device>('PATCH', `devices/${enc(id)}`, { name }),
  removeDevice: (id: string) => call<{ ok: true }>('DELETE', `devices/${enc(id)}`),
  /** ok: false = that computer has no open connection (Shasta isn't open there) */
  launchOn: (deviceId: string, appId: string) => call<{ ok: boolean }>('POST', `devices/${enc(deviceId)}/launch`, { appId }),
  newRecoveryCode: () => call<{ code: string }>('POST', 'recovery'),
  recover: async (code: string, device: NewDevice) => {
    const r = await call<{ me: Me; token: string }>('POST', 'recover', { code, device })
    await saveToken(r.token)
    return r
  },

  // ---- friends + blocks
  friends: () => call<{ friends: Friend[]; requests: FriendRequest[] }>('GET', 'friends'),
  friendCode: () => call<{ token: string; expiresAt: number }>('POST', 'friends/code'),
  scanFriend: (token: string) => call<{ request: { id: string; to: Person } }>('POST', 'friends/scan', { token }),
  acceptRequest: (id: string) => call<{ friend?: Friend }>('POST', `friends/requests/${enc(id)}/accept`),
  declineRequest: (id: string) => call<{ ok?: true }>('POST', `friends/requests/${enc(id)}/decline`),
  unfriend: (accountId: string) => call<{ ok: true }>('DELETE', `friends/${enc(accountId)}`),
  blocks: async () => listOf<Person>(await call('GET', 'blocks'), 'blocks'),
  block: (accountId: string) => call<{ ok: true }>('POST', 'blocks', { accountId }),
  unblock: (accountId: string) => call<{ ok: true }>('DELETE', `blocks/${enc(accountId)}`),

  // ---- profile + guestbook
  profile: (handle: string) => call<Profile>('GET', `profile/${enc(handle)}`),
  saveProfile: (edit: ProfileEdit) => call<Profile>('PUT', 'me/profile', edit),
  guestbook: async (handle: string) => listOf<GuestbookNote>(await call('GET', `profile/${enc(handle)}/guestbook`), 'notes'),
  signGuestbook: (handle: string, note: { text?: string; sticker?: string }) => call<GuestbookNote>('POST', `profile/${enc(handle)}/guestbook`, note),
  approveNote: (id: string) => call<{ ok: true }>('POST', `guestbook/${enc(id)}/approve`),
  deleteNote: (id: string) => call<{ ok: true }>('DELETE', `guestbook/${enc(id)}`),

  // ---- feed
  feed: (before?: number) => call<{ posts: Post[]; caughtUp: boolean }>('GET', `feed${q(before)}`),
  post: (b: { text: string; appId?: string }) => call<Post>('POST', 'posts', b),
  deletePost: (id: string) => call<{ ok: true }>('DELETE', `posts/${enc(id)}`),
  react: (postId: string, sticker: string) => call<{ ok: true }>('PUT', `posts/${enc(postId)}/reaction`, { sticker }),
  unreact: (postId: string) => call<{ ok: true }>('DELETE', `posts/${enc(postId)}/reaction`),

  // ---- messages
  conversations: async () => listOf<Conversation>(await call('GET', 'conversations'), 'conversations'),
  messages: (conversationId: string, before?: number) => call<{ messages: Message[]; first: boolean }>('GET', `conversations/${enc(conversationId)}/messages${q(before)}`),
  /** 422 `nudge` (see nudgeOf) means "double-check first": resend with confirmed: true if they still want to */
  send: (b: { to: string; clientId: string; text: string; confirmed?: boolean }) => call<Message>('POST', 'messages', b),
  markRead: (conversationId: string, upTo: number) => call<{ ok: true }>('POST', `conversations/${enc(conversationId)}/read`, { upTo }),
  deleteConversation: (id: string) => call<{ ok: true }>('DELETE', `conversations/${enc(id)}`),

  // ---- safety
  report: (r: ReportInput) => call<{ ok: true; id?: string }>('POST', 'reports', r),
}

/** Exposed for the desktop page's own unlisted calls; prefer `social.*`. */
export { call as socialCall }
