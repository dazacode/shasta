// Per-tab Scramjet plugin: turns frame hooks (document init, request errors, fetch responses)
// into the adapter's tab events, error documents, popup-to-tab conversion and download tracking.
import { ManagedPlugin, type Frame } from '@mercuryworkshop/scramjet-controller'
import { ScramjetHeaders } from '@mercuryworkshop/scramjet'
import { redactUrl } from '@/lib/url'
import { describeContext } from '@/lib/contextTarget'
import { installDevtoolsGuard } from '@/lib/devtoolsGuard'
import { googleLocale, withAcceptLanguage } from '@/lib/siteLanguage'
import { forceFocus, forcePointerLock, gameControl } from '@/lib/gameControl'
import { blockPolicy, blockedResponseHeaders, loadAdBlocker, matchAd, shouldBlockPopup } from '@/lib/adBlock'
import { applyAdCosmetics } from './adCosmetics'
import { watchCrashes } from './crashWatch'
import { captureConsole } from '@/lib/consoleCapture'
import { diagnoseCrash } from '@/lib/browserSupport'
import { ERROR_META, TENTATIVE_NAV_MS, armNavTimer, byTab, clearNavTimer, emit, log, scheduleProbe, type Entry } from './scramjetAdapter'

const SLOW_REQUEST_MS = 10_000

function decodeTarget(frame: Frame, rawUrl: string): string {
  try {
    const raw = new URL(rawUrl)
    const prefix = new URL(frame.prefix, location.href).pathname
    return decodeURIComponent(raw.pathname.slice(prefix.length)) + raw.search
  } catch {
    return ''
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function errorDocument(url: string, message: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="${ERROR_META}" content="${escapeHtml(message)}"><meta name="shasta-error-url" content="${escapeHtml(url)}"><title>Page failed to load</title><body style="font:14px system-ui;padding:2rem;color:#666"><p>Shasta could not load this page.</p><pre style="white-space:pre-wrap">${escapeHtml(message)}</pre>`
}

function parseFilename(contentDisposition: string, url: string): string {
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(contentDisposition)
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition)
  const raw = star?.[1] ?? plain?.[1]
  if (raw) {
    try {
      return decodeURIComponent(raw.trim()).replace(/[\\/]/g, '_')
    } catch {
      return raw.trim().replace(/[\\/]/g, '_')
    }
  }
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (last) return decodeURIComponent(last)
  } catch {
    /* fall through */
  }
  return 'download'
}

class ShastaPlugin extends ManagedPlugin {
  private tabId: string
  /** Date.now() of the last real click or key press in any frame of this tab (pop-up blocking) */
  private lastGesture = 0
  /** features already reported as missing for this tab (a crashing game repeats itself) */
  private reported = new Set<string>()

  constructor(tabId: string) {
    super('shasta', [])
    this.tabId = tabId
  }

  private get entry() {
    return byTab.get(this.tabId)
  }

  install(frame: Frame): void {
    super.install(frame)

    // a new top-level document started initialising in the iframe: the navigation has committed
    this.tap(frame.hooks.init.pre, (ctx: { isTopLevel: boolean }) => {
      const entry = this.entry
      if (!entry || !ctx.isTopLevel) return
      if (this.reported.size) emit({ type: 'unsupported', tabId: this.tabId, feature: null })
      this.reported.clear()
      entry.committed = true
      entry.events.navStart({ committed: true })
    })

    this.tap(frame.hooks.init.post, (ctx: { isTopLevel: boolean; client: any; window: Window }) => {
      const entry = this.entry
      // only a real click or key press lets the page open a new tab shortly after
      const gesture = (e: Event) => {
        if (e.isTrusted) this.lastGesture = Date.now()
      }
      for (const type of ['pointerdown', 'keydown', 'click']) ctx.window.addEventListener(type, gesture, { capture: true })
      // Pop-ups are decided here, before the browser creates a window: Scramjet's window.open opens a REAL window (it
      // becomes a tab and closes itself), which takes focus from the page for a moment. A game loses its keyboard that
      // way (games release every key on blur). Refused ones never open; in game mode the page opens none at all.
      const popupRefused = (raw: unknown): boolean => {
        let url: URL
        try {
          url = new URL(String(raw ?? ''), ctx.client.url.href)
        } catch {
          return false
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
        const page = ctx.client.url.href
        if (!gameControl() && !shouldBlockPopup(url, this.lastGesture, page)) return false
        emit({ type: 'popupBlocked', url: url.href, openerTabId: this.tabId, ad: blockPolicy().ads && matchAd(url, 'document', page) !== null })
        return true
      }
      // a name that is not a new window (this frame, its parents, or an iframe of the page) is a navigation, not a pop-up
      const opensWindow = (target: unknown) => {
        const t = target == null ? '' : String(target)
        if (t === '' || t === '_blank') return true
        if (t === '_self' || t === '_top' || t === '_parent') return false
        try {
          return !ctx.window.document.querySelector(`iframe[name="${CSS.escape(t)}"], frame[name="${CSS.escape(t)}"]`)
        } catch {
          return true
        }
      }
      const open = ctx.window.open
      ctx.window.open = function (this: unknown, ...args: Parameters<Window['open']>) {
        if (opensWindow(args[1]) && popupRefused(args[0])) return null
        return open.apply(this, args)
      } as Window['open']
      ctx.window.addEventListener(
        'click',
        (e: MouseEvent) => {
          const a = (e.target as Element | null)?.closest?.('a[href], area[href]') as HTMLAnchorElement | null
          if (!a || e.defaultPrevented || !opensWindow(a.target || (e.ctrlKey || e.metaKey || e.shiftKey ? '_blank' : '_self'))) return
          if (popupRefused(a.getAttribute('href'))) e.preventDefault()
        },
        { capture: true },
      )
      // game mode: a click takes control of the game (focus + mouse capture), lib/gameControl.ts
      ctx.window.addEventListener(
        'pointerdown',
        (e: PointerEvent) => {
          if (!e.isTrusted || !gameControl()) return
          if (!ctx.window.document.hasFocus()) forceFocus(ctx.window)
          forcePointerLock(e.target)
        },
        { capture: true },
      )
      // the page's console output and errors, readable in Settings -> Advanced -> Console (lib/consoleCapture.ts)
      captureConsole(ctx.window, () => {
        try {
          return ctx.client.url.hostname || 'page'
        } catch {
          return 'page'
        }
      })
      // a crash from a feature this Chrome lacks becomes a notice instead of a black screen (lib/browserSupport.ts)
      watchCrashes(ctx.window, (message) => {
        void diagnoseCrash(message).then((feature) => {
          if (!feature || this.reported.has(feature.name)) return
          this.reported.add(feature.name)
          emit({ type: 'unsupported', tabId: this.tabId, feature })
        })
      })
      // element hiding, procedural selectors and scriptlets from the filter lists (proxy/adCosmetics.ts)
      if (blockPolicy().ads) applyAdCosmetics(ctx.window, ctx.client.url.href)
      // the game may start listening after its window already had focus: replay the event once it has loaded
      ctx.window.addEventListener('load', () => {
        if (gameControl() && ctx.window.document.hasFocus()) forceFocus(ctx.window)
      })
      if (entry) {
        // every frame in the page, not just the top one: no devtools shortcuts, and Shasta's own right-click menu
        installDevtoolsGuard(ctx.window)
        ctx.window.addEventListener('contextmenu', (e: MouseEvent) => {
          // a page that draws its own menu (games, editors) keeps it
          if (e.defaultPrevented) return
          // development builds: Shift + right-click still reaches the browser's own menu
          if (e.shiftKey && !import.meta.env.PROD) return
          e.preventDefault()
          entry.events.contextMenu(describeContext(ctx.window, e, true))
        })
      }
      if (!entry || !ctx.isTopLevel) return
      const report = (url: string) => {
        if (entry.lastUrl !== url) {
          entry.lastUrl = url
          entry.events.url(url)
        }
      }
      report(ctx.client.url.href)
      this.tap(ctx.client.hooks.lifecycle.navigate, (_c: unknown, props: { url: string }) => report(props.url))
      ctx.window.addEventListener('hashchange', () => report(ctx.client.url.href), { capture: true })
      ctx.window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.defaultPrevented || !(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key))) return
        entry.events.key(e)
      })
      // the page is about to navigate away (link click, form submit, script): show progress right away
      ctx.window.addEventListener(
        'beforeunload',
        () => {
          if (!this.entry) return
          this.entry.committed = false
          this.entry.events.navStart({ committed: false })
          armNavTimer(this.entry, TENTATIVE_NAV_MS, false)
        },
        { capture: true },
      )
    })

    // transport / proxy failures become a real error document instead of the browser's own error page
    this.tap(frame.hooks.error.request, (ctx: { rawrequest: { rawUrl: string; destination?: string; mode?: string }; error: unknown }, props: any) => {
      const req = ctx.rawrequest
      const isNav = req.mode === 'navigate' || req.destination === 'document' || req.destination === 'iframe' || req.destination === 'frame'
      const message = ctx.error instanceof Error ? ctx.error.message : String(ctx.error)
      const target = decodeTarget(frame, req.rawUrl)
      log('warn', `Request failed (${req.destination ?? 'unknown'}) ${redactUrl(target)}: ${message}`)
      if (isNav) {
        props.suppressError = true
        props.setResponse = {
          body: errorDocument(target, message),
          status: 502,
          statusText: 'Bad Gateway',
          headers: [
            ['content-type', 'text/html; charset=utf-8'],
            ['cache-control', 'no-store'],
            // in a cross-origin isolated shell the browser refuses to embed documents without these
            ['cross-origin-embedder-policy', 'credentialless'],
            ['cross-origin-resource-policy', 'cross-origin'],
          ],
        }
      }
      // a failing request is the earliest hint that the connection died
      scheduleProbe(300)
    })

    // ads and trackers (filter lists, lib/adBlock.ts) get an empty answer inside the proxy and never reach the network
    this.tap(frame.hooks.fetch.intercept, async (ctx: { parsed: { url: URL; destination: string; clientUrl?: URL } }, props: { response?: unknown }) => {
      const dest = ctx.parsed.destination
      if (!blockPolicy().ads) return
      // the first page waits for the engine once (one local file), so its scriptlets can run before its scripts;
      // later requests are matched at once
      await loadAdBlocker()
      if (dest === 'document') return
      const hit = matchAd(ctx.parsed.url, dest, ctx.parsed.clientUrl?.href)
      if (!hit) return
      props.response = {
        body: hit.redirect?.body ?? '',
        status: 200,
        statusText: 'OK',
        headers: ScramjetHeaders.fromRawHeaders(blockedResponseHeaders(dest, hit.redirect?.contentType)),
      }
    })

    // window.open() / target=_blank would otherwise leave Shasta for a bare proxied window: make it a tab,
    // unless it is an ad or the page opened it on its own (no click or key press just before)
    this.tap(frame.hooks.fetch.intercept, async (ctx: { parsed: { url: URL; destination: string; clientUrl?: URL } }, props: { response?: unknown }) => {
      if (ctx.parsed.destination !== 'document') return
      const url = ctx.parsed.url
      const opener = ctx.parsed.clientUrl?.href
      if (blockPolicy().ads) await loadAdBlocker()
      if (shouldBlockPopup(url, this.lastGesture, opener)) emit({ type: 'popupBlocked', url: url.href, openerTabId: this.tabId, ad: blockPolicy().ads && matchAd(url, 'document', opener) !== null })
      else emit({ type: 'openTab', url: url.href, openerTabId: this.tabId })
      props.response = {
        body: '<!doctype html><title>Opening in Shasta…</title><script>window.close()</script>',
        status: 200,
        statusText: 'OK',
        headers: ScramjetHeaders.fromRawHeaders([['content-type', 'text/html; charset=utf-8']]),
      }
    })

    // Sites see the relay's address and would answer in its language: pass on the visitor's own (lib/siteLanguage.ts).
    this.tap(frame.hooks.fetch.request, (ctx: { parsed: { destination: string } }, props: { init: { headers: [string, string][] }; url: URL }) => {
      const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
      if (Array.isArray(props.init?.headers)) withAcceptLanguage(props.init.headers, languages)
      if (ctx.parsed.destination === 'document' || ctx.parsed.destination === 'iframe') {
        const localized = googleLocale(props.url, languages)
        if (localized) props.url = localized
      }
    })

    // Diagnostics: name requests that hang or crawl (the usual cause of "stuck at 6%" in big web apps and games).
    // Only host + path are logged, never query strings.
    const pending = new WeakMap<object, { timer: number; started: number; label: string }>()
    this.tap(frame.hooks.fetch.request, (ctx: { request: object; parsed: { url: URL } }) => {
      const label = `${ctx.parsed.url.host}${ctx.parsed.url.pathname}`.slice(0, 160)
      const started = performance.now()
      const timer = window.setTimeout(() => log('warn', `Still waiting after ${SLOW_REQUEST_MS / 1000}s: ${label}`), SLOW_REQUEST_MS)
      pending.set(ctx.request, { timer, started, label })
    })
    this.tap(frame.hooks.fetch.response, (ctx: { request: object }, props: { response: { status: number; headers: { get(k: string): string | null } } }) => {
      const p = pending.get(ctx.request)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(ctx.request)
      const took = performance.now() - p.started
      const size = Number(props.response.headers.get('content-length') ?? 0)
      if (took >= SLOW_REQUEST_MS || props.response.status >= 400) {
        log(props.response.status >= 400 ? 'warn' : 'info', `${props.response.status} ${p.label}${size ? ` (${Math.round(size / 1048576)} MB)` : ''} after ${(took / 1000).toFixed(1)}s`)
      }
    })

    // observe attachment downloads that Shasta's proxy is serving
    this.tap(frame.hooks.fetch.response, (ctx: { request: { rawUrl: URL; mode?: string }; parsed: { url: URL; destination: string } }, props: { response: { body: unknown; headers: { get(k: string): string | null; set(k: string, v: string): void; delete(k: string): void }; status: number } }) => {
      const headers = props.response.headers
      // A site's OWN Document-Isolation-Policy (TurboWarp sends one) would move its document into a different
      // agent cluster than the shell -> the shell can no longer read it and covers a working page with an error.
      // So drop the site's value and set OURS below, matching the shell exactly.
      headers.delete('document-isolation-policy')
      // When the shell is cross-origin isolated, every proxied document must opt in too or the browser refuses to
      // embed it. Document-Isolation-Policy is what keeps everything isolated when the app is embedded in a
      // non-COI page (a Google Site, docs/google-sites-embed.md): it applies per-frame regardless of ancestors.
      // Chrome 137+ desktop honours it; Firefox/Safari ignore the header and fall back to COOP+COEP.
      if (self.crossOriginIsolated) {
        headers.set('cross-origin-embedder-policy', 'credentialless')
        headers.set('cross-origin-resource-policy', 'cross-origin')
        headers.set('document-isolation-policy', 'isolate-and-credentialless')
      }
      // Only page navigations are downloads. fetch()/XHR calls often carry `Content-Disposition: attachment`
      // too (Google and YouTube APIs do, as an anti-hijacking measure) and must never be listed.
      const dest = ctx.parsed.destination
      if (ctx.request.mode !== 'navigate' || (dest !== 'document' && dest !== 'iframe' && dest !== 'frame')) return
      const disposition = headers.get('content-disposition') ?? ''
      if (!/^\s*attachment/i.test(disposition) || props.response.status >= 400) return
      const entry = this.entry
      if (entry) {
        // the document is replaced by a download, so no `load` will ever fire for this navigation
        queueMicrotask(() => settleDownloadNav(entry))
      }
      trackDownload(props.response, ctx.parsed.url.href, parseFilename(disposition, ctx.parsed.url.href), headers.get('content-type') ?? '')
    })
  }
}

function settleDownloadNav(entry: Entry) {
  clearNavTimer(entry)
  entry.events.loaded()
}

function trackDownload(response: { body: unknown; headers: { get(k: string): string | null } }, url: string, filename: string, mime: string) {
  const id = crypto.randomUUID()
  const total = Number(response.headers.get('content-length') ?? 0) || 0
  const base = { id, url, filename, mime: mime.split(';')[0].trim(), total }
  emit({ type: 'download', download: { ...base, phase: 'start', received: 0 } })
  const body = response.body
  if (body instanceof ReadableStream) {
    let received = 0
    let last = 0
    response.body = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          received += chunk.byteLength
          ctrl.enqueue(chunk)
          const now = performance.now()
          if (now - last > 250) {
            last = now
            emit({ type: 'download', download: { ...base, phase: 'progress', received } })
          }
        },
        flush() {
          emit({ type: 'download', download: { ...base, phase: 'complete', received, total: total || received } })
        },
      }),
    )
  } else {
    const size = typeof body === 'string' ? new Blob([body]).size : body instanceof Blob ? body.size : body instanceof ArrayBuffer ? body.byteLength : 0
    emit({ type: 'download', download: { ...base, phase: 'complete', received: size, total: size } })
  }
}


export function createPlugin(tabId: string): ManagedPlugin {
  return new ShastaPlugin(tabId)
}
