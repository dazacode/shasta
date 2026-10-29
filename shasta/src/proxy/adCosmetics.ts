// The filter lists' in-page part (lib/adBlock.ts) applied to one proxied frame: called from the frame's init hook, so
// scriptlets run before the page's own scripts whenever the engine is already loaded (it is preloaded at start).
import { adBlockerReady, domCosmetics, loadAdBlocker, pageCosmetics, type Cosmetics } from '@/lib/adBlock'

type Content = typeof import('@ghostery/adblocker-content')
type Selectors = typeof import('@ghostery/adblocker-extended-selectors')

let libs: Promise<[Content, Selectors]> | null = null
const loadLibs = () => (libs ??= Promise.all([import('@ghostery/adblocker-content'), import('@ghostery/adblocker-extended-selectors')]))

function addStyle(doc: Document, css: string) {
  if (!css || !doc.documentElement) return
  const style = doc.createElement('style')
  style.dataset.shasta = 'adblock'
  style.textContent = css
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

/** uBlock Origin scriptlets: trusted code from Shasta's own engine file, run in the page's world (they wrap its globals). */
function runScriptlets(win: Window, scripts: string[]) {
  const Fn = (win as unknown as { Function: FunctionConstructor }).Function
  for (const code of scripts) {
    try {
      new Fn(code)()
    } catch {
      // a CSP without eval (the installed app's proxy engine) or a scriptlet that throws: the rest still runs
    }
  }
}

/** Procedural selectors (:has-text, :upward, :remove()...) are evaluated here, again whenever the page changes. */
function procedural(win: Window, extended: Cosmetics['extended'], sel: Selectors) {
  const doc = win.document
  let queued = false
  const apply = () => {
    queued = false
    if (!doc.documentElement) return
    for (const rule of extended) {
      let found: Element[]
      try {
        found = sel.querySelectorAll(doc.documentElement, rule.ast)
      } catch {
        continue
      }
      for (const el of found) {
        if (rule.directive) sel.handlePseudoDirective(el, rule.directive)
        else if (rule.attribute === 'remove') el.remove()
        else (el as HTMLElement).style?.setProperty('display', 'none', 'important')
      }
    }
  }
  apply()
  new (win as Window & typeof globalThis).MutationObserver(() => {
    if (queued) return
    queued = true
    win.setTimeout(apply, 250)
  }).observe(doc, { childList: true, subtree: true })
}

export function applyAdCosmetics(win: Window, pageUrl: string) {
  const start = () => {
    const c = pageCosmetics(pageUrl)
    if (!c) return
    runScriptlets(win, c.scripts)
    addStyle(win.document, c.styles)
    void loadLibs().then(([content, sel]) => {
      // generic rules for what the page contains, now and as it changes
      const monitor = new content.DOMMonitor((update) => {
        if (update.type === 'features') addStyle(win.document, domCosmetics(pageUrl, update))
      })
      const watch = () => monitor.start(win as Window & typeof globalThis)
      if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', watch, { once: true })
      else watch()
      if (c.extended.length) {
        const run = () => procedural(win, c.extended, sel)
        if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', run, { once: true })
        else run()
      }
    })
  }
  // the engine normally is loaded already (synchronously, before the page's scripts); on a very first page it arrives a
  // moment late, and scriptlets run late too
  if (adBlockerReady()) start()
  else void loadAdBlocker().then(start)
}
