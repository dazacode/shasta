// A page on jsDelivr arrives as text/plain (proxy/plainHtml.ts): opened in a tab it must run as HTML, not show source.
// gn-math's games live there (Yandere Simulator = 554-fix2.html, a Unity build). Needs the network.
import { test, expect } from '@playwright/test'
import { go, openShasta } from '../support/helpers'

test.use({ baseURL: 'http://localhost:4173', locale: 'en-US' })

test('a jsDelivr .html page opens as a page and the game starts', async ({ page }) => {
  test.setTimeout(120_000)
  await openShasta(page)
  await go(page, 'https://cdn.jsdelivr.net/gh/freebuisness/html@main/554-fix2.html')
  await expect.poll(() => page.frames().find((f) => f.url().includes('554-fix2.html')) ?? null, { timeout: 30_000 }).not.toBeNull()
  const f = page.frames().find((f) => f.url().includes('554-fix2.html'))!
  // rendered as HTML: the Unity container exists and no <pre> of source text
  await expect.poll(() => f.evaluate(() => !!document.getElementById('unityContainer') && !document.querySelector('body > pre')), { timeout: 30_000 }).toBe(true)
  await expect.poll(() => f.evaluate(() => document.querySelectorAll('canvas').length), { timeout: 60_000 }).toBeGreaterThan(0)
  await page.waitForTimeout(Number(process.env.WAIT_MS ?? 0))
  await page.screenshot({ path: test.info().outputPath('game.png') })
})
