// A small, safe renderer for the model's replies: paragraphs, lists, headings, tables, quotes, code (with a copy
// button), and bold/italic/inline code/links. Everything is built from React elements (never injected HTML). Links open in a
// new Shasta tab and only for http(s) addresses.
import { Fragment, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noreferrer noopener"
      className="text-shasta-accent underline-offset-2 hover:underline"
      onClick={(e) => {
        e.preventDefault()
        // loaded on demand: the tab store pulls in the proxy engine, which a text renderer should not need
        void import('@/stores/tabsStore').then((m) => m.useTabs.getState().newTab(href))
      }}
    >
      {children}
    </a>
  )
}

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}${i}`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={k} className="rounded bg-shasta-field px-1.5 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={k} className="font-semibold">{inline(part.slice(2, -2), k)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)
    if (link) return <Link key={k} href={link[2]}>{link[1]}</Link>
    return <Fragment key={k}>{part}</Fragment>
  })
}

export type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; text: string; level: number }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'code'; text: string; lang: string }
  | { t: 'quote'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' }

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
const isRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const UL = /^\s*([-*•])\s+/
const OL = /^\s*\d+[.)]\s+/

export function parseBlocks(md: string): Block[] {
  const out: Block[] = []
  const lines = md.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*```\s*([\w+-]*)/.exec(line)
    if (fence) {
      const body: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i])
      out.push({ t: 'code', text: body.join('\n'), lang: fence[1] })
    } else if (/^#{1,6}\s+/.test(line)) out.push({ t: 'h', text: line.replace(/^#{1,6}\s+/, ''), level: /^#+/.exec(line)![0].length })
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) out.push({ t: 'hr' })
    else if (line.includes('|') && i + 1 < lines.length && isRule(lines[i + 1]) && !isRule(line)) {
      const head = cells(line)
      const rows: string[][] = []
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]))
      i--
      out.push({ t: 'table', head, rows })
    } else if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line)
      const re = ordered ? OL : UL
      const items: string[] = []
      for (; i < lines.length && re.test(lines[i]); i++) items.push(lines[i].replace(re, ''))
      i--
      out.push(ordered ? { t: 'ol', items } : { t: 'ul', items })
    } else if (/^\s*>\s?/.test(line)) {
      const q: string[] = []
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''))
      i--
      out.push({ t: 'quote', text: q.join('\n') })
    } else if (line.trim()) {
      const para: string[] = [line]
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*(```|#{1,6}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i + 1]) && !(lines[i + 1].includes('|') && lines[i + 2] && isRule(lines[i + 2]))) para.push(lines[++i])
      out.push({ t: 'p', text: para.join('\n') })
    }
  }
  return out
}

function CodeBlock({ text, lang }: { text: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-shasta-line bg-shasta-field/70">
      <div className="flex items-center justify-between border-b border-shasta-line px-3 py-1.5 text-xs text-shasta-muted">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-shasta-hover hover:text-shasta-fg"
          onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => undefined)}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed"><code>{text}</code></pre>
    </div>
  )
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 break-words text-[15px] leading-7">
      {parseBlocks(text).map((b, i) => {
        const k = `b${i}`
        switch (b.t) {
          case 'code': return <CodeBlock key={k} text={b.text} lang={b.lang} />
          case 'h': return <p key={k} className={b.level <= 2 ? 'pt-1 text-lg font-semibold' : 'pt-0.5 font-semibold'}>{inline(b.text, k)}</p>
          case 'hr': return <hr key={k} className="border-shasta-line" />
          case 'quote': return <blockquote key={k} className="border-l-2 border-shasta-line pl-3 text-shasta-muted">{inline(b.text, k)}</blockquote>
          case 'ul': return <ul key={k} className="list-disc space-y-1.5 pl-6 marker:text-shasta-muted">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>
          case 'ol': return <ol key={k} className="list-decimal space-y-1.5 pl-6 marker:text-shasta-muted">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>
          case 'table':
            return (
              <div key={k} className="overflow-x-auto rounded-xl border border-shasta-line">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-shasta-field"><tr>{b.head.map((h, j) => <th key={j} className="px-3 py-2 font-medium">{inline(h, `${k}h${j}`)}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j} className="border-t border-shasta-line">{r.map((c, n) => <td key={n} className="px-3 py-2 align-top">{inline(c, `${k}${j}${n}`)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )
          default: return <p key={k} className="whitespace-pre-wrap">{inline(b.text, k)}</p>
        }
      })}
    </div>
  )
}
