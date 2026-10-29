import { test, expect } from '@playwright/test'
import { SITE, activeTab, go, openShasta, visit } from '../support/helpers'

const wisp = (state: 'on' | 'off', endpoint = 'main') => fetch(`http://localhost:4173/__ctl/wisp?state=${state}&endpoint=${endpoint}`)

test.afterEach(async () => {
  await wisp('on')
  await wisp('on', 'alt')
})

test('11. disconnecting the transport is reported and reconnecting recovers without a reload', async ({ page }) => {
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')

  await wisp('off')
  await page.evaluate(() => window.dispatchEvent(new Event('online'))) // nudge the health check
  const banner = page.getByRole('alert').filter({ hasText: /proxy server|interrupted/ })
  await expect(banner).toBeVisible({ timeout: 30_000 })

  // a navigation while disconnected fails with an accurate explanation, not a fake success
  await go(page, `${SITE}/b`)
  await expect(page.getByRole('heading', { name: /reach the proxy|took too long|couldn't be loaded/i })).toBeVisible({ timeout: 60_000 })
  await expect(activeTab(page)).toHaveAttribute('aria-label', /failed to load/)

  // it comes back by itself once the server does; "Retry now" just skips the wait
  await wisp('on')
  const retry = banner.getByRole('button', { name: 'Retry now' })
  if (await retry.isVisible()) await retry.click()
  await expect(banner).toHaveCount(0, { timeout: 45_000 })
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/, { timeout: 30_000 })
})

test('advanced settings report real connection status and diagnostics', async ({ page }) => {
  await openShasta(page)
  await go(page, 'shasta://settings#advanced')
  await expect(page.getByText(/^Connected/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Wisp server URL')).toHaveValue('ws://localhost:4173/wisp/')
  await expect(page.getByText('Service worker')).toBeVisible()
  await expect(page.getByLabel('Diagnostic log')).toContainText(/Proxy ready/)
})

test('an unreachable preferred Wisp server falls back to the next endpoint', async ({ page }) => {
  // nothing listens on 4199; this host's own /wisp/ always follows the person's endpoints
  await page.addInitScript(() => localStorage.setItem('shasta-settings', JSON.stringify({ state: { settings: { wispUrl: 'ws://localhost:4199/wisp/' } }, version: 6 })))
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')
  await go(page, 'shasta://settings#offline')
  await expect(page.getByRole('note')).toContainText('the Wisp relay (localhost:4173, connected now)')
  await go(page, 'shasta://settings#advanced')
  await expect(page.getByLabel('Diagnostic log')).toContainText('Wisp server localhost:4199 unreachable')
})

test('when the Wisp server in use goes away, the next endpoint takes over without a disconnection', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shasta-settings', JSON.stringify({ state: { settings: { wispUrl: 'ws://localhost:4173/wisp-alt/' } }, version: 6 })))
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')

  await wisp('off', 'alt')
  await page.evaluate(() => window.dispatchEvent(new Event('online'))) // nudge the health check
  await go(page, 'shasta://settings#advanced')
  await expect(page.getByLabel('Diagnostic log')).toContainText('Switched to Wisp server localhost:4173', { timeout: 30_000 })
  await expect(page.getByRole('alert').filter({ hasText: /proxy server|interrupted/ })).toHaveCount(0)
  await visit(page, `${SITE}/b`, 'Page B')
})
