import { test, expect } from '@playwright/test'
import { SITE, activeTab, flushSession, go, newTab, omnibox, openShasta, session, tabs, visit } from '../support/helpers'

test.beforeEach(async ({ page }) => {
  await openShasta(page)
})

test('7. bookmark a page, then reopen it from the bookmarks page', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await page.getByRole('toolbar', { name: 'Browser toolbar' }).getByRole('button', { name: 'Bookmark this page' }).click()
  await expect(page.getByText('Bookmark added')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  // the bookmarks bar shows it
  await expect(page.getByRole('navigation', { name: 'Bookmarks bar' }).getByText('Page A')).toBeVisible()

  await page.reload()
  await newTab(page)
  await page.getByRole('button', { name: 'Shasta menu' }).click()
  await page.getByRole('menuitem', { name: /^Bookmarks/ }).click()
  await expect(page.getByRole('heading', { name: 'Bookmarks', level: 1 })).toBeVisible()
  await page.getByRole('main').getByRole('button', { name: /^Page A/ }).click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/)
})

test('bookmark folders: create, move, remove, export', async ({ page }) => {
  await visit(page, `${SITE}/b`, 'Page B')
  await page.getByRole('toolbar', { name: 'Browser toolbar' }).getByRole('button', { name: 'Bookmark this page' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await newTab(page)
  await go(page, 'shasta://bookmarks')
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByLabel('Name').fill('Reading')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Edit Page B' }).click()
  await page.getByRole('dialog').locator('select').selectOption({ label: 'Reading' })
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('main').getByRole('button', { name: /^Reading/ }).click()
  await expect(page.getByRole('main').getByRole('button', { name: /^Page B/ })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('shasta-bookmarks.html')
  await page.getByRole('button', { name: 'Delete Page B' }).click()
  await expect(page.getByText('This folder is empty')).toBeVisible()
})

test('bookmarks bar opens bookmarks in the current tab', async ({ page }) => {
  await visit(page, `${SITE}/b`, 'Page B')
  await page.getByRole('toolbar', { name: 'Browser toolbar' }).getByRole('button', { name: 'Bookmark this page' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await visit(page, `${SITE}/a`, 'Page A')
  await page.getByRole('navigation', { name: 'Bookmarks bar' }).getByRole('button', { name: /Page B/ }).click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/, { timeout: 30_000 })
})

test('8. history records visits and can be searched and cleared', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await visit(page, `${SITE}/b`, 'Page B')
  await newTab(page)
  await go(page, 'shasta://history')
  await expect(page.getByRole('button', { name: /^Page A/ })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search history' }).fill('page b')
  await expect(page.getByRole('button', { name: /^Page B/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Page A/ })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search history' }).fill('')
  // omnibox suggestions come from history
  await newTab(page)
  await omnibox(page).fill('page')
  await expect(page.getByRole('option').filter({ hasText: 'Page A' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await tabs(page).nth(1).click()
  await page.getByRole('button', { name: 'Clear browsing data…' }).click()
  await page.getByLabel('Time range').selectOption('all')
  await page.getByRole('button', { name: 'Clear history' }).click()
  await expect(page.getByText('No history yet')).toBeVisible()
})

test('9. settings persist across a refresh and take effect', async ({ page }) => {
  await page.getByRole('button', { name: 'Shasta menu' }).click()
  await page.getByRole('menuitem', { name: /^Settings/ }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('radio', { name: 'Violet' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
  await page.getByRole('radio', { name: 'Compact' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await page.getByRole('switch', { name: 'Show bookmarks bar' }).click()
  await expect(page.getByRole('navigation', { name: 'Bookmarks bar' })).toHaveCount(0)

  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await expect(page.getByRole('navigation', { name: 'Bookmarks bar' })).toHaveCount(0)
})

test('search engine setting changes where queries go', async ({ page }) => {
  await go(page, 'shasta://settings#browsing')
  await page.getByLabel('Search engine').selectOption('duckduckgo')
  await newTab(page)
  await omnibox(page).fill('hello there')
  await expect(page.getByRole('option').first()).toContainText('Search DuckDuckGo')
})

test('10. sessions restore tabs, pins and the active tab after a refresh', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await newTab(page)
  await visit(page, `${SITE}/b`, 'Page B')
  await tabs(page).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin tab' }).click()
  await expect(tabs(page).first()).toHaveAttribute('aria-label', /pinned/)
  await flushSession(page)
  await page.reload()
  await expect(tabs(page)).toHaveCount(2)
  await expect(tabs(page).first()).toHaveAttribute('aria-label', /pinned/)
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/, { timeout: 30_000 })
  const s = await session(page)
  expect(s?.tabs.map((t) => t.url)).toEqual([`${SITE}/a`, `${SITE}/b`])
})

test('restore can be turned off', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await go(page, 'shasta://settings#browsing')
  await page.getByRole('switch', { name: 'Restore tabs on startup' }).click()
  await flushSession(page)
  await page.reload()
  await expect(tabs(page)).toHaveCount(1)
  await expect(page.locator('.nt-hero h1')).toBeVisible()
})

test('recently closed tabs can be reopened', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await newTab(page)
  await tabs(page).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
  await expect(tabs(page)).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+Shift+T')
  await expect(tabs(page)).toHaveCount(2)
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/, { timeout: 30_000 })
})

test('tab groups: create, collapse, rename', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await newTab(page)
  await visit(page, `${SITE}/b`, 'Page B')
  await tabs(page).nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to group' }).hover()
  await page.getByRole('menuitem', { name: 'New group' }).click()
  const chip = page.getByRole('button', { name: /group, expanded/ })
  await expect(chip).toBeVisible()
  await chip.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Rename or recolor/ }).click()
  await page.getByLabel('Group name').fill('Work')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: /Work group, expanded/ })).toBeVisible()
  await page.getByRole('button', { name: /Work group/ }).click()
  await expect(page.getByRole('button', { name: /Work group, collapsed/ })).toBeVisible()
  await expect(tabs(page)).toHaveCount(1)
})

test('drag and drop reorders tabs', async ({ page }) => {
  await visit(page, `${SITE}/a`, 'Page A')
  await newTab(page)
  await visit(page, `${SITE}/b`, 'Page B')
  const first = tabs(page).nth(0)
  const second = tabs(page).nth(1)
  await second.dragTo(first, { targetPosition: { x: 5, y: 10 } })
  await expect(tabs(page).first()).toHaveAttribute('aria-label', /^Page B/)
})

test('middle click closes a tab and double clicking the strip opens one', async ({ page }) => {
  await newTab(page)
  await expect(tabs(page)).toHaveCount(2)
  await tabs(page).nth(1).click({ button: 'middle' })
  await expect(tabs(page)).toHaveCount(1)
  await page.locator('[data-strip-blank]').dblclick()
  await expect(tabs(page)).toHaveCount(2)
})

test('settings saved by an older version still load (new fields get defaults)', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('seeded', '1')
      localStorage.setItem('shasta-settings', JSON.stringify({ state: { settings: { theme: 'dark', accent: 'rose', searchEngine: 'bing' } }, version: 2 }))
    }
  })
  await openShasta(page)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await go(page, 'shasta://settings#privacy')
  await expect(page.getByRole('switch', { name: 'Camera' })).not.toBeChecked()
})
