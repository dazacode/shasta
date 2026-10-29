// Turns an attached file into text the model can read. Everything happens in the page: the file never leaves the device.
import { unzipSync } from 'fflate'
import { xmlToText } from './textutil'

export const MAX_DOC_BYTES = 25 * 1024 * 1024
const MAX_CHARS = 200_000
const MAX_PDF_PAGES = 80

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yml|yaml|toml|ini|log|srt|vtt|tex|rtf|js|jsx|ts|tsx|mjs|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|swift|kt|sql|sh|bat|css|scss|lua|r)$/i
const OFFICE_EXT = /\.(docx|pptx|xlsx)$/i

export type FileKind = 'image' | 'audio' | 'video' | 'document' | 'unsupported'

export function fileKind(f: { name: string; type: string }): FileKind {
  if (f.type.startsWith('image/') && f.type !== 'image/svg+xml') return 'image'
  if (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|oga|opus|flac|aac|weba)$/i.test(f.name)) return 'audio'
  if (f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(f.name)) return 'video'
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || OFFICE_EXT.test(f.name) || f.type.startsWith('text/') || TEXT_EXT.test(f.name) || f.type === 'application/json') return 'document'
  if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name)) return 'image'
  return 'unsupported'
}

export interface ExtractedText {
  text: string
  /** where the text came from, e.g. "PDF, 12 pages" */
  summary: string
  truncated: boolean
}

const cap = (text: string): { text: string; truncated: boolean } => (text.length > MAX_CHARS ? { text: text.slice(0, MAX_CHARS), truncated: true } : { text, truncated: false })

async function pdfText(file: Blob): Promise<ExtractedText> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
    let text = ''
    for (let i = 1; i <= pages && text.length < MAX_CHARS; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let line = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        line += item.str
        line += item.hasEOL ? '\n' : ' '
      }
      text += `${line.trim()}\n\n`
      page.cleanup()
    }
    const c = cap(text)
    return { text: c.text, summary: `PDF, ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`, truncated: c.truncated || doc.numPages > pages }
  } finally {
    void task.destroy()
  }
}

function officeText(data: Uint8Array, name: string): ExtractedText {
  const ext = /\.(docx|pptx|xlsx)$/i.exec(name)![1].toLowerCase()
  const files = unzipSync(data, { filter: (f) => (ext === 'docx' ? f.name === 'word/document.xml' : ext === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(f.name) : f.name === 'xl/sharedStrings.xml') && f.originalSize < 40 * 1024 * 1024 })
  const dec = new TextDecoder()
  let text = ''
  let parts = 0
  if (ext === 'pptx') {
    const slides = Object.keys(files).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
    slides.forEach((n, i) => {
      text += `Slide ${i + 1}:\n${xmlToText(dec.decode(files[n]))}\n\n`
      parts++
    })
  } else if (ext === 'xlsx') {
    // the text cells; numbers and formulas are not included
    const xml = dec.decode(files['xl/sharedStrings.xml'] ?? new Uint8Array())
    text = [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => xmlToText(m[1])).join('\n')
    parts = 1
  } else {
    text = xmlToText(dec.decode(files['word/document.xml'] ?? new Uint8Array()))
    parts = 1
  }
  if (!parts || !text.trim()) throw new Error('That Office file has no readable text in it.')
  const c = cap(text)
  return { text: c.text, summary: ext === 'pptx' ? `PowerPoint, ${parts} slides` : ext === 'xlsx' ? 'Excel sheet (text cells)' : 'Word document', truncated: c.truncated }
}

function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript, svg').forEach((n) => n.remove())
  return (doc.body?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export async function extractText(file: File): Promise<ExtractedText> {
  if (file.size > MAX_DOC_BYTES) throw new Error(`${file.name} is larger than ${MAX_DOC_BYTES / 1048576} MB.`)
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfText(file)
  if (OFFICE_EXT.test(file.name)) return officeText(new Uint8Array(await file.arrayBuffer()), file.name)
  let text = await file.text()
  if (/\.html?$/i.test(file.name) || file.type === 'text/html') text = htmlText(text)
  if (text.includes('\u0000')) throw new Error(`${file.name} does not look like a text file.`)
  const c = cap(text)
  return { text: c.text, summary: 'Text file', truncated: c.truncated }
}
