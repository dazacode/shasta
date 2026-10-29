# Shasta

A browser-style shell (tabs, omnibox, bookmarks, history, downloads, settings) on top of the Scramjet proxy.

## Develop

```
bun run dev            # from the repo root: Wisp + Vite on http://localhost:5173
bun run test           # unit tests (vitest)
bun run test:e2e       # Shasta's own behaviour, against a local fixture site (offline-safe)
bun run test:compat    # real third-party sites through the proxy (needs network; failures may be the site's)
bun run typecheck && bunx oxlint
```
E2E needs a built app (`bun run build`) and `bunx playwright install chromium` once.

## Architecture
- `src/proxy/scramjetAdapter.ts` + `shastaPlugin.ts`: the only Scramjet code. Engine, transports and plugin load lazily. Tab events (`navStart/url/title/favicon/loaded/failed`) come from the real iframe and Scramjet hooks; nothing is faked.
- `src/stores`: Zustand. `settingsStore` (localStorage, versioned), `tabsStore` (tabs, groups, per-tab history, session), `libraryStore` (bookmarks/history/icons in IndexedDB), `downloadsStore`, `connectionStore` (adapter events bridge).
- `src/lib`: pure logic (`url`, `tabModel`, `errors`, `shortcuts`) with unit tests; `resourceGuard` and `maintenance` run in the background.
- Internal pages are `shasta://newtab|history|bookmarks|downloads|settings` rendered by the shell.

## Credits
Browsing is powered by [Scramjet](https://github.com/MercuryWorkshop/scramjet), the interception proxy by the [Mercury Workshop](https://github.com/MercuryWorkshop) team, along with their Wisp protocol server (`wisp-js`) and the `libcurl-transport` and `epoxy-transport` packages. Shasta is the browser interface and the Store built on top of it. Both are AGPL-3.0, so a publicly hosted modified copy must offer its source.

## Chromium features used (Chromebook-first)
- **Compute Pressure API**: real CPU load feeds the resource guard (Settings → Performance).
- **Keyboard Lock**: in full screen Ctrl+T/W/N and friends go to Shasta instead of the browser.
- **Installed app**: the menu's "Get the Shasta app" (`shasta://get-app`) offers the Isolated Web App (`bun run build:iwa`). The web build keeps its `manifest.webmanifest`, but Shasta no longer offers its own PWA install entry, so there is one app to get.
- **Cross-origin isolation (on by default)**: `SharedArrayBuffer` and threaded WASM work for proxied pages (needed by wasm games). `CROSS_ORIGIN_ISOLATION=0` turns it off if a site's cross-origin embeds break. Cost: pages lose `window.opener` for cross-origin popups.
- **Page feature access** (Settings → Privacy): camera, microphone, location, clipboard and device APIs (USB/serial/HID/Bluetooth/MIDI) are blocked by permissions policy until you allow a site to *ask*. All sites share Shasta's origin, so a granted permission applies to every site.
- WebGL/WebGPU/WebRTC/WebCodecs/etc. already run natively in the host browser; Scramjet doesn't emulate them.

## Limits (by design of the web platform)
- Proxied pages are same-origin with the shell (a Scramjet property), so isolation is best-effort. Don't keep secrets in Shasta; serving proxied content from a separate origin would be the stronger setup.
- Downloads: Shasta lists downloads that pass through its proxy (navigations with `Content-Disposition: attachment`); the host browser saves the file and owns its location.
- Shortcuts only reach Shasta while focus is in the shell or a proxied page; browsers reserve Ctrl/Cmd+T/W/N, so `Alt+Shift+T/W/Z` alternatives exist.
- Suspended tabs reload their page when reopened (state inside them is lost). Restored sessions keep each tab's page but not its back/forward history.
- GPU/VRAM can't be read by web code. Pages use the host browser's real GPU (WebGL/WebGPU); Shasta guards against overload via heap pressure and frame-rate monitoring and suspends background tabs.
- Site certificates can't be inspected by Shasta; the omnibox never shows a "secure" lock.
