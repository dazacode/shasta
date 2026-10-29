import { describe, expect, it } from 'vitest'
import { childrenOf, exportBookmarksHtml, suggest, type BookmarkNode, type HistoryEntry } from '@/stores/libraryStore'

const bm = (id: string, title: string, url: string, parentId: string | null = null): BookmarkNode => ({ id, type: 'bookmark', title, url, parentId, createdAt: 1 })
const folder = (id: string, title: string, parentId: string | null = null): BookmarkNode => ({ id, type: 'folder', title, parentId, createdAt: 1 })
const visit = (id: string, url: string, title: string, visitedAt = Date.now()): HistoryEntry => ({ id, url, title, origin: new URL(url).origin, visitedAt })

describe('suggest', () => {
  const bookmarks = [bm('1', 'Wikipedia', 'https://en.wikipedia.org/'), bm('2', 'Mount Shasta guide', 'https://shasta.example/guide')]
  const history = [visit('a', 'https://news.example/shasta-snow', 'Shasta snow report'), visit('b', 'https://en.wikipedia.org/wiki/Mount_Shasta', 'Mount Shasta - Wikipedia')]

  it('returns nothing for empty input', () => {
    expect(suggest('  ', bookmarks, history)).toEqual([])
  })

  it('matches against url and title across bookmarks and history', () => {
    const urls = suggest('shasta', bookmarks, history).map((s) => s.url)
    expect(urls).toContain('https://shasta.example/guide')
    expect(urls).toContain('https://news.example/shasta-snow')
  })

  it('ranks host prefix matches first and marks bookmarks', () => {
    const [first] = suggest('wiki', bookmarks, history)
    expect(first.url).toBe('https://en.wikipedia.org/')
    expect(first.kind).toBe('bookmark')
  })

  it('requires every term to match', () => {
    expect(suggest('shasta zebra', bookmarks, history)).toEqual([])
  })

  it('never suggests internal pages', () => {
    expect(suggest('settings', [bm('x', 'Settings', 'shasta://settings')], [])).toEqual([])
  })
})

describe('bookmark export', () => {
  it('writes the Netscape format with nested folders and escapes markup', () => {
    const nodes = [folder('f', 'Reading <list>'), bm('1', 'A & B', 'https://a.test/?x=1&y="2"', 'f'), bm('2', 'Root', 'https://root.test/')]
    const html = exportBookmarksHtml(nodes)
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true)
    expect(html).toContain('<H3 ADD_DATE="0">Reading &lt;list&gt;</H3>')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('HREF="https://a.test/?x=1&amp;y=&quot;2&quot;"')
    expect(html.indexOf('Reading')).toBeLessThan(html.indexOf('Root'))
  })

  it('lists folders before bookmarks', () => {
    const nodes = [bm('1', 'b', 'https://b.test/'), folder('f', 'z')]
    expect(childrenOf(nodes, null).map((n) => n.type)).toEqual(['folder', 'bookmark'])
  })
})
