import { test, expect } from '@playwright/test'
import { SITE, activeTab, go, loadingBar, newTab, omnibox, openShasta, pageFrame, tabs, visit } from '../support/helpers'

test.beforeEach(async ({ page }) => {
  await openShasta(page)
})

test('1. launches on the new tab page and opens a website', async ({ page }) => {
  await expect(page.locator('.nt-hero h1')).toBeVisible()
  await visit(page, `${SITE}/a`, 'Page A')
  await expect(pageFrame(page).locator('#h')).toHaveText('Page A')
  // the address bar shows the real destination, never an internal proxy URL
  await expect(omnibox(page)).toHaveValue(`localhost:4174/a`.replace(/^/, 'http://'))
  await page.getByRole('combobox', { name: 'Address and search bar' }).blur()
  await expect(omnibox(page)).not.toHaveValue(/~\/sj/)
})

test('1b. shows loading only while the page is really loading', async ({ page }) => {
  await go(page, `${SITE}/slow`)
  await expect(loadingBar(page)).toBeVisible()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /loading/)
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Slow Page/, { timeout: 20_000 })
  await expect(loadingBar(page)).toHaveCount(0)
})

test('2. search queries go to the configured search engine', async ({ page }) => {
  await omnibox(page).click()
  await omnibox(page).fill('mount shasta snow')
  await expect(page.getByRole('option').first()).toContainText('Search Google')
  await omnibox(page).press('Enter')
  await expect.poll(async () => (await page.evaluate(() => localStorage.getItem('shasta-session')))).toContain('google.com/search?q=mount%20shasta%20snow')
})

test('3-4. multiple tabs keep their own page state', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await pageFrame(page).locator('#field').fill('typed in tab one')
  await newTab(page)
  await visit(page, `${SITE}/b`, 'Page B')
  await expect(tabs(page)).toHaveCount(2)
  await tabs(page).first().click()
  await expect(pageFrame(page).locator('#field')).toHaveValue('typed in tab one')
  // the page kept running in the background (its timer advanced)
  await expect.poll(async () => Number(await pageFrame(page).locator('#tick').textContent())).toBeGreaterThan(3)
})

test('5. back and forward use independent per-tab history', async ({ page }) => {
  const back = page.getByRole('button', { name: 'Back' })
  const forward = page.getByRole('button', { name: 'Forward' })
  await expect(back).toBeDisabled()
  await visit(page, `${SITE}/a`, 'Page A')
  await pageFrame(page).locator('#tob').click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/)
  await expect(back).toBeEnabled()
  await back.click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/)
  await expect(forward).toBeEnabled()
  await forward.click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/)
  // a second tab has its own, empty history
  await newTab(page)
  await expect(back).toBeDisabled()
})

test('6. reload and stop', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await pageFrame(page).locator('#field').fill('before reload')
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(pageFrame(page).locator('#field')).toHaveValue('')
  await expect(loadingBar(page)).toHaveCount(0)

  await go(page, `${SITE}/slow`)
  await expect(loadingBar(page)).toBeVisible()
  await page.getByRole('button', { name: 'Stop loading' }).click()
  await expect(loadingBar(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
})

test('redirects replace the history entry instead of adding one', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await go(page, `${SITE}/redirect`)
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/)
  await expect(omnibox(page)).toHaveValue(/localhost:4174\/b/)
  // history is [new tab, A, B]: the redirect replaced the entry rather than adding a fourth
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.locator('.nt-hero h1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled()
})

test('single page apps update the address without a reload', async ({ page }) => {
  await visit(page, `${SITE}/spa`, 'SPA')
  await pageFrame(page).locator('#push').click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^SPA inner/)
  await page.getByRole('combobox', { name: 'Address and search bar' }).focus()
  await expect(omnibox(page)).toHaveValue(`${SITE}/spa/inner`)
})

test('links that open a new window become Shasta tabs', async ({ page }) => {
  await visit(page, `${SITE}/`, 'Fixture Home')
  await pageFrame(page).locator('#popup').click()
  await expect(tabs(page)).toHaveCount(2)
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Popup Page/, { timeout: 20_000 })
})

test('a pop-up the page opens without a click is refused, and no window ever opens', async ({ page }) => {
  await visit(page, `${SITE}/`, 'Fixture Home')
  const frame = page.frames().find((f) => f.url().includes('Fixture') || f.url().includes('4174'))!
  const windows: unknown[] = []
  page.context().on('page', (p) => windows.push(p))
  expect(await frame.evaluate(() => window.open('/popup') === null)).toBe(true)
  await expect(page.getByRole('status').getByText('Blocked a pop-up')).toBeVisible()
  await expect(tabs(page)).toHaveCount(1)
  expect(windows).toHaveLength(0)
})

test('in game mode the page opens no tabs and keeps the keyboard', async ({ page }) => {
  await visit(page, `${SITE}/`, 'Fixture Home')
  await page.getByRole('button', { name: 'Shasta menu' }).click()
  await page.getByRole('menuitem', { name: /Game mode/ }).click()
  await pageFrame(page).locator('#popup').click()
  await expect(page.getByRole('status').getByText('Blocked a pop-up')).toBeVisible()
  await expect(tabs(page)).toHaveCount(1)
  const frame = page.frames().find((f) => f.url().includes('4174'))!
  expect(await frame.evaluate(() => document.hasFocus())).toBe(true)
})

test('12. unreachable sites fail gracefully and recover', async ({ page }) => {
  await go(page, 'localhost:4999')
  await expect(page.getByRole('alert').filter({ hasText: /refused|can't be found|took too long|didn't respond/i })).toBeVisible({ timeout: 40_000 })
  await expect(activeTab(page)).toHaveAttribute('aria-label', /failed to load/)
  await expect(loadingBar(page)).toHaveCount(0)
  // the shell is still usable: navigate somewhere that works
  await visit(page, `${SITE}/b`, 'Page B')
  await expect(page.getByRole('alert').filter({ hasText: /refused|can't be|couldn't|didn't respond/i })).toHaveCount(0)
})

test('unsupported address schemes are refused with an explanation', async ({ page }) => {
  await go(page, 'javascript:alert(1)')
  await expect(page.getByRole('status').filter({ hasText: /cannot open javascript/i })).toBeVisible()
  await expect(tabs(page)).toHaveCount(1)
  await expect(page.locator('.nt-hero h1')).toBeVisible()
})

test('downloads are observed with real progress', async ({ page }) => {
  await visit(page, `${SITE}/`, 'Fixture Home')
  const dl = page.waitForEvent('download')
  await pageFrame(page).locator('#dl').click()
  await (await dl).cancel().catch(() => undefined)
  await page.getByRole('button', { name: /download/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible()
  await expect(page.getByText('fixture.bin')).toBeVisible()
})

test('background requests that say "attachment" are not listed as downloads', async ({ page }) => {
  await visit(page, `${SITE}/`, 'Fixture Home')
  await pageFrame(page).locator('#xhr').click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^xhr ok/)
  await newTab(page)
  await go(page, 'shasta://downloads')
  await expect(page.getByText('No downloads yet')).toBeVisible()
})

test('engine files are always requested with a version, never from a stale unversioned URL', async ({ page }) => {
  const urls: string[] = []
  page.on('request', (r) => /\/(scramjet|controller)\/[^/]+\.(js|wasm)/.test(r.url()) && urls.push(r.url()))
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')
  expect(urls.length).toBeGreaterThan(3)
  expect(urls.filter((u) => !/[?&]v=[0-9a-f]{10}/.test(u) && !u.endsWith('controller.sw.js'))).toEqual([])
})

test('game mode pauses Shasta shortcuts so the page gets every key', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  const field = pageFrame(page).locator('#field')
  // normally F6 typed inside the page still reaches Shasta
  await field.click()
  await field.press('F6')
  await expect(omnibox(page)).toBeFocused()

  await page.keyboard.press('Alt+Shift+G')
  await expect(page.getByRole('button', { name: /Game mode/ })).toBeVisible()
  await field.click()
  await field.press('F6')
  await expect(omnibox(page)).not.toBeFocused()

  await field.press('Alt+Shift+G')
  await expect(page.getByRole('button', { name: /Game mode/ })).toHaveCount(0)
})

// Chrome 126 (school Chromebooks past their last update) has no 64-bit WebAssembly memory: games built for it die in
// a worker at start. This browser has it, so the test makes Shasta's feature check fail the way Chrome 126's does.
test('a game that needs a newer Chrome says so instead of staying black', async ({ page }) => {
  await page.addInitScript(() => {
    if (window.top === window) WebAssembly.validate = () => false
  })
  await openShasta(page) // again, now with the check failing
  await visit(page, `${SITE}/old-chrome-game`, 'Memory64 Game')
  await expect(page.getByRole('alert').filter({ hasText: 'This page needs Chrome 133 or newer (64-bit WebAssembly memory)' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'needs Chrome' })).toHaveCount(0)
})

test('the same crash on a browser that has the feature is the site’s own: no notice', async ({ page }) => {
  await visit(page, `${SITE}/old-chrome-game`, 'Memory64 Game')
  await page.waitForTimeout(3000)
  await expect(page.getByRole('alert').filter({ hasText: 'needs Chrome' })).toHaveCount(0)
})
