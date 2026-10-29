import { expect, type Page } from '@playwright/test'

export const SITE = 'http://localhost:4174'

export const omnibox = (page: Page) => page.getByRole('combobox', { name: 'Address and search bar' })
export const activeTab = (page: Page) => page.locator('[role=tab][aria-selected=true]')
export const tabs = (page: Page) => page.locator('[role=tab]')
export const loadingBar = (page: Page) => page.getByRole('progressbar', { name: 'Loading page' })

/** The proxied page inside the active tab's iframe. */
export const pageFrame = (page: Page) => page.frameLocator('iframe:not([inert])')

export async function openShasta(page: Page, path = '/') {
  await page.goto(path)
  // the shell is interactive immediately; wait for the proxy engine to finish booting
  await expect(page.getByRole('alert').filter({ hasText: /Starting the proxy engine/ })).toHaveCount(0, { timeout: 30_000 })
}

export async function go(page: Page, address: string) {
  const box = omnibox(page)
  await box.click()
  await box.fill(address)
  await box.press('Enter')
}

/** Navigates and waits until the page has really loaded (the progress bar disappears and the title arrives). */
export async function visit(page: Page, address: string, title: string) {
  await go(page, address)
  await expect(activeTab(page)).toHaveAttribute('aria-label', new RegExp(`^${title}`), { timeout: 30_000 })
  await expect(loadingBar(page)).toHaveCount(0, { timeout: 30_000 })
}

export async function newTab(page: Page) {
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect(omnibox(page)).toBeFocused()
}

export const session = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('shasta-session') || 'null') as { tabs: { url: string; title: string; pinned: boolean; groupId: string | null }[]; activeId: string } | null)

export async function flushSession(page: Page) {
  // the session is written 400ms after the last change
  await page.waitForTimeout(600)
}
