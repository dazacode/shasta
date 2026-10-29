// The ad blocker on a real site with ads: fiveplay.lol (the Store's GTA 5 link) loads Monetag from rotating domains.
// With blocking on, Monetag's loader never runs (it defines window.AMSP); with it off, it does. Needs the network.
import { test, expect, type Page } from '@playwright/test'
import { go, openShasta, pageFrame } from '../support/helpers'

test.use({ baseURL: 'http://localhost:4173', locale: 'en-US' })

const withSettings = (page: Page, blockAds: boolean) =>
  page.addInitScript((on) => localStorage.setItem('shasta-settings', JSON.stringify({ state: { settings: { blockAds: on } }, version: 6 })), blockAds)

async function openFiveplay(page: Page) {
  await openShasta(page)
  await go(page, 'https://fiveplay.lol/')
  await expect(pageFrame(page).locator('#canvas')).toBeAttached({ timeout: 45_000 })
  // give the async ad tags time to arrive and run
  await page.waitForTimeout(8000)
  const frame = page.frames().find((f) => f.url().includes('fiveplay.lol'))
  if (!frame) throw new Error('no fiveplay frame')
  return frame
}

test('ads on fiveplay.lol are blocked', async ({ page }) => {
  test.setTimeout(120_000)
  await withSettings(page, true)
  const frame = await openFiveplay(page)
  expect(await frame.evaluate(() => typeof (window as unknown as { AMSP?: unknown }).AMSP)).toBe('undefined')
  // element hiding from the filter lists is in the page
  expect(await frame.evaluate(() => document.querySelectorAll('style[data-shasta=adblock]').length)).toBeGreaterThan(0)
})

test('the same ads load with blocking off (the check above is meaningful)', async ({ page }) => {
  test.setTimeout(120_000)
  await withSettings(page, false)
  const frame = await openFiveplay(page)
  expect(await frame.evaluate(() => typeof (window as unknown as { AMSP?: unknown }).AMSP)).toBe('object')
})

// cnn.com has uBlock Origin scriptlets (+js set-constant on FAVE.settings.ads...): they must be running in the page,
// and a generic ad container added later must be hidden by the rules for what the page contains
test('scriptlets and generic element hiding run inside proxied pages', async ({ page }) => {
  test.setTimeout(120_000)
  await withSettings(page, true)
  await openShasta(page)
  await go(page, 'https://www.cnn.com/')
  await expect(pageFrame(page).locator('body')).toBeAttached({ timeout: 45_000 })
  await expect.poll(() => page.frames().find((f) => f.url().includes('cnn.com')) ?? null, { timeout: 45_000 }).not.toBeNull()
  const frame = page.frames().find((f) => f.url().includes('cnn.com'))!
  await expect
    .poll(() => frame.evaluate(() => {
      const w = window as unknown as { FAVE: unknown }
      w.FAVE = { settings: { ads: { ssai: { prod: { clips: { enabled: true } } } } } }
      return (w.FAVE as { settings: { ads: { ssai: { prod: { clips: { enabled: boolean } } } } } }).settings.ads.ssai.prod.clips.enabled
    }), { timeout: 20_000 })
    .toBe(false)
  await frame.evaluate(() => {
    const d = document.createElement('div')
    d.id = 'ad_container'
    d.textContent = 'ad'
    document.body.appendChild(d)
  })
  await expect.poll(() => frame.evaluate(() => getComputedStyle(document.getElementById('ad_container')!).display), { timeout: 10_000 }).toBe('none')
})
