// Hand-written subset of @mercuryworkshop/scramjet-controller (hooks are intentionally loose).
type Hook = object

export interface TransferResponse {
  body: string | ArrayBuffer | Blob | ReadableStream<Uint8Array>
  headers: [string, string][]
  status: number
  statusText: string
}

export interface FrameHooks {
  init: { pre: Hook; post: Hook }
  fetch: { response: Hook; intercept: Hook; request: Hook }
  error: { request: Hook }
}

export class ManagedPlugin {
  constructor(name: string, dependencies: string[])
  name: string
  frame: Frame
  install(frame: Frame): void
  tap(hook: Hook, callback: (context: any, props: any) => void | Promise<void>): void
}

export interface Frame {
  id: string
  prefix: string
  element: HTMLIFrameElement
  hooks: FrameHooks
  readonly context: unknown
  go(url: string): void
  back(): void
  forward(): void
  reload(): void
}

export interface FrameOptions {
  plugins?: ManagedPlugin[]
}

export class Controller {
  constructor(options: {
    serviceworker: ServiceWorker
    transport: unknown
    scramjetConfig?: unknown
    config?: { scramjetPath?: string; injectPath?: string; wasmPath?: string }
  })
  frames: Frame[]
  transport: unknown
  cookieJar: {
    clear(): void
    /** JSON of every cookie, keyed `.domain@path@name`. Only read inside the adapter, never handed to the UI. */
    dump(): string
    load(cookies: string): void
  }
  persistCookies(): Promise<void>
  wait(): Promise<void>
  setTransport(transport: unknown): void
  createFrame(element?: HTMLIFrameElement, options?: FrameOptions): Frame
}
