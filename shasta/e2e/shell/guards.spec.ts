// Shasta's own right-click menu replaces the browser's, and (production build) devtools shortcuts are blocked.
import { test, expect, type Page } from '@playwright/test'
import { SITE, activeTab, openShasta, pageFrame, tabs, visit, omnibox } from '../support/helpers'

test.beforeEach(async ({ page }) => {
  await openShasta(page)
})

const menu = (page: Page) => page.getByRole('menu', { name: 'Page menu' })

test('right-clicking a proxied page shows Shasta\'s menu, with no Inspect or View source', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await pageFrame(page).locator('#h').click({ button: 'right' })
  await expect(menu(page)).toBeVisible()
  const labels = await menu(page).getByRole('menuitem').allTextContents()
  expect(labels.join(' | ')).toMatch(/Back/)
  expect(labels.join(' | ')).toMatch(/Reload/)
  expect(labels.join(' | ')).not.toMatch(/inspect|view (page |frame )?source/i)
  // Escape closes it, and a click elsewhere does too
  await page.keyboard.press('Escape')
  await expect(menu(page)).toHaveCount(0)
})

test('the menu works: Reload reloads, and a link can be opened in a new tab', async ({ page }) => {
  await visit(page, `${SITE}/`, 'Fixture Home')
  await pageFrame(page).locator('#a').click({ button: 'right' })
  await expect(menu(page).getByRole('menuitem', { name: 'Open link in new tab' })).toBeVisible()
  await expect(menu(page).getByRole('menuitem', { name: 'Copy link address' })).toBeVisible()
  const before = await tabs(page).count()
  await menu(page).getByRole('menuitem', { name: 'Open link in new tab' }).click()
  await expect(tabs(page)).toHaveCount(before + 1)
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/, { timeout: 20_000 })
  // Back is disabled where there is no history
  await pageFrame(page).locator('#h').click({ button: 'right' })
  await expect(menu(page).getByRole('menuitem', { name: 'Back' })).toBeDisabled()
  await menu(page).getByRole('menuitem', { name: 'Reload' }).click()
  await expect(menu(page)).toHaveCount(0)
})

test('text fields (in a page and in Shasta itself) get cut / copy / paste, not the browser menu', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await pageFrame(page).locator('#field').fill('hello')
  await pageFrame(page).locator('#field').click({ button: 'right' })
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Cut', 'Copy', 'Paste', 'Select all'].map((s) => new RegExp(`^${s}`)))
  await page.keyboard.press('Escape')
  await omnibox(page).click({ button: 'right' })
  await expect(menu(page).getByRole('menuitem', { name: /^Paste/ })).toBeVisible()
  await expect(menu(page).getByRole('menuitem', { name: /inspect/i })).toHaveCount(0)
})

test('the devtools shortcuts are blocked in the production build, in Shasta and in proxied pages', async ({ page }) => {
  const cases = [
    { key: 'F12', code: 'F12' },
    { key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true },
    { key: 'J', code: 'KeyJ', metaKey: true, shiftKey: true },
    { key: 'ˆ', code: 'KeyI', metaKey: true, altKey: true },
    { key: 'u', code: 'KeyU', ctrlKey: true },
  ]
  for (const c of cases) {
    const allowed = await page.evaluate(({ init }) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })), { init: c })
    expect(allowed, `shell ${JSON.stringify(c)}`).toBe(false)
  }
  await visit(page, `${SITE}/a`, 'Page A')
  const frame = page.frames().find((f) => f.url().includes('/~/sj/') && f.url().includes('%2Fa'))!
  for (const c of cases) {
    const allowed = await frame.evaluate((init) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })), c)
    expect(allowed, `page ${JSON.stringify(c)}`).toBe(false)
  }
  // ordinary shortcuts are untouched
  const ordinary = await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'c', code: 'KeyC', ctrlKey: true })))
  expect(ordinary).toBe(true)
})
