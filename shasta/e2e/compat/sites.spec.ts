// Compatibility checks against real third-party sites. These depend on the network and on the
// sites themselves, so failures here are not necessarily Shasta bugs. Run with: bun run test:compat
import { test, expect } from '@playwright/test'
import { activeTab, openShasta, visit, pageFrame } from '../support/helpers'

test.use({ baseURL: 'http://localhost:4173', locale: 'en-US' })

// COMPAT_WISP=ws://... runs the same checks through another relay (e.g. a production one), so sites see its address.
const REMOTE_WISP = process.env.COMPAT_WISP
if (REMOTE_WISP) {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((url) => localStorage.setItem('shasta-settings', JSON.stringify({ state: { settings: { wispUrl: url } }, version: 6 })), REMOTE_WISP)
  })
}

test("sends the browser's language, not the relay's country", async ({ page }) => {
  await openShasta(page)
  await visit(page, 'httpbin.org/headers', 'httpbin')
  await expect(pageFrame(page).locator('body')).toContainText('"Accept-Language": "en-US')
  await visit(page, 'www.google.com', 'Google')
  await expect(pageFrame(page).locator('html')).toHaveAttribute('lang', /^en/)
})

test('example.com loads through the proxy', async ({ page }) => {
  await openShasta(page)
  await visit(page, 'example.com', 'Example Domain')
  // the page's wording changes now and then (2026: a multilingual notice instead of the old heading)
  await expect(pageFrame(page).getByText(/documentation examples/i).first()).toBeVisible()
})

test('wikipedia loads with its title and favicon', async ({ page }) => {
  await openShasta(page)
  await visit(page, 'en.wikipedia.org/wiki/Mount_Shasta', 'Mount Shasta')
  await expect(activeTab(page).locator('img')).toBeVisible({ timeout: 20_000 })
})

test('search results load for a query', async ({ page }) => {
  await openShasta(page)
  await visit(page, 'mount shasta weather', 'mount shasta weather')
})
