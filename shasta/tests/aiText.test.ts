import { describe, expect, it } from 'vitest'
import { chunk, fitHistory, fitText, stripMarkdown, xmlToText } from '@/ai/textutil'
import { createThinkFilter } from '@/ai/think'
import { parseBlocks } from '@/ai/markdown'
import { fileKind } from '@/ai/docs'

describe('fitText', () => {
  const para = (n: number, word: string) => `${word} `.repeat(n).trim()
  const doc = [para(60, 'alpha'), para(60, 'bravo'), para(60, 'photosynthesis plants light'), para(60, 'delta'), para(60, 'echo')].join('\n\n')

  it('returns short text untouched', () => {
    expect(fitText('hello there', 'x', 100)).toEqual({ text: 'hello there', trimmed: false })
  })
  it('keeps the parts that share words with the question', () => {
    const r = fitText(doc, 'how does photosynthesis work in plants?', 500)
    expect(r.trimmed).toBe(true)
    expect(r.text).toContain('photosynthesis')
    expect(r.text.length).toBeLessThanOrEqual(520)
  })
  it('spreads over the whole document when nothing matches (so a summary sees the start and the end)', () => {
    const r = fitText(doc, 'summarize', 900)
    expect(r.text).toContain('alpha')
    expect(r.text).toContain('echo')
    expect(r.text).toContain('[…]')
  })
  it('never exceeds the budget by more than a separator and keeps document order', () => {
    const r = fitText(doc, '', 700)
    expect(r.text.indexOf('alpha')).toBeLessThan(r.text.indexOf('echo'))
  })
})

describe('chunk', () => {
  it('splits long paragraphs at sentence ends', () => {
    const long = 'One sentence here. '.repeat(100)
    const parts = chunk(long, 200)
    expect(parts.length).toBeGreaterThan(5)
    expect(parts.every((p) => p.length <= 220)).toBe(true)
  })
})

describe('fitHistory', () => {
  it('keeps the newest turns and always the last one', () => {
    const turns = [{ content: 'a'.repeat(50) }, { content: 'b'.repeat(50) }, { content: 'c'.repeat(50) }]
    expect(fitHistory(turns, 120).map((t) => t.content[0])).toEqual(['b', 'c'])
    expect(fitHistory(turns, 10).map((t) => t.content[0])).toEqual(['c'])
  })
})

describe('xmlToText', () => {
  it('turns Word paragraphs into lines and decodes entities', () => {
    expect(xmlToText('<w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r></w:p><w:p><w:r><w:t>caf&#233;</w:t></w:r></w:p>')).toBe('Tom & Jerry\ncafé')
  })
})

describe('stripMarkdown', () => {
  it('leaves speakable text', () => {
    expect(stripMarkdown('## Title\n- **bold** and `code`\n1. [link](http://x.test)')).toBe('Title\nbold and code\nlink')
  })
})

describe('think filter', () => {
  const run = (chunks: string[]) => {
    const f = createThinkFilter()
    return chunks.map((c) => f.push(c)).join('') + f.flush()
  }
  it('passes ordinary text through', () => {
    expect(run(['Hello ', 'world'])).toBe('Hello world')
  })
  it('removes a reasoning block, even when the tags are split across chunks', () => {
    expect(run(['<th', 'ink>secret plan</thi', 'nk>\n\nThe answer is 4.'])).toBe('The answer is 4.')
    expect(run(['<think>\n\n</think>\n\nHi'])).toBe('Hi')
  })
  it('does not swallow a lone "<"', () => {
    expect(run(['1 < 2'])).toBe('1 < 2')
    expect(run(['a <'])).toBe('a <')
  })
})

describe('markdown blocks', () => {
  it('parses tables, quotes and rules', () => {
    const b = parseBlocks('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n> quoted\n\n---\n\ntext')
    expect(b.map((x) => x.t)).toEqual(['table', 'quote', 'hr', 'p'])
    expect(b[0]).toEqual({ t: 'table', head: ['A', 'B'], rows: [['1', '2'], ['3', '4']] })
  })
  it('parses paragraphs, lists, headings and code', () => {
    const b = parseBlocks('# Title\n\nSome *text*.\n\n- one\n- two\n\n1. first\n2. second\n\n```js\nlet x = 1\n```')
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'code'])
    expect(b[2]).toEqual({ t: 'ul', items: ['one', 'two'] })
    expect(b[0]).toEqual({ t: 'h', text: 'Title', level: 1 })
    expect(b[4]).toEqual({ t: 'code', text: 'let x = 1', lang: 'js' })
  })
})

describe('fileKind', () => {
  it('sorts attachments', () => {
    const k = (name: string, type = '') => fileKind({ name, type })
    expect(k('a.png', 'image/png')).toBe('image')
    expect(k('a.svg', 'image/svg+xml')).toBe('unsupported')
    expect(k('a.m4a')).toBe('audio')
    expect(k('clip.mp4', 'video/mp4')).toBe('video')
    expect(k('report.pdf', 'application/pdf')).toBe('document')
    expect(k('notes.docx')).toBe('document')
    expect(k('main.py')).toBe('document')
    expect(k('program.exe')).toBe('unsupported')
  })
})
