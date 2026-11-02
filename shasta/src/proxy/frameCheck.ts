// "Filter check" for a page the browser refused to show (scramjetAdapter `handleLoad`: the frame ended on Chrome's
// own error page or a page from another origin, which the shell cannot read). Two facts are MEASURED:
//   1. did the page's request reach Shasta's proxy engine at all? (the plugin notes every document request it handles)
//   2. does the site answer through the proxy right now? (one fresh GET over the same transport)
// A request that never reached the engine while the site answers means something in the browser stopped it before
// Shasta saw it: on a Chromebook that is usually the school's filter extension (it reads the whole frame address) or
// a device policy. That conclusion is an ESTIMATE and is always worded as "likely"; the measured facts travel with it.
// Memory only. The result goes into the tab's error and, if the person keeps "technical details" on, into a report.

export type FrameVerdict = 'filtered' | 'refused' | 'site' | 'proxy'

export interface FrameCheck {
  verdict: FrameVerdict
  /** the engine handled a request for this page */
  reachedProxy: boolean
  /** what the engine got back for it, when it did */
  proxyStatus?: number
  /** a fresh request through the proxy, after the failure */
  liveStatus?: number
  liveError?: string
  /** one line for reports and the error page's technical details */
  summary: string
}

interface DocNote {
  url: string
  at: number
  status?: number
}

/** how far back a document request still counts for the failed load */
const WINDOW_MS = 60_000
const PER_TAB = 12
const docs = new Map<string, DocNote[]>()

/** page address without the hash (and a lone trailing slash), so redirects to "/" and #anchors still match */
const docKey = (url: string) => {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`
  } catch {
    return url.split('#')[0]
  }
}

/** The proxy plugin calls this for every document/frame request it handles; set `status` on the result when it answers. */
export function noteDocument(tabId: string, url: string, now = Date.now()): DocNote {
  const note: DocNote = { url, at: now }
  const list = (docs.get(tabId) ?? []).filter((d) => now - d.at < WINDOW_MS)
  list.push(note)
  docs.set(tabId, list.slice(-PER_TAB))
  return note
}

export const forgetTab = (tabId: string) => docs.delete(tabId)

/** the newest request the engine handled for this page of this tab, if any */
export function seenDocument(tabId: string, url: string, now = Date.now()): DocNote | null {
  const key = docKey(url)
  const list = docs.get(tabId) ?? []
  for (let i = list.length - 1; i >= 0; i--) if (now - list[i].at < WINDOW_MS && docKey(list[i].url) === key) return list[i]
  return null
}

export interface Facts {
  proxyConnected: boolean
  seen: DocNote | null
  live: { status: number } | { error: string }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Pure: turns the measured facts into a verdict and the line people (and the team) read. */
export function judge({ proxyConnected, seen, live }: Facts): FrameCheck {
  const reachedProxy = seen !== null
  const base = { reachedProxy, proxyStatus: seen?.status, ...('status' in live ? { liveStatus: live.status } : { liveError: live.error }) }
  const reached = reachedProxy ? `reached Shasta's proxy${seen?.status ? ` (HTTP ${seen.status})` : ''}` : "never reached Shasta's proxy"
  if (!proxyConnected) return { ...base, verdict: 'proxy', summary: `The proxy connection was down; ${reached}.` }
  if ('error' in live) return { ...base, verdict: 'site', summary: `${cap(reached)}; the site does not answer through the proxy (${live.error.slice(0, 120)}).` }
  if (live.status >= 400) return { ...base, verdict: 'site', summary: `${cap(reached)}; the site answers HTTP ${live.status} through the proxy.` }
  if (!reachedProxy) {
    return { ...base, verdict: 'filtered', summary: `The page never reached Shasta's proxy, while the site answers through it (HTTP ${live.status}). Likely blocked on this device or network (a school filter or device policy).` }
  }
  return { ...base, verdict: 'refused', summary: `${cap(reached)} and the site answers (HTTP ${live.status}), but the browser would not show the page. Possibly a filter on this device, or the page's own security headers.` }
}

type Request = (url: URL, signal: AbortSignal) => Promise<{ status: number; body?: unknown }>

/** Runs the live probe (max `timeoutMs`) and judges. Never throws. */
export async function checkFrame(tabId: string, url: string, opts: { proxyConnected: boolean; request: Request | null; timeoutMs?: number }): Promise<FrameCheck> {
  const seen = seenDocument(tabId, url)
  let live: Facts['live']
  if (!opts.request || !opts.proxyConnected) live = { error: 'no proxy connection' }
  else {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 10_000)
    try {
      const res = await opts.request(new URL(url), abort.signal)
      live = { status: res.status }
      // only the status matters: drop the body
      const body = res.body as { cancel?: () => Promise<void> } | undefined
      void body?.cancel?.().catch(() => {})
    } catch (e) {
      live = { error: abort.signal.aborted ? 'timed out' : e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
    }
  }
  return judge({ proxyConnected: opts.proxyConnected, seen, live })
}
