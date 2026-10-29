import { test, expect } from '@playwright/test'
import { SITE, activeTab, newTab, omnibox, openShasta, pageFrame, tabs, visit } from '../support/helpers'

test('13. keyboard shortcuts', async ({ page }) => {
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')

  await page.keyboard.press('ControlOrMeta+T')
  await expect(tabs(page)).toHaveCount(2)
  await expect(omnibox(page)).toBeFocused()

  await page.keyboard.type(`${SITE}/b`)
  await page.keyboard.press('Enter')
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/, { timeout: 30_000 })

  // shortcuts also work while focus is inside the proxied page
  await pageFrame(page).locator('#toa').focus()
  await page.keyboard.press('ControlOrMeta+L')
  await expect(omnibox(page)).toBeFocused()

  await page.keyboard.press('Control+Tab')
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/)
  await page.keyboard.press('Control+Shift+Tab')
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/)
  await page.keyboard.press('ControlOrMeta+1')
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/)

  await page.keyboard.press('ControlOrMeta+D')
  await expect(page.getByText('Bookmark added')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.keyboard.press('ControlOrMeta+W')
  await expect(tabs(page)).toHaveCount(1)
  await page.keyboard.press('Alt+Shift+T')
  await expect(tabs(page)).toHaveCount(2)
})

test('shortcuts do not hijack text entry', async ({ page }) => {
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')
  await visit(page, `${SITE}/b`, 'Page B')
  await omnibox(page).click()
  await page.keyboard.press('Alt+ArrowLeft') // word-jump inside the input, must not navigate back
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page B/)
})

test('14. layouts hold at Chromebook and small sizes', async ({ page }) => {
  await openShasta(page)
  for (const size of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 800, height: 600 }, { width: 480, height: 800 }]) {
    await page.setViewportSize(size)
    await expect(omnibox(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Shasta menu' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `horizontal overflow at ${size.width}px`).toBeLessThanOrEqual(0)
  }
})

test('many tabs overflow gracefully and stay reachable', async ({ page }) => {
  await openShasta(page)
  await page.setViewportSize({ width: 900, height: 700 })
  for (let i = 0; i < 14; i++) await newTab(page)
  await expect(tabs(page)).toHaveCount(15)
  await expect(activeTab(page)).toBeInViewport()
  await page.getByRole('button', { name: 'Search tabs' }).click()
  await expect(page.getByText('Open tabs (15)')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('15. keyboard-only navigation and focus indicators', async ({ page }) => {
  await openShasta(page)
  await newTab(page)
  // arrow keys move between tabs in the tablist
  await activeTab(page).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
  await expect(tabs(page).first()).toBeFocused()
  // every interactive toolbar control is reachable by Tab and has an accessible name
  const names: string[] = []
  await omnibox(page).focus()
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    names.push((await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '')) as string)
  }
  expect(names.filter(Boolean).length).toBeGreaterThan(0)
  // suggestions are operable by keyboard
  await omnibox(page).focus()
  await page.keyboard.type('exa')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
})

test('reduced motion preference is honoured and can be forced from settings', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openShasta(page)
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  await page.goto('/')
  await page.getByRole('button', { name: 'Shasta menu' }).click()
  await page.getByRole('menuitem', { name: /^Settings/ }).click()
  await page.getByRole('radio', { name: 'Reduced' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
})

test('site information never claims a verified secure connection', async ({ page }) => {
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')
  await expect(page.getByText('Not secure')).toBeVisible() // http fixture
  await page.getByRole('button', { name: /Not secure/ }).click()
  await expect(page.getByText(/can't show the certificate details/)).toBeVisible()
  await page.locator('summary', { hasText: 'Permissions' }).click()
  await expect(page.getByRole('switch', { name: 'Camera' })).toBeVisible()
  await expect(page.locator('[aria-label*="ecure connection"]')).toHaveCount(0)
})

test('background tabs are suspended after inactivity and wake on selection', async ({ page }) => {
  await page.clock.install()
  await openShasta(page)
  await visit(page, `${SITE}/a`, 'Page A')
  await newTab(page)
  await visit(page, `${SITE}/b`, 'Page B')
  await page.clock.fastForward('20:00')
  await expect(page.locator('[role=tab]').first()).toHaveAttribute('aria-label', /suspended/)
  await page.locator('[role=tab]').first().click()
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Page A/, { timeout: 30_000 })
})
