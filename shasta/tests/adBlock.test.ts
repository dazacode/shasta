import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { POPUP_GESTURE_MS, domCosmetics, loadAdBlocker, pageCosmetics, matchAd, requestType, shouldBlockPopup } from '@/lib/adBlock'

// the real engine built from the filter lists (scripts/build-adblock.ts); skipped when it has not been built
const engineFile = path.resolve(__dirname, '../public/adblock/engine.bin')
const built = existsSync(engineFile)

describe('requestType', () => {
  it('maps fetch destinations to webRequest types', () => {
    expect(requestType('script')).toBe('script')
    expect(requestType('iframe')).toBe('sub_frame')
    expect(requestType('document')).toBe('main_frame')
    expect(requestType('style')).toBe('stylesheet')
    expect(requestType('')).toBe('xmlhttprequest')
  })
})

describe.skipIf(!built)('filter lists', () => {
  beforeAll(async () => {
    const bytes = readFileSync(engineFile)
    vi.stubGlobal('fetch', async () => new Response(bytes))
    expect(await loadAdBlocker()).not.toBeNull()
    vi.unstubAllGlobals()
  })

  it('blocks ad networks, including Monetag on rotating domains', () => {
    const page = 'https://fiveplay.lol/'
    expect(matchAd(new URL('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'), 'script', page)).not.toBeNull()
    expect(matchAd(new URL('https://quge5.com/88/tag.min.js'), 'script', page)).not.toBeNull()
    expect(matchAd(new URL('https://alwingulla.com/88/tag.min.js'), 'script', page)).not.toBeNull()
    // the loader the page injects from an inline script; caught by scripts/adblock-extra.txt, on any domain
    expect(matchAd(new URL('https://alwingulla.com/tag.min.js'), 'script', page)).not.toBeNull()
    expect(matchAd(new URL('https://brand-new-domain.com/71/tag.min.js'), 'script', page)).not.toBeNull()
  })

  it('leaves the site itself alone', () => {
    expect(matchAd(new URL('https://fiveplay.lol/b/8b0b5899ed/loader.js'), 'script', 'https://fiveplay.lol/')).toBeNull()
    expect(matchAd(new URL('https://www.wikipedia.org/'), 'document')).toBeNull()
  })

  it('catches the zone loaders Monetag fetches next', () => {
    const page = 'https://fiveplay.lol/'
    expect(matchAd(new URL('https://some-new-host.com/vignette.min.js?z=11993929'), 'script', page)).not.toBeNull()
    expect(matchAd(new URL('https://some-new-host.com/pfe/current/tag.min.js?z=11993930'), 'script', page)).not.toBeNull()
  })

  it('gives a page its site rules, scriptlets and procedural selectors', () => {
    const fb = pageCosmetics('https://www.facebook.com/')
    expect(fb?.scripts.length).toBeGreaterThan(0)
    expect(fb?.extended.length).toBeGreaterThan(0)
    expect(pageCosmetics('https://fiveplay.lol/')?.styles).toContain('display: none')
    expect(pageCosmetics('about:blank')).toBeNull()
  })

  it('hides generic ad containers that are actually in the page', () => {
    expect(domCosmetics('https://example.com/', { classes: [], ids: ['ad_container'], hrefs: [] })).toContain('#ad_container')
    expect(domCosmetics('https://example.com/', { classes: ['article-body'], ids: [], hrefs: [] })).toBe('')
  })
})

describe('shouldBlockPopup', () => {
  const on = { ads: true, popups: true }
  const now = 1_000_000
  const site = new URL('https://example.com/')

  it('allows a tab opened right after a click', () => {
    expect(shouldBlockPopup(site, now - 100, undefined, now, on)).toBe(false)
  })

  it('blocks one opened with no recent click', () => {
    expect(shouldBlockPopup(site, 0, undefined, now, on)).toBe(true)
    expect(shouldBlockPopup(site, now - POPUP_GESTURE_MS - 1, undefined, now, on)).toBe(true)
  })

  it('does nothing when switched off', () => {
    expect(shouldBlockPopup(site, 0, undefined, now, { ads: false, popups: false })).toBe(false)
  })
})
