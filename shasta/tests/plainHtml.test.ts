import { describe, expect, it } from 'vitest'
import { servePlainAsHtml } from '@/proxy/plainHtml'

const page = new URL('https://cdn.jsdelivr.net/gh/freebuisness/html@main/554-fix2.html')

describe('servePlainAsHtml', () => {
  it('treats a jsDelivr .html navigation sent as text/plain as HTML', () => {
    expect(servePlainAsHtml(page, 'document', 'text/plain; charset=utf-8')).toBe(true)
    expect(servePlainAsHtml(page, 'iframe', 'text/plain')).toBe(true)
    expect(servePlainAsHtml(new URL('https://cdn.jsdelivr.net/npm/pkg@1/demo/index.htm'), 'document', 'text/plain')).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(servePlainAsHtml(page, 'script', 'text/plain')).toBe(false)
    expect(servePlainAsHtml(page, 'empty', 'text/plain')).toBe(false)
    expect(servePlainAsHtml(page, 'document', 'application/json')).toBe(false)
    expect(servePlainAsHtml(page, 'document', null)).toBe(false)
    expect(servePlainAsHtml(new URL('https://cdn.jsdelivr.net/gh/a/b@main/readme.txt'), 'document', 'text/plain')).toBe(false)
    expect(servePlainAsHtml(new URL('https://example.com/gh/a/b/x.html'), 'document', 'text/plain')).toBe(false)
  })
})
