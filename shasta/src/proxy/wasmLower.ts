// Browser half of the Memory64 conversion (server half: server/src/services/wasmLower.ts, shim: memory64Shim.ts).
// Called for every .wasm a proxied page loads on a Chrome WITHOUT Memory64. Reads only the start of the file (the
// declarations sit before the code) to see whether its memory or table is 64-bit. If not, the bytes go on untouched.
// If so, the server's 32-bit copy is streamed instead; when the server cannot convert it, the original goes on and the
// page fails exactly as it would have (with the "needs a newer Chrome" notice).
import { log as connectionLog } from './scramjetAdapter'
import { wasmIs64 } from './memory64Shim'

const PEEK_MAX = 8 * 1024 * 1024

/** to the connection log AND the console (Settings -> Advanced -> Developer tools shows the console) */
function log(level: 'info' | 'warn', message: string) {
  connectionLog(level, message)
  console[level](`[Shasta] ${message}`)
}

type Headers = { get(k: string): string | null; set(k: string, v: string): void; delete(k: string): void }

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** the chunks already read, then the rest of the original stream */
function replay(chunks: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i < chunks.length) return ctrl.enqueue(chunks[i++])
      const { done, value } = await reader.read()
      if (done) ctrl.close()
      else ctrl.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export async function lowerWasmIfNeeded(body: ReadableStream<Uint8Array>, url: URL, headers: Headers, note: (text: string) => void): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let verdict: boolean | null = null
  let nextCheck = 4096
  // read until the declarations have been seen; re-check only when the buffer has doubled (cheap even for tiny chunks)
  while (verdict === null && size < PEEK_MAX) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    if (size >= nextCheck) {
      verdict = wasmIs64(concat(chunks, size))
      nextCheck = size * 2
    }
  }
  if (verdict === null && size) verdict = wasmIs64(concat(chunks, size))
  if (!verdict) return replay(chunks, reader)

  const file = url.pathname.split('/').pop() || url.href
  const version = headers.get('etag') || headers.get('last-modified') || headers.get('content-length') || ''
  log('info', `${url.host}: ${file} uses 64-bit WebAssembly memory (Memory64), which this Chrome does not have. Getting a 32-bit copy from Shasta's server…`)
  note('Memory64: converting on Shasta’s server')
  const started = performance.now()
  try {
    const res = await fetch(`/api/wasm/lower?url=${encodeURIComponent(url.href)}&v=${encodeURIComponent(version)}`, { credentials: 'same-origin' }) // same-origin: the private staging site's Cloudflare Access needs its cookie (omit = a redirect to its login = "Failed to fetch")
    if (!res.ok || !res.body) {
      let why = `HTTP ${res.status}`
      try {
        why = ((await res.json()) as { error?: string }).error || why
      } catch {
        /* not JSON */
      }
      throw new Error(why)
    }
    void reader.cancel().catch(() => {})
    headers.delete('content-length')
    headers.delete('content-encoding')
    headers.set('content-type', 'application/wasm')
    const length = res.headers.get('content-length')
    if (length) headers.set('content-length', length)
    log('info', `${url.host}: got the 32-bit copy of ${file} (${length ? `${(Number(length) / 1048576).toFixed(1)} MB, ` : ''}${((performance.now() - started) / 1000).toFixed(1)} s)`)
    note('Memory64: converted to 32-bit by Shasta')
    return res.body
  } catch (e) {
    log('warn', `${url.host}: could not convert ${file} for this Chrome (${(e as Error).message}). The game will most likely not start; it needs Chrome 133 or newer.`)
    note(`Memory64: conversion failed (${(e as Error).message})`)
    return replay(chunks, reader)
  }
}
