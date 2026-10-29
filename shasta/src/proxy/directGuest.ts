// The content script every direct tab (a <controlledframe>) runs in the site's isolated world: the page's own
// scripts cannot see its variables. It is the only link between the site and Shasta's shell.
//
// Messages to the shell carry a per-frame token that exists only in this script's code, so a page that grabs the
// shell's window from the "hello" message still cannot forge them. Messages from the shell are accepted only from
// the window that said hello (a page posting to itself has itself as `source`).

export interface GuestOptions {
  token: string
  /** production builds block the devtools shortcuts in pages too (a deterrent, see lib/devtoolsGuard.ts) */
  blockDevtools: boolean
}

/** Runs inside the site. Self-contained on purpose: it is shipped as `guest.toString()`. */
function guest(opts: GuestOptions) {
  const w = window as Window & { __shastaGuest?: boolean }
  if (w.__shastaGuest) return
  w.__shastaGuest = true

  let shell: Window | null = null
  let lastTitle = ''
  let lastUrl = ''
  let target: Element | null = null
  const send = (m: Record<string, unknown>) => {
    if (!shell) return
    try {
      shell.postMessage({ ...m, $shasta: opts.token }, '*')
    } catch {
      /* the shell went away */
    }
  }
  const readable = () => {
    const root = document.querySelector('main, article, [role="main"]') || document.body
    let text = root ? (root as HTMLElement).innerText : ''
    if (text.length < 400 && document.body && root !== document.body) text = document.body.innerText
    return (text || '').replace(/\n{3,}/g, '\n\n').slice(0, 30000)
  }
  const report = () => {
    if (document.title !== lastTitle || location.href !== lastUrl) {
      lastTitle = document.title
      lastUrl = location.href
      send({ type: 'state', title: lastTitle, url: lastUrl })
    }
  }
  const favicon = async () => {
    const link = document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null
    const href = (link && link.href) || location.origin + '/favicon.ico'
    try {
      const res = await fetch(href, { credentials: 'omit' })
      const blob = await res.blob()
      if (!res.ok || blob.size > 200_000 || !/^image\//.test(blob.type)) return
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(blob)
      })
      send({ type: 'favicon', origin: location.origin, dataUrl })
    } catch {
      /* no icon, or one on another origin that does not allow reading it */
    }
  }

  window.addEventListener('message', (e) => {
    const d = e.data as { $shastaHello?: boolean; cmd?: string; op?: string; text?: string; id?: number } | null
    if (!d || typeof d !== 'object') return
    if (d.$shastaHello) {
      // the hello comes from the app that embeds this frame, and only it lives on isolated-app:
      if (!String(e.origin).startsWith('isolated-app:') || !e.source) return
      shell = e.source as Window
      lastTitle = ''
      lastUrl = ''
      report()
      void favicon()
      send({ type: 'text', text: readable() })
      return
    }
    if (!shell || e.source !== shell) return
    if (d.cmd === 'text') send({ type: 'text', id: d.id, text: readable() })
    else if (d.cmd === 'exec') {
      const field = target as HTMLInputElement | null
      if (field && field.focus) field.focus()
      if (d.op === 'paste' && typeof d.text === 'string') document.execCommand('insertText', false, d.text)
      else if (d.op === 'cut') document.execCommand('delete')
      else if (d.op === 'selectAll') {
        if (field && 'select' in field) field.select()
        else document.execCommand('selectAll')
      }
    }
  })

  setInterval(report, 1000)
  window.addEventListener('popstate', report)
  window.addEventListener('hashchange', report)

  let selTimer = 0
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer)
    selTimer = window.setTimeout(() => send({ type: 'selection', text: String(getSelection() || '').slice(0, 4000) }), 300)
  })

  const devtools = (e: KeyboardEvent) => {
    const k = e.key.toUpperCase()
    const mod = e.ctrlKey || e.metaKey
    return e.key === 'F12' || (mod && e.shiftKey && 'IJC'.includes(k)) || (e.metaKey && e.altKey && 'IJCU'.includes(k)) || (e.ctrlKey && k === 'U')
  }
  window.addEventListener(
    'keydown',
    (e) => {
      if (opts.blockDevtools && devtools(e)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (!(e.ctrlKey || e.metaKey || e.altKey) && !/^F\d+$/.test(e.key)) return
      send({ type: 'key', key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, repeat: e.repeat })
    },
    true,
  )

  // bubble phase: a page that handles its own context menu (games, editors) prevents the default first and keeps it
  window.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented || document.pointerLockElement) return
    e.preventDefault()
    const node = e.target as Node | null
    const el = node && node.nodeType === 1 ? (node as Element) : node ? node.parentElement : null
    const link = el ? (el.closest('a[href], area[href]') as HTMLAnchorElement | null) : null
    const img = el ? (el.closest('img') as HTMLImageElement | null) : null
    const field = el ? (el.closest('input, textarea, [contenteditable]') as HTMLElement | null) : null
    const editable =
      !!field &&
      ((field.tagName === 'INPUT' && /^(text|search|url|tel|email|password|number|)$/i.test((field as HTMLInputElement).type)) ||
        (field.tagName === 'TEXTAREA' && !(field as HTMLTextAreaElement).readOnly) ||
        (field.isContentEditable && field.getAttribute('contenteditable') !== 'false'))
    let selection = ''
    if (field && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA')) {
      const f = field as HTMLInputElement
      try {
        selection = f.value.slice(f.selectionStart || 0, f.selectionEnd || 0)
      } catch {
        selection = ''
      }
    } else selection = String(getSelection() || '')
    target = editable ? field : null
    send({ type: 'context', x: e.clientX, y: e.clientY, linkUrl: link ? link.href : null, imageUrl: img ? img.currentSrc || img.src : null, selection: selection.slice(0, 2000), editable })
  })
}

export const guestScript = (opts: GuestOptions): string => `(${guest.toString()})(${JSON.stringify(opts)});`
