import { describe, expect, it } from 'vitest'
import { displayUrl, internalPage, redactUrl, resolveInput, searchUrl } from '@/lib/url'

describe('resolveInput', () => {
  it('treats empty input as empty', () => {
    expect(resolveInput('   ', 'google')).toEqual({ kind: 'empty' })
  })

  it.each([
    ['example.com', 'https://example.com/'],
    ['www.example.com/path?q=1', 'https://www.example.com/path?q=1'],
    ['https://example.com/a b', null],
    ['http://example.com', 'http://example.com/'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['localhost', 'http://localhost/'],
    ['192.168.1.1/admin', 'http://192.168.1.1/admin'],
    ['en.wikipedia.org/wiki/Mount_Shasta', 'https://en.wikipedia.org/wiki/Mount_Shasta'],
  ])('resolves %s as an address', (input, url) => {
    const r = resolveInput(input, 'google')
    if (url) expect(r).toEqual({ kind: 'url', url })
    else expect(r.kind).toBe('search')
  })

  it('searches for anything that is not an address', () => {
    const r = resolveInput('mount shasta snow', 'duckduckgo')
    expect(r).toEqual({ kind: 'search', url: 'https://duckduckgo.com/?q=mount%20shasta%20snow', query: 'mount shasta snow' })
  })

  it('searches for a single word without a dot', () => {
    expect(resolveInput('weather', 'google').kind).toBe('search')
  })

  it('uses the selected engine and encodes the query', () => {
    expect(searchUrl('a&b=c', 'bing')).toBe('https://www.bing.com/search?q=a%26b%3Dc')
  })

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'blob:https://x/y', 'ftp://example.com', 'view-source:https://example.com', 'about:blank', 'chrome://settings'])(
    'refuses %s',
    (input) => {
      expect(resolveInput(input, 'google').kind).toBe('invalid')
    },
  )

  it('recognises Shasta pages and rejects unknown ones', () => {
    expect(resolveInput('shasta://history', 'google')).toEqual({ kind: 'internal', url: 'shasta://history' })
    expect(resolveInput('SHASTA://Settings#privacy', 'google')).toEqual({ kind: 'internal', url: 'shasta://settings#privacy' })
    expect(resolveInput('shasta://nope', 'google').kind).toBe('invalid')
    expect(internalPage('shasta://downloads')).toBe('downloads')
    expect(internalPage('shasta://store#/app/click-quest')).toBe('store')
    expect(internalPage('shasta://library')).toBe('library')
    expect(resolveInput('shasta://Library', 'google')).toEqual({ kind: 'internal', url: 'shasta://library' })
    expect(internalPage('shasta://app#3f9c')).toBe('app')
    expect(internalPage('shasta://store/../x')).toBe('store')
    expect(internalPage('https://example.com')).toBeNull()
  })

  it('does not treat a phrase containing a URL as an address', () => {
    expect(resolveInput('go to example.com now', 'google').kind).toBe('search')
  })
})

describe('display helpers', () => {
  it('shortens https URLs for display', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com')
    expect(displayUrl('https://example.com/a?b=1#c')).toBe('example.com/a?b=1#c')
    expect(displayUrl('http://example.com/')).toBe('http://example.com')
  })

  it('redacts query strings and hashes for logs', () => {
    expect(redactUrl('https://example.com/path?token=secret#frag')).toBe('https://example.com/path')
    expect(redactUrl('not a url')).toBe('')
  })
})

describe('installed app addresses', () => {
  it('parses app:// and game:// addresses', async () => {
    const { parseAppAddress, appAddress, appKeyOf, isInternalUrl } = await import('@/lib/url')
    expect(parseAppAddress('game://click-quest')).toEqual({ scheme: 'game', slug: 'click-quest', path: '' })
    expect(parseAppAddress('APP://Discord/channels/1?x=2')).toEqual({ scheme: 'app', slug: 'discord', path: '/channels/1?x=2' })
    expect(parseAppAddress('app://')).toBeNull()
    expect(parseAppAddress('app://-bad')).toBeNull()
    expect(parseAppAddress('app://has space')).toBeNull()
    expect(parseAppAddress('apps://x')).toBeNull()
    expect(appAddress('game', 'a')).toBe('game://a')
    expect(appKeyOf('game://click-quest')).toBe('click-quest')
    expect(appKeyOf('shasta://app#3f9c')).toBe('3f9c')
    expect(isInternalUrl('app://discord')).toBe(true)
    expect(isInternalUrl('https://example.com')).toBe(false)
  })
  it('resolves typed addresses to an app, never to the proxy', () => {
    expect(resolveInput('game://click-quest', 'google')).toEqual({ kind: 'app', url: 'game://click-quest', scheme: 'game', slug: 'click-quest', path: '' })
    expect(resolveInput('app://discord/channels/@me', 'google')).toMatchObject({ kind: 'app', slug: 'discord', path: '/channels/@me' })
    expect(internalPage('app://discord')).toBe('app')
    expect(internalPage('game://x')).toBe('app')
  })
})
