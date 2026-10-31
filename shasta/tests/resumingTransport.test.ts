import { describe, expect, it } from 'vitest'
import type { ProxyTransport, RawHeaders, TransferrableResponse } from '@mercuryworkshop/proxy-transports'
import { MAX_RESUMES, MIN_RESUMABLE_BYTES, ResumingTransport, resumePlan, resumeValidator } from '@/proxy/resumingTransport'

const SIZE = MIN_RESUMABLE_BYTES * 3
const FILE = Uint8Array.from({ length: SIZE }, (_, i) => (i * 31 + 7) & 0xff)
const CHUNK = 64 * 1024

/** A body that sends `data` in chunks and then either ends, errors (libcurl error 56) or just stops early. */
function body(data: Uint8Array, breakAt: number | null, how: 'error' | 'short' = 'error'): ReadableStream<Uint8Array> {
  let at = 0
  return new ReadableStream({
    pull(ctrl) {
      const stop = breakAt ?? data.length
      if (at >= stop) {
        if (breakAt === null) ctrl.close()
        else if (how === 'error') ctrl.error(new Error('Request failed with error code 56: Failure when receiving data from the peer'))
        else ctrl.close()
        return
      }
      const end = Math.min(at + CHUNK, stop)
      ctrl.enqueue(data.slice(at, end))
      at = end
    },
  })
}

interface Site {
  /** where each answer breaks (index = request number), null = complete */
  breaks: (number | null)[]
  how?: 'error' | 'short'
  headers?: RawHeaders
  /** the file changed between requests: If-Range must then get a full 200 */
  changed?: boolean
  /** served brotli'd with a weak ETag (Cloudflare); the uncompressed 206 carries the strong one, or `rangeEtag` */
  compressed?: boolean
  rangeEtag?: string
  requests: RawHeaders[]
}

function fakeTransport(site: Site): ProxyTransport {
  return {
    ready: true,
    init: async () => {},
    connect: () => [() => {}, () => {}],
    async request(_url, _method, _body, headers): Promise<TransferrableResponse> {
      const n = site.requests.push(headers) - 1
      const brk = site.breaks[n] ?? null
      const range = headers.find(([k]) => k.toLowerCase() === 'range')?.[1]
      const base: RawHeaders = site.headers ?? [['ETag', '"v1"'], ['Accept-Ranges', 'bytes']]
      if (site.compressed) {
        if (range) {
          const identity = headers.some(([k, v]) => k.toLowerCase() === 'accept-encoding' && v === 'identity')
          const from = Number(/bytes=(\d+)-/.exec(range)![1])
          if (from >= SIZE) return { status: 416, statusText: 'Range Not Satisfiable', headers: [['Content-Range', `bytes */${SIZE}`]], body: body(new Uint8Array(0), null) }
          const part = FILE.slice(from)
          const h: RawHeaders = [['ETag', site.rangeEtag ?? '"v1"'], ['Content-Range', `bytes ${from}-${SIZE - 1}/${SIZE}`]]
          if (!identity) h.push(['Content-Encoding', 'br'])
          return { status: 206, statusText: 'Partial Content', headers: h, body: body(part, brk === null ? null : brk, site.how) }
        }
        // the page gets decoded bytes; Content-Length would be the compressed size, so none here (like Cloudflare)
        return { status: 200, statusText: 'OK', headers: [['ETag', 'W/"v1"'], ['Content-Encoding', 'br']], body: body(FILE, brk, site.how) }
      }
      if (range && !site.changed) {
        const from = Number(/bytes=(\d+)-/.exec(range)![1])
        const part = FILE.slice(from)
        return {
          status: 206,
          statusText: 'Partial Content',
          headers: [...base, ['Content-Length', String(part.length)], ['Content-Range', `bytes ${from}-${SIZE - 1}/${SIZE}`]],
          body: body(part, brk === null ? null : brk, site.how),
        }
      }
      return { status: 200, statusText: 'OK', headers: [...base, ['Content-Length', String(SIZE)]], body: body(FILE, brk, site.how) }
    },
  }
}

async function readAll(res: TransferrableResponse): Promise<Uint8Array> {
  return new Uint8Array(await new Response(res.body as ReadableStream).arrayBuffer())
}

const get = (t: ProxyTransport, signal?: AbortSignal) => t.request(new URL('https://game.example/gd_web.wasm'), 'GET', null, [['Accept', '*/*']], signal)

describe('resuming transport (big downloads that break halfway)', () => {
  it('continues a broken download from where it stopped, byte for byte', async () => {
    const site: Site = { breaks: [SIZE / 3, SIZE / 4], requests: [] }
    const resumed: number[] = []
    const t = new ResumingTransport(fakeTransport(site), (_u, from) => resumed.push(from))
    const data = await readAll(await get(t))
    expect(data).toEqual(FILE)
    expect(resumed).toEqual([SIZE / 3, SIZE / 3 + SIZE / 4])
    // the resume asks for the rest of the SAME file
    expect(site.requests[1]).toContainEqual(['Range', `bytes=${SIZE / 3}-`])
    expect(site.requests[1]).toContainEqual(['If-Range', '"v1"'])
  })

  it('also resumes a connection that ended early without an error (short of Content-Length)', async () => {
    const site: Site = { breaks: [SIZE / 2], how: 'short', requests: [] }
    const data = await readAll(await get(new ResumingTransport(fakeTransport(site))))
    expect(data).toEqual(FILE)
  })

  it('gives up with the original error when the file changed meanwhile (If-Range got a 200)', async () => {
    const site: Site = { breaks: [SIZE / 2, null], changed: true, requests: [] }
    await expect(readAll(await get(new ResumingTransport(fakeTransport(site))))).rejects.toThrow(/error code 56/)
  })

  it(`stops after ${MAX_RESUMES} resumes`, async () => {
    const site: Site = { breaks: Array.from({ length: 10 }, () => 1000), requests: [] }
    await expect(readAll(await get(new ResumingTransport(fakeTransport(site))))).rejects.toThrow(/error code 56/)
    expect(site.requests).toHaveLength(1 + MAX_RESUMES)
  })

  it('does not resume a request the page cancelled', async () => {
    const site: Site = { breaks: [SIZE / 2], requests: [] }
    const abort = new AbortController()
    const res = await get(new ResumingTransport(fakeTransport(site)), abort.signal)
    abort.abort()
    await expect(readAll(res)).rejects.toThrow()
    expect(site.requests).toHaveLength(1)
  })

  it('continues a compressed download from the uncompressed file when the ETag matches', async () => {
    const site: Site = { breaks: [SIZE / 2], compressed: true, requests: [] }
    expect(await readAll(await get(new ResumingTransport(fakeTransport(site))))).toEqual(FILE)
    expect(site.requests[1]).toContainEqual(['Accept-Encoding', 'identity'])
    expect(site.requests[1].some(([k]) => k === 'If-Range')).toBe(false)
  })

  it("libcurl's silent break of a compressed download (clean early end, no length) is caught and continued", async () => {
    const site: Site = { breaks: [SIZE / 2], how: 'short', compressed: true, requests: [] }
    expect(await readAll(await get(new ResumingTransport(fakeTransport(site))))).toEqual(FILE)
    // the end check asked for the rest and got it as a 206, whose Content-Range gave the real size: no third request
    expect(site.requests).toHaveLength(2)
  })

  it('a resumed piece that breaks silently again is caught by the total from its Content-Range', async () => {
    const site: Site = { breaks: [SIZE / 2, SIZE / 4, null], how: 'short', compressed: true, requests: [] }
    expect(await readAll(await get(new ResumingTransport(fakeTransport(site))))).toEqual(FILE)
    expect(site.requests).toHaveLength(3)
  })

  it('a compressed download that really completed costs one tiny check (416) and nothing else', async () => {
    const site: Site = { breaks: [], compressed: true, requests: [] }
    const resumed: number[] = []
    expect(await readAll(await get(new ResumingTransport(fakeTransport(site), (_u, f) => resumed.push(f))))).toEqual(FILE)
    expect(site.requests).toHaveLength(2)
    expect(resumed).toEqual([])
  })

  it('refuses to stitch a compressed download onto a different file', async () => {
    const site: Site = { breaks: [SIZE / 2], compressed: true, rangeEtag: '"v2"', requests: [] }
    await expect(readAll(await get(new ResumingTransport(fakeTransport(site))))).rejects.toThrow(/error code 56/)
  })

  it('plans: strong validators use If-Range, weak or compressed ones need a matching ETag', () => {
    const ok = (headers: RawHeaders): TransferrableResponse => ({ status: 200, statusText: '', headers, body: new ReadableStream() })
    expect(resumePlan('GET', [], ok([['ETag', '"a"']]))).toEqual({ ifRange: '"a"', identity: false })
    expect(resumePlan('GET', [], ok([['ETag', 'W/"a"']]))).toEqual({ etag: 'W/"a"', identity: false })
    expect(resumePlan('GET', [], ok([['ETag', 'W/"a"'], ['Content-Encoding', 'br']]))).toEqual({ etag: 'W/"a"', identity: true })
    expect(resumePlan('GET', [], ok([['Last-Modified', 'x'], ['Content-Encoding', 'gzip']]))).toBeNull()
    expect(resumePlan('GET', [], ok([]))).toBeNull()
  })

  it('leaves everything else untouched', () => {
    const ok = (headers: RawHeaders, status = 200): TransferrableResponse => ({ status, statusText: '', headers, body: new ReadableStream() })
    expect(resumeValidator('GET', [], ok([['ETag', '"a"']]))).toBe('"a"')
    expect(resumeValidator('GET', [], ok([['Last-Modified', 'Sat, 31 Oct 2026 10:00:00 GMT']]))).toBe('Sat, 31 Oct 2026 10:00:00 GMT')
    // no way to know it is the same file
    expect(resumeValidator('GET', [], ok([]))).toBeNull()
    expect(resumeValidator('GET', [], ok([['ETag', 'W/"weak"']]))).toBeNull()
    // compressed: Range counts encoded bytes
    expect(resumeValidator('GET', [], ok([['ETag', '"a"'], ['Content-Encoding', 'gzip']]))).toBeNull()
    expect(resumeValidator('POST', [], ok([['ETag', '"a"']]))).toBeNull()
    expect(resumeValidator('GET', [['Range', 'bytes=0-9']], ok([['ETag', '"a"']]))).toBeNull()
    expect(resumeValidator('GET', [], ok([['ETag', '"a"']], 206))).toBeNull()
    expect(resumeValidator('GET', [], ok([['ETag', '"a"'], ['Accept-Ranges', 'none']]))).toBeNull()
  })

  it('passes small files straight through, as the very same answer', async () => {
    const answer: TransferrableResponse = { status: 200, statusText: 'OK', headers: [['ETag', '"v1"'], ['Content-Length', '1000']], body: body(FILE.slice(0, 1000), null) }
    const inner = fakeTransport({ breaks: [], requests: [] })
    inner.request = async () => answer
    expect(await new ResumingTransport(inner).request(new URL('https://x.example/a.js'), 'GET', null, [], undefined)).toBe(answer)
  })
})
