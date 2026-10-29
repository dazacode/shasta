import { describe, expect, test } from 'vitest'
import { groupMessages, mergeMessages, parseInline, parseMessage, safeHref, type ChatMessage } from '@/lib/chatFormat'
import { internalPage, titleFor } from '@/lib/url'

describe('chat markdown', () => {
  test('plain text stays one text node, HTML is not interpreted', () => {
    expect(parseInline('hi <b>there</b> <img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: 'hi <b>there</b> <img src=x onerror=alert(1)>' }])
  })

  test('bold, italic, strike, spoiler, code', () => {
    expect(parseInline('**a** *b* _c_ ~~d~~ ||e|| `f`')).toEqual([
      { t: 'bold', c: [{ t: 'text', v: 'a' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'strike', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'spoiler', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'f' },
    ])
  })

  test('nesting and code content is literal', () => {
    expect(parseInline('**bold *it* x**')).toEqual([{ t: 'bold', c: [{ t: 'text', v: 'bold ' }, { t: 'italic', c: [{ t: 'text', v: 'it' }] }, { t: 'text', v: ' x' }] }])
    expect(parseInline('`**not bold**`')).toEqual([{ t: 'code', v: '**not bold**' }])
  })

  test('snake_case words are not italic, lone asterisks stay text', () => {
    expect(parseInline('my_var_name and 2 * 3')).toEqual([{ t: 'text', v: 'my_var_name and 2 * 3' }])
  })

  test('http(s) links become links without trailing punctuation', () => {
    expect(parseInline('see https://example.com/a?b=1.')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', href: 'https://example.com/a?b=1', v: 'https://example.com/a?b=1' },
      { t: 'text', v: '.' },
    ])
  })

  test('javascript: and data: are never links', () => {
    for (const s of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'JaVaScRiPt:alert(1)']) {
      expect(parseInline(s).every((n) => n.t === 'text')).toBe(true)
      expect(safeHref(s)).toBeNull()
    }
  })

  test('fenced code blocks', () => {
    expect(parseMessage('before\n```js\nconst a = **1**\n```\nafter')).toEqual([
      { t: 'para', c: [{ t: 'text', v: 'before' }] },
      { t: 'codeblock', lang: 'js', v: 'const a = **1**' },
      { t: 'para', c: [{ t: 'text', v: 'after' }] },
    ])
  })
})

const msg = (id: string, name: string, createdAt: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channelId: 'c',
  author: { name, color: null, bot: false, web: false, avatarUrl: null },
  content: id,
  createdAt,
  editedAt: null,
  attachments: [],
  replyTo: null,
  ...extra,
})

describe('chat grouping', () => {
  const t0 = new Date(2026, 9, 27, 12, 0).getTime()
  test('same author within 5 minutes is one group', () => {
    const rows = groupMessages([msg('1', 'a', t0), msg('2', 'a', t0 + 60_000), msg('3', 'b', t0 + 120_000), msg('4', 'b', t0 + 120_000 + 6 * 60_000)])
    expect(rows.map((r) => r.head)).toEqual([true, false, true, true])
    expect(rows.map((r) => r.newDay)).toEqual([true, false, false, false])
  })

  test('a web author with the same name as a Discord member is a different author; replies start a group; days split', () => {
    const web = { name: 'a', color: null, bot: false, web: true, avatarUrl: null }
    const rows = groupMessages([
      msg('1', 'a', t0),
      msg('2', 'a', t0 + 1000, { author: web }),
      msg('3', 'a', t0 + 2000, { author: web, replyTo: { id: '1', author: 'a', content: '1' } }),
      msg('4', 'a', t0 + 86_400_000, { author: web }),
    ])
    expect(rows.map((r) => r.head)).toEqual([true, true, true, true])
    expect(rows[3].newDay).toBe(true)
  })

  test('merge sorts, dedupes and takes the newer copy', () => {
    const merged = mergeMessages([msg('2', 'a', 2), msg('1', 'a', 1)], [msg('2', 'a', 2, { content: 'edited' }), msg('3', 'a', 3)])
    expect(merged.map((m) => m.id)).toEqual(['1', '2', '3'])
    expect(merged[1].content).toBe('edited')
  })
})

test('shasta://chat is an internal page', () => {
  expect(internalPage('shasta://chat')).toBe('chat')
  expect(titleFor('shasta://chat')).toBe('Chat')
})
