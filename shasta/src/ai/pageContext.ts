// Reads the page in the active tab so the assistant can summarize it or answer questions about it. Proxied pages run on
// Shasta's own origin through the proxy, so the shell can read their document directly; nothing is injected into them.
import * as proxy from '@/proxy/scramjetAdapter'
import * as direct from '@/proxy/directFrame'
import { useTabs } from '@/stores/tabsStore'
import { tabTitle, tabUrl } from '@/lib/tabModel'
import { isInternalUrl } from '@/lib/url'
import type { PageInfo } from './prompts'

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'SELECT', 'TEMPLATE', 'HEAD'])
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BR', 'BLOCKQUOTE', 'PRE', 'TABLE', 'DD', 'DT', 'FIGCAPTION', 'MAIN', 'HEADER'])

function collect(node: Node, out: string[], budget: { left: number }) {
  if (budget.left <= 0) return
  if (node.nodeType === 3) {
    const t = (node.nodeValue ?? '').replace(/\s+/g, ' ')
    if (t.trim()) {
      out.push(t)
      budget.left -= t.length
    }
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  if (SKIP.has(el.tagName.toUpperCase()) || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden') || (el as HTMLElement).style?.display === 'none') return
  const block = BLOCK.has(el.tagName.toUpperCase())
  if (block) out.push('\n')
  for (const child of el.childNodes) collect(child, out, budget)
  if (block) out.push('\n')
}

/** The readable text of a document: the main content when the page has one, otherwise the whole body. */
export function readableText(doc: Document, max = 30_000): string {
  const root = doc.querySelector('main, article, [role="main"]') ?? doc.body
  if (!root) return ''
  const pick = (el: Element) => {
    const out: string[] = []
    collect(el, out, { left: max })
    return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  let text = pick(root)
  if (text.length < 400 && root !== doc.body && doc.body) text = pick(doc.body)
  return text.slice(0, max)
}

function frameDoc(tabId: string): Document | null {
  try {
    return proxy.byTab.get(tabId)?.iframe.contentDocument ?? null
  } catch {
    return null
  }
}

/** The active tab's page, or null for Shasta's own pages and tabs that have nothing loaded. */
export function readActivePage(): PageInfo | null {
  const { tabs, activeId } = useTabs.getState()
  const tab = tabs.find((t) => t.id === activeId)
  if (!tab) return null
  const url = tabUrl(tab)
  if (isInternalUrl(url)) return null
  const doc = frameDoc(tab.id)
  // a direct tab (installed app) runs in another process: its guest script reports the text instead
  const text = doc ? readableText(doc) : (direct.pageText(tab.id) ?? '')
  return text.length < 40 ? null : { title: tabTitle(tab), url, text }
}

export function readSelection(tabId: string): string {
  if (direct.owns(tabId)) return direct.selectionOf(tabId).trim()
  try {
    return (frameDoc(tabId)?.defaultView?.getSelection()?.toString() ?? '').trim().slice(0, 4000)
  } catch {
    return ''
  }
}

/** Copies a picture from a page into a Blob (the page runs on Shasta's origin through the proxy, so the canvas stays clean). */
export async function imageToBlob(el: Element): Promise<Blob> {
  const img = el as HTMLImageElement
  if (!img.naturalWidth) throw new Error('The picture has not loaded.')
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the picture.'))), 'image/jpeg', 0.85))
}
