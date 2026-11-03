// Which /nowgg proxy a now.gg game should use. The game is a Store package on its own content host, so it cannot
// use a relative /nowgg; the import bakes the main site's address into it as a fallback. The Shasta window that
// opens it tells it the proxy of the domain the person is actually on (store/AppLauncher.tsx -> `nowgg:proxy`), so a
// school filter that blocks the main domain does not break games for someone on pages.dev or a Lite mirror.
// docs/nowgg.md "Which proxy a game uses".

// Pure on purpose (tests run in node): the caller passes `location`, `NOWGG_SELF` (lib/edition.ts) and
// `APP_API_ORIGIN` (lib/appApi.ts).

/** `<origin>/nowgg` for this window, or null when it has none to offer (the game keeps its baked address). */
export function nowggProxyBase(loc: Pick<Location, 'protocol' | 'origin'>, self: boolean, backend: string, path = '/nowgg'): string | null {
  if (loc.protocol !== 'isolated-app:' && self) return loc.origin + path
  return backend ? backend + '/nowgg' : null
}

/**
 * Every proxy this window could hand a game, best first: its own, its backend's, then the other Shasta domains
 * (`VITE_NOWGG_BASES`, set for the Lite builds). A Lite mirror on a host that runs no code (jsDelivr) then depends on
 * none of them in particular: whichever is not blocked wins (`pickNowggBase`).
 */
export function nowggCandidates(first: string | null, extra: readonly string[]): string[] {
  const out: string[] = []
  for (const b of [first, ...extra]) {
    const v = (b ?? '').trim()
    if (v && /^https:\/\//.test(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/** A cheap request a proxy answers with CORS headers; a filter's block page has none, so it fails like a block. */
export const nowggProbeUrl = (base: string) => (base.endsWith('?p=') ? base + encodeURIComponent('/ncm/ping') : base + '/ncm/ping')

/**
 * Probes every candidate at once (CORS GET, `timeoutMs` each) and resolves with the best-ranked one that answers,
 * as soon as nothing better can still answer; null when none does.
 */
export function pickNowggBase(cands: readonly string[], fetchFn: typeof fetch = fetch, timeoutMs = 3000): Promise<string | null> {
  if (cands.length <= 1) return Promise.resolve(cands[0] ?? null)
  return new Promise((resolve) => {
    const state: (boolean | null)[] = cands.map(() => null)
    const settle = () => {
      for (let i = 0; i < cands.length; i++) {
        if (state[i] === null) return // a better one may still answer
        if (state[i]) return resolve(cands[i])
      }
      resolve(null)
    }
    cands.forEach((b, i) => {
      fetchFn(nowggProbeUrl(b), { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
        .then(() => { state[i] = true }, () => { state[i] = false })
        .finally(settle)
    })
  })
}
