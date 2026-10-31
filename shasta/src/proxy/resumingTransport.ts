// Resumes big downloads that break halfway. Everything a page loads travels browser -> Wisp -> (tunnel) -> site over
// one connection per host, and a hiccup anywhere on that path ends every transfer on it with libcurl error 56
// ("Failure when receiving data from the peer"). Games fetch 100-400 MB in one request (Geometry Dash: a 97 MB wasm
// + a 319 MB data file) and never retry, so one break left a black screen.
//
// For a plain GET of a whole file this wraps the body: when it errors (or ends short of Content-Length), it asks the
// site for the rest with `Range: bytes=<received>-` + `If-Range: <validator>` and keeps feeding the same stream, so
// the page never sees the break. It only continues on a 206 that starts at exactly the byte it needs; If-Range makes
// a site whose file changed meanwhile answer 200 instead, which is treated as "cannot resume" (the original error).
// A compressed answer (Geometry Dash's wasm comes brotli'd from Cloudflare) reached the page DECODED, so the rest is
// asked for uncompressed (Accept-Encoding: identity), and only an identical ETag (weak comparison) proves it is the
// same file.
import type { ProxyTransport, RawHeaders, TransferrableResponse } from '@mercuryworkshop/proxy-transports'

export const MAX_RESUMES = 5
/** smaller answers are left alone: a break costs little there, and every page loads hundreds of them */
export const MIN_RESUMABLE_BYTES = 1024 * 1024

const header = (h: RawHeaders, name: string) => h.find(([k]) => k.toLowerCase() === name)?.[1]

/** How a broken answer can be continued. */
export interface ResumePlan {
  /** strong validator for If-Range (the site itself refuses to mix versions) */
  ifRange?: string
  /** otherwise: the 206 must carry this ETag (weak comparison) */
  etag?: string
  /** the answer was compressed: libcurl handed the page DECODED bytes, so ask for the uncompressed file */
  identity: boolean
}

const opaque = (etag: string) => etag.trim().replace(/^W\//, '')

/** How this answer can be resumed, or null when it cannot (safely). */
export function resumePlan(method: string, requestHeaders: RawHeaders, res: TransferrableResponse): ResumePlan | null {
  if (method.toUpperCase() !== 'GET' || res.status !== 200 || !(res.body instanceof ReadableStream)) return null
  if (header(requestHeaders, 'range')) return null
  if (header(res.headers, 'accept-ranges')?.trim().toLowerCase() === 'none') return null
  const encoding = header(res.headers, 'content-encoding')?.trim().toLowerCase()
  const identity = !!encoding && encoding !== 'identity'
  const etag = header(res.headers, 'etag')?.trim()
  // a compressed answer is continued from the uncompressed file: only an ETag ties the two together
  // (Cloudflare marks the compressed copy's ETag weak, W/"x", the uncompressed one is "x")
  if (identity) return etag ? { etag, identity } : null
  if (etag && !etag.startsWith('W/')) return { ifRange: etag, identity }
  const lastModified = header(res.headers, 'last-modified')?.trim()
  if (lastModified) return { ifRange: lastModified, identity }
  return etag ? { etag, identity } : null
}

/** The If-Range validator when this answer can be resumed with one, else null (kept for callers and tests). */
export function resumeValidator(method: string, requestHeaders: RawHeaders, res: TransferrableResponse): string | null {
  return resumePlan(method, requestHeaders, res)?.ifRange ?? null
}

/** The whole file's size from a 206's Content-Range (`bytes 100-199/200` -> 200), null when unknown (`/*`). */
export const rangeTotal = (headers: RawHeaders): number | null => {
  const m = /\/(\d+)\s*$/.exec(header(headers, 'content-range') ?? '')
  return m ? Number(m[1]) : null
}

/** Where a 206 answer starts, from its Content-Range (`bytes 100-199/200`). */
export const rangeStart = (headers: RawHeaders): number | null => {
  const m = /^\s*bytes\s+(\d+)-/i.exec(header(headers, 'content-range') ?? '')
  return m ? Number(m[1]) : null
}

/** What a resume request found: the rest of the file, "nothing left" (416), or null = cannot continue. */
export type ResumeResult = { body: ReadableStream<Uint8Array>; total?: number } | 'complete' | null

/**
 * A body that continues from `resume(received)` when the current one breaks. NOTE libcurl.js never errors a body:
 * its end callback CLOSES the stream even when the transfer failed (error 56), so a break mostly looks like a clean,
 * early end. Hence: a known length (Content-Length, or the total from a 206's Content-Range) is enforced, and an
 * unknown one (`verifyEnd`: no usable Content-Length, e.g. a compressed answer) is checked by asking for what is past the end (416 = really done).
 */
export function resumingBody(
  first: ReadableStream<Uint8Array>,
  resume: (from: number) => Promise<ResumeResult>,
  opts: { length?: number; signal?: AbortSignal; verifyEnd?: boolean } = {},
): ReadableStream<Uint8Array> {
  let reader = first.getReader()
  let received = 0
  let resumes = 0
  let length = opts.length
  /** asks for the rest: true = continue reading, false = the file is complete */
  const again = async (err: unknown, probe = false): Promise<boolean> => {
    if (opts.signal?.aborted || resumes >= MAX_RESUMES) {
      if (probe) return false
      throw err
    }
    resumes++
    try {
      reader.releaseLock()
    } catch {
      /* already broken */
    }
    const next = await resume(received).catch(() => null)
    if (next === 'complete') return false
    if (!next) {
      if (probe) return false
      throw err
    }
    if (next.total !== undefined) length = next.total
    reader = next.body.getReader()
    return true
  }
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch (err) {
          await again(err)
          continue
        }
        if (chunk.done) {
          if (length !== undefined) {
            // a known size: an early end is a broken transfer
            if (received < length && (await again(new Error(`Download ended early (${received} of ${length} bytes)`)))) continue
          } else if (opts.verifyEnd && received >= MIN_RESUMABLE_BYTES) {
            // unknown size (compressed): a 416 for "bytes=<received>-" proves it is complete, a 206 IS the rest
            if (await again(null, true)) continue
          }
          ctrl.close()
          return
        }
        received += chunk.value.byteLength
        ctrl.enqueue(chunk.value)
        return
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/** Wraps a transport so whole-file GETs survive a broken connection (see the top of this file). */
export class ResumingTransport implements ProxyTransport {
  readonly inner: ProxyTransport
  private readonly onResume?: (url: URL, from: number) => void

  constructor(inner: ProxyTransport, onResume?: (url: URL, from: number) => void) {
    this.inner = inner
    this.onResume = onResume
  }

  get ready() {
    return this.inner.ready
  }
  set ready(v: boolean) {
    this.inner.ready = v
  }

  init() {
    return this.inner.init()
  }

  connect(...args: Parameters<ProxyTransport['connect']>) {
    return this.inner.connect(...args)
  }

  async request(remote: URL, method: string, body: BodyInit | null, headers: RawHeaders, signal: AbortSignal | undefined): Promise<TransferrableResponse> {
    const res = await this.inner.request(remote, method, body, headers, signal)
    const plan = resumePlan(method, headers, res)
    if (!plan) return res
    // always the uncompressed file: the page got DECODED bytes, and libcurl may drop Content-Encoding after decoding,
    // so whether the answer was compressed cannot be trusted from its headers
    const base = headers.filter(([k]) => !/^(range|if-range|accept-encoding)$/i.test(k))
    const resume = async (from: number): Promise<ResumeResult> => {
      const extra: RawHeaders = [['Range', `bytes=${from}-`]]
      if (plan.ifRange) extra.push(['If-Range', plan.ifRange])
      extra.push(['Accept-Encoding', 'identity'])
      const r = await this.inner.request(remote, 'GET', null, [...base, ...extra], signal)
      const enc = header(r.headers, 'content-encoding')?.trim().toLowerCase()
      const tag = header(r.headers, 'etag')
      const same = plan.ifRange !== undefined || (tag !== undefined && plan.etag !== undefined && opaque(tag) === opaque(plan.etag))
      if (r.status === 416) {
        if (r.body instanceof ReadableStream) r.body.cancel().catch(() => {})
        return 'complete'
      }
      if (r.status === 206 && rangeStart(r.headers) === from && (!enc || enc === 'identity') && same && r.body instanceof ReadableStream) {
        this.onResume?.(remote, from)
        return { body: r.body as ReadableStream<Uint8Array>, total: rangeTotal(r.headers) ?? undefined }
      }
      if (r.body instanceof ReadableStream) r.body.cancel().catch(() => {})
      return null
    }
    // a compressed answer's Content-Length counts compressed bytes, not what the page receives
    const declared = plan.identity ? NaN : Number(header(res.headers, 'content-length'))
    const length = Number.isFinite(declared) && declared > 0 ? declared : undefined
    if (length !== undefined && length < MIN_RESUMABLE_BYTES) return res
    return { ...res, body: resumingBody(res.body as ReadableStream<Uint8Array>, resume, { length, signal, verifyEnd: length === undefined }) }
  }
}
