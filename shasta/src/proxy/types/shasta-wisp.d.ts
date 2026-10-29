// Ambient types for the pinned relay fork's browser entry (`@dazacode/shasta-wisp/browser`).
//
// The fork is plain JavaScript with no .d.ts (like Scramjet, which is also typeless here), so the
// shape Shasta uses is declared by hand. Keep this in step with
// wisp/src/server/browser/index.mjs and wisp/FORK.md.
declare module '@dazacode/shasta-wisp/browser' {
  /** Options are additive; the defaults are the hardened ones (no private/loopback, no UDP). */
  export interface LocalWispServerOptions {
    /** The endpoint transports treat as the relay. Defaults to `wss://local/wisp/`. */
    url?: string
    /** Install a DNS-over-HTTPS resolver so the SSRF filter can see an address. Default true. */
    useDoh?: boolean
    /** Apply `allow_private_ips = false`, `allow_loopback_ips = false`, no UDP, a 500-stream cap. */
    patchOptions?: boolean
  }

  export interface LocalWispServer {
    /** Hand this to a transport as its Wisp endpoint. */
    readonly url: string
    /** A fresh client socket; each one gets its own server connection, like a relay. */
    createClient(protocols?: string[] | string | null): WebSocket
    /** Route `new WebSocket(this.url)` to this server. Returns a restorer. */
    installWebSocket(): () => void
    readonly stats: { connections: number; started: number; refused: number }
    close(): void
  }

  export function createLocalWispServer(options?: LocalWispServerOptions): LocalWispServer
  /** Whether this context can open sockets at all (an Isolated Web App). */
  export function hasDirectSockets(): boolean
  export const DEFAULT_LOCAL_WISP_URL: string
  export class DirectSocketsUnavailable extends Error {}
}
