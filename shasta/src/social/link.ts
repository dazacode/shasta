// The QR handshake that turns a phone into your account and links a Chromebook to it (docs/social-protocol.md
// "Linking"). Same idea as WhatsApp/Signal/Discord device linking, built on HPKE (RFC 9180, @hpke/core, WebCrypto
// only) instead of hand-rolled ECDH:
//   - the screen that SHOWS the code puts its P-256 public key and a 32-byte one-time secret in the QR, after `#`, so
//     neither ever reaches the server;
//   - the scanner seals to that key in PSK mode (psk = the secret): only someone who saw the QR can talk to the shower,
//     and the relay can't sit in the middle;
//   - the shower answers by sealing to the scanner's key (also PSK mode), so both directions are end-to-end;
//   - both sides derive the same 3-digit code from the first context's exporter; the person compares it on both
//     screens before anything is approved.
// P-256 only: X25519 is missing on the older Chromes Shasta supports.
import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256, type RecipientContext, type SenderContext } from '@hpke/core'

const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() })
const enc = new TextEncoder()
const dec = new TextDecoder()
const PSK_ID = enc.encode('shasta-link-v1')

export const b64u = {
  encode(bytes: Uint8Array | ArrayBuffer): string {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    let s = ''
    for (const b of u) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(text: string): Uint8Array {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4))
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  },
}

const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer
const ROOM = /^[A-Za-z0-9]{8,32}$/

export interface LinkInvite {
  /** the room the server handed out (link/start); also bound into every HPKE context */
  room: string
  /** the shower's serialized P-256 public key (65 bytes) */
  pub: Uint8Array
  /** 32 random bytes: the HPKE pre-shared key */
  secret: Uint8Array
}

/** `<origin>/me#l=<room>.<pub>.<secret>` */
export function inviteUrl(origin: string, inv: LinkInvite): string {
  return `${origin.replace(/\/$/, '')}/me#l=${inv.room}.${b64u.encode(inv.pub)}.${b64u.encode(inv.secret)}`
}

/** Reads `#l=...` from a location hash; null if it is not a well-formed invite. */
export function parseInvite(hash: string): LinkInvite | null {
  const m = /(?:^#|&)l=([^&]+)/.exec(hash)
  if (!m) return null
  const [room, pub, secret] = m[1].split('.')
  if (!room || !pub || !secret || !ROOM.test(room)) return null
  try {
    const p = b64u.decode(pub)
    const s = b64u.decode(secret)
    if (p.length !== 65 || p[0] !== 4 || s.length !== 32) return null
    return { room, pub: p, secret: s }
  } catch {
    return null
  }
}

/** Reads `#f=<token>` (a friend code); null otherwise. */
export function parseFriendCode(hash: string): string | null {
  const m = /(?:^#|&)f=([A-Za-z0-9_-]{16,64})(?:&|$)/.exec(hash)
  return m ? m[1] : null
}

/** The plaintext frames of the handshake; everything after them is a sealed box `{ ct }`. */
export interface ScanHello {
  /** HPKE encapsulated key, scanner -> shower */
  enc: string
  /** the scanner's own public key, for the reply direction */
  pub: string
}
export interface ShowReply {
  enc: string
}

const info = (room: string, dir: 'scan' | 'show') => enc.encode(`shasta-link-v1|${room}|${dir}`)

async function codeOf(ctx: SenderContext | RecipientContext): Promise<string> {
  const b = new Uint8Array(await ctx.export(buf(enc.encode('shasta-link-code')), 2))
  return String(((b[0] << 8) | b[1]) % 1000).padStart(3, '0')
}

export interface Channel {
  /** 3 digits, the same on both screens when nobody is in the middle */
  readonly code: string
  /** seals for the other side (order matters: boxes must be opened in the order they were sealed) */
  seal(value: unknown): Promise<{ ct: string }>
  open<T = unknown>(box: { ct: string }): Promise<T>
}

function channel(code: string, out: SenderContext, inn: RecipientContext): Channel {
  return {
    code,
    async seal(value) {
      return { ct: b64u.encode(await out.seal(buf(enc.encode(JSON.stringify(value))))) }
    },
    async open<T>(box: { ct: string }) {
      return JSON.parse(dec.decode(await inn.open(buf(b64u.decode(box.ct))))) as T
    },
  }
}

/** The screen that shows the QR code. */
export class ShowSide {
  readonly invite: LinkInvite
  private readonly keys: CryptoKeyPair
  private constructor(invite: LinkInvite, keys: CryptoKeyPair) {
    this.invite = invite
    this.keys = keys
  }

  static async create(room: string): Promise<ShowSide> {
    const keys = await suite.kem.generateKeyPair()
    const pub = new Uint8Array(await suite.kem.serializePublicKey(keys.publicKey))
    return new ShowSide({ room, pub, secret: crypto.getRandomValues(new Uint8Array(32)) }, keys)
  }

  url(origin: string) {
    return inviteUrl(origin, this.invite)
  }

  /** Takes the scanner's hello; returns the channel and the reply frame to send back (plaintext). */
  async accept(hello: ScanHello): Promise<{ channel: Channel; reply: ShowReply }> {
    const psk = { id: buf(PSK_ID), key: buf(this.invite.secret) }
    const inn = await suite.createRecipientContext({ recipientKey: this.keys, enc: buf(b64u.decode(hello.enc)), psk, info: buf(info(this.invite.room, 'scan')) })
    const peer = await suite.kem.deserializePublicKey(buf(b64u.decode(hello.pub)))
    const out = await suite.createSenderContext({ recipientPublicKey: peer, psk, info: buf(info(this.invite.room, 'show')) })
    return { channel: channel(await codeOf(inn), out, inn), reply: { enc: b64u.encode(out.enc) } }
  }
}

/** The phone that scanned the QR code. */
export class ScanSide {
  private readonly invite: LinkInvite
  private readonly keys: CryptoKeyPair
  private readonly out: SenderContext
  /** the code is known as soon as the hello is made: show it right away */
  readonly code: string
  readonly hello: ScanHello
  private constructor(invite: LinkInvite, keys: CryptoKeyPair, out: SenderContext, code: string, hello: ScanHello) {
    this.invite = invite
    this.keys = keys
    this.out = out
    this.code = code
    this.hello = hello
  }

  static async create(invite: LinkInvite): Promise<ScanSide> {
    const keys = await suite.kem.generateKeyPair()
    const showPub = await suite.kem.deserializePublicKey(buf(invite.pub))
    const psk = { id: buf(PSK_ID), key: buf(invite.secret) }
    const out = await suite.createSenderContext({ recipientPublicKey: showPub, psk, info: buf(info(invite.room, 'scan')) })
    const pub = b64u.encode(await suite.kem.serializePublicKey(keys.publicKey))
    return new ScanSide(invite, keys, out, await codeOf(out), { enc: b64u.encode(out.enc), pub })
  }

  /** Takes the shower's reply; returns the two-way channel. */
  async accept(reply: ShowReply): Promise<Channel> {
    const psk = { id: buf(PSK_ID), key: buf(this.invite.secret) }
    const inn = await suite.createRecipientContext({ recipientKey: this.keys, enc: buf(b64u.decode(reply.enc)), psk, info: buf(info(this.invite.room, 'show')) })
    return channel(this.code, this.out, inn)
  }
}
