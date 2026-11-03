// Which /nowgg proxy a now.gg game should use. The game is a Store package on its own content host, so it cannot
// use a relative /nowgg; the import bakes the main site's address into it as a fallback. The Shasta window that
// opens it tells it the proxy of the domain the person is actually on (store/AppLauncher.tsx -> `nowgg:proxy`), so a
// school filter that blocks the main domain does not break games for someone on pages.dev or a Lite mirror.
// docs/nowgg.md "Which proxy a game uses".

// Pure on purpose (tests run in node): the caller passes `location`, `NOWGG_SELF` (lib/edition.ts) and
// `APP_API_ORIGIN` (lib/appApi.ts).

/** `<origin>/nowgg` for this window, or null when it has none to offer (the game keeps its baked address). */
export function nowggProxyBase(loc: Pick<Location, 'protocol' | 'origin'>, self: boolean, backend: string): string | null {
  if (loc.protocol !== 'isolated-app:' && self) return loc.origin + '/nowgg'
  return backend ? backend + '/nowgg' : null
}
