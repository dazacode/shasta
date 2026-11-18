// Watches the body of a proxied download and reports how it goes. A download's life is:
//   start -> progress* -> complete        every byte arrived
//                      -> error           the transfer broke, came up short, or was cancelled (shown as "Interrupted")
// Exactly one ending is reported, whatever happens; before, a body that errored or was cancelled reported nothing
// and stayed "downloading" until the page was reloaded, and one that ended early (libcurl closes a broken transfer
// cleanly, see resumingTransport.ts) was reported complete.
import type { DownloadEvent } from './scramjetAdapter'

type Report = Omit<DownloadEvent, 'id' | 'url' | 'filename' | 'mime' | 'total'> & { total?: number }

/**
 * How a body that ended cleanly should be reported. Only an unencoded body with an announced length can be known to
 * be short: with Content-Encoding, Content-Length counts the compressed bytes and the page receives the decoded ones.
 */
export function endOfBody(received: number, total: number, encoded: boolean): { phase: 'complete' | 'error'; error?: string } {
  if (!encoded && total > 0 && received < total) return { phase: 'error', error: 'The connection ended before the whole file arrived' }
  return { phase: 'complete' }
}

/** Returns `body` passed through unchanged, calling `report` with progress (at most every `everyMs`) and one ending. */
export function watchDownloadBody(body: ReadableStream<Uint8Array>, opts: { total: number; encoded: boolean; everyMs?: number; now?: () => number }, report: (e: Report) => void): ReadableStream<Uint8Array> {
  const { total, encoded, everyMs = 250, now = () => performance.now() } = opts
  const reader = body.getReader()
  let received = 0
  let last = 0
  let ended = false
  const end = (e: Report) => {
    if (ended) return
    ended = true
    report(e)
  }
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        end({ phase: 'error', received, error: err instanceof Error && err.message ? err.message : 'The download failed' })
        ctrl.error(err)
        return
      }
      if (chunk.done) {
        const out = endOfBody(received, total, encoded)
        end({ ...out, received, total: out.phase === 'complete' ? total || received : total })
        ctrl.close()
        return
      }
      received += chunk.value.byteLength
      ctrl.enqueue(chunk.value)
      const t = now()
      if (t - last > everyMs) {
        last = t
        report({ phase: 'progress', received })
      }
    },
    cancel(reason) {
      end({ phase: 'error', received, error: 'Cancelled' })
      return reader.cancel(reason)
    },
  })
}
