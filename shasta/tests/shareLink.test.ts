import { afterEach, describe, expect, test, vi } from 'vitest'

// node has no `location`: give the module a hosted page to share from
const at = (href: string) => vi.stubGlobal('location', new URL(href))

describe('share links for Store pages', async () => {
  const { shareLinkFor, sharedStorePath } = await import('@/lib/shareLink')
  afterEach(() => vi.unstubAllGlobals())

  test('Store listings, storefronts and running apps get an https link; other Shasta pages none', () => {
    at('https://shasta.example/')
    expect(shareLinkFor('shasta://store#/app/click-quest')).toBe('https://shasta.example/?app=click-quest')
    expect(shareLinkFor('shasta://store#/storefront/alex-games')).toBe('https://shasta.example/?storefront=alex-games')
    expect(shareLinkFor('game://click-quest/level/2')).toBe('https://shasta.example/?app=click-quest')
    expect(shareLinkFor('shasta://settings')).toBeNull()
    expect(shareLinkFor('shasta://store#/admin/reports')).toBeNull()
  })

  test('no link from a page with no web address (the installed app without VITE_SHARE_ORIGIN)', () => {
    at('isolated-app://abc/')
    expect(shareLinkFor('shasta://store#/app/click-quest')).toBeNull()
  })

  test('opening a link: only plain slugs become a Store path', () => {
    expect(sharedStorePath('?app=Click-Quest')).toBe('/app/click-quest')
    expect(sharedStorePath('?storefront=alex-games&x=1')).toBe('/storefront/alex-games')
    expect(sharedStorePath('?app=../admin')).toBeNull()
    expect(sharedStorePath('?app=a%2F..%2Fadmin')).toBeNull()
    expect(sharedStorePath('?online')).toBeNull()
  })
})
