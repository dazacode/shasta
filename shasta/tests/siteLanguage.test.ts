import { describe, expect, it } from 'vitest'
import { acceptLanguage, googleLocale, withAcceptLanguage } from '@/lib/siteLanguage'

describe('acceptLanguage', () => {
  it('weights languages like Chrome', () => {
    expect(acceptLanguage(['en-US', 'en', 'de'])).toBe('en-US,en;q=0.9,de;q=0.8')
  })

  it('falls back to English and drops junk', () => {
    expect(acceptLanguage([])).toBe('en-US,en;q=0.9')
    expect(acceptLanguage(['fr-FR', 'x\r\ninjected: 1', 'fr-FR'])).toBe('fr-FR')
  })
})

describe('withAcceptLanguage', () => {
  it('adds the header when missing', () => {
    const headers: [string, string][] = [['accept', 'text/html']]
    withAcceptLanguage(headers, ['en-US', 'en'])
    expect(headers).toContainEqual(['Accept-Language', 'en-US,en;q=0.9'])
  })

  it('keeps one the page set itself', () => {
    const headers: [string, string][] = [['accept-language', 'ja']]
    withAcceptLanguage(headers, ['en-US'])
    expect(headers).toEqual([['accept-language', 'ja']])
  })
})

describe('googleLocale', () => {
  const at = (u: string, langs = ['en-US', 'en']) => googleLocale(new URL(u), langs)?.href ?? null

  it('adds language and country to Google pages', () => {
    expect(at('https://www.google.com/')).toBe('https://www.google.com/?hl=en&gl=us')
    expect(at('https://www.google.com/search?q=weather')).toBe('https://www.google.com/search?q=weather&hl=en&gl=us')
    expect(at('https://www.google.co.uk/search?q=x', ['fr'])).toBe('https://www.google.co.uk/search?q=x&hl=fr')
  })

  it('leaves everything else alone', () => {
    expect(at('https://www.google.com/search?q=x&hl=de')).toBeNull()
    expect(at('https://www.google.com/maps')).toBeNull()
    expect(at('https://google.evil.com/')).toBeNull()
    expect(at('https://example.com/')).toBeNull()
    expect(at('https://www.google.com/', [])).toBeNull()
  })
})
