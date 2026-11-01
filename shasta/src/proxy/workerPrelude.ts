// Code put in front of every proxied worker script (shastaPlugin.ts, fetch.response for destination worker/sharedworker).
//
// 1. Console forwarding: a worker's console.* calls and uncaught errors never reach the window, and games do most of their
//    work in workers (Emscripten pthreads, GPU/file workers). Without DevTools (blocked on school Chromebooks) their
//    messages were invisible. Each line goes to Shasta's in-app console (lib/consoleCapture.ts) over a BroadcastChannel.
//    Lines are posted at once, not batched: a game worker often blocks inside wasm for its whole life, so a timer that
//    flushes a batch would never run. A per-worker rate limit keeps a chatty engine from flooding the shell.
// 2. The Memory64 shim (memory64Shim.ts), only on a Chrome without Memory64.
//
// Proxied workers run on Shasta's own origin, so the channel reaches the shell. A page could post fake lines too; they are
// only ever displayed as text.
import { SHIM_SOURCE, hasMemory64 } from './memory64Shim'
import FORWARD from './inject/consoleForward.js?raw'

export const DEVTOOLS_CHANNEL = 'shasta-devtools'

export interface WorkerLine {
  kind: 'shasta-console'
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  source: string
  text: string
}


/** a short label for a worker script: `host · file.js` */
export function workerLabel(url: URL): string {
  const file = url.pathname.split('/').filter(Boolean).pop() || url.pathname
  return `${url.hostname} · ${decodeURIComponent(file).slice(0, 60)} (worker)`
}

/** The text to put before a worker script. */
export function workerPrelude(url: URL): string {
  const fwd = `;(\n${FORWARD}\n)(self, ${JSON.stringify(workerLabel(url))}, ${JSON.stringify(DEVTOOLS_CHANNEL)});\n`
  return hasMemory64() ? fwd : fwd + SHIM_SOURCE
}

/** Puts `prefix` in front of a response body of any shape Scramjet hands the hooks. */
export function prependBody(body: unknown, prefix: string): unknown {
  if (typeof body === 'string') return prefix + body
  const head = new TextEncoder().encode(prefix)
  if (body instanceof ReadableStream) {
    let first = true
    const reader = (body as ReadableStream<Uint8Array>).getReader()
    return new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (first) {
          first = false
          ctrl.enqueue(head)
          return
        }
        const { done, value } = await reader.read()
        if (done) ctrl.close()
        else ctrl.enqueue(value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    const out = new Uint8Array(head.length + bytes.length)
    out.set(head)
    out.set(bytes, head.length)
    return out.buffer
  }
  if (body instanceof Blob) return new Blob([head, body], { type: body.type })
  return body
}
