import type { ContextInfo } from './contextMenu'

const TEXT_INPUT = /^(text|search|url|tel|email|password|number|)$/i

/** Walks out of nested frames (same-origin, as Scramjet pages are) to turn a click position into shell coordinates. */
function toShellPoint(win: Window, x: number, y: number): { x: number; y: number } {
  let w: Window = win
  try {
    while (w !== w.parent) {
      const frame = w.frameElement
      if (!frame) break
      const r = frame.getBoundingClientRect()
      x += r.left
      y += r.top
      w = w.parent
    }
  } catch {
    /* a cross-origin parent: keep what we have */
  }
  return { x, y }
}

/** Reads a right-click: what is under the pointer (link, image, selection, text field) and where it is on screen. */
export function describeContext(win: Window, e: MouseEvent, inPage: boolean): ContextInfo {
  const node = e.target as Node | null
  const el = node && node.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null)
  const link = el?.closest('a[href], area[href]') as HTMLAnchorElement | null
  const img = el?.closest('img') as HTMLImageElement | null
  const field = el?.closest('input, textarea, [contenteditable]') as HTMLElement | null
  const editable =
    !!field &&
    ((field.tagName === 'INPUT' && TEXT_INPUT.test((field as HTMLInputElement).type)) ||
      (field.tagName === 'TEXTAREA' && !(field as HTMLTextAreaElement).readOnly) ||
      (field.isContentEditable && field.getAttribute('contenteditable') !== 'false'))

  let selection = ''
  if (field && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA')) {
    const f = field as HTMLInputElement
    try {
      selection = f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0)
    } catch {
      selection = ''
    }
  } else {
    selection = win.getSelection()?.toString() ?? ''
  }

  const { x, y } = toShellPoint(win, e.clientX, e.clientY)
  return {
    x,
    y,
    // `href` / `src` go through Scramjet's hooks inside proxied pages, so these are the real addresses
    linkUrl: link?.href ?? null,
    imageUrl: img ? img.currentSrc || img.src : null,
    imageElement: img,
    selection: selection.slice(0, 2000),
    editable,
    win,
    element: editable ? field : null,
    inPage,
  }
}

/** Runs an edit command in the document the click happened in. Paste reads the clipboard here, on the user's click. */
export async function runClipboard(info: ContextInfo, cmd: 'cut' | 'copy' | 'paste' | 'selectAll'): Promise<void> {
  if (info.exec) return info.exec(cmd)
  const doc = info.win?.document
  if (!doc) return
  const field = info.element as HTMLInputElement | null
  field?.focus?.()
  if (cmd === 'selectAll') {
    if (field && 'select' in field) field.select()
    else doc.execCommand('selectAll')
    return
  }
  if (cmd === 'paste') {
    try {
      const text = await navigator.clipboard.readText()
      doc.execCommand('insertText', false, text)
    } catch {
      // the browser withheld clipboard access: the keyboard shortcut still works
      throw new Error('Shasta was not allowed to read the clipboard. Use the Paste keyboard shortcut instead.')
    }
    return
  }
  if (!doc.execCommand(cmd) && cmd === 'copy' && info.selection) await navigator.clipboard.writeText(info.selection)
}
