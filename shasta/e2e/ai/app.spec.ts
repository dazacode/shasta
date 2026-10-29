// The Shasta AI store app, end to end: published by the server into the Official storefront, installed from the Store,
// run in its isolated frame, talking to the on-device models through the bridge. Real models, real network for the model
// mirror and the Wikipedia lookup. Run: bun run test:ai
import { expect, test } from '@playwright/test'

test.setTimeout(15 * 60_000)

test('install Shasta AI from the Store, set it up, and chat; nothing leaves the device except the model mirror and lookup', async ({ page, context }) => {
  const external = new Set<string>()
  context.on('request', (r) => {
    const host = new URL(r.url()).hostname
    if (!/^(localhost|127\.0\.0\.1|.+\.localhost)$/.test(host) && !/^(data|blob|about):/.test(r.url())) external.add(host)
  })
  await page.addInitScript(() => localStorage.setItem('shasta-settings', JSON.stringify({ state: { settings: { ai: { chatModel: 'light', enabled: true, idleUnloadMinutes: 0, contextMenu: true, visual: 'auto', lookup: true } } }, version: 4 })))

  // the owner exists -> the server publishes the bundled app
  await page.goto('/')
  await page.request.post('/api/auth/start')
  expect((await page.request.post('/api/auth/redeem', { data: { code: 'E2E-SETUP-CODE' } })).ok()).toBe(true)
  await expect.poll(async () => (await page.request.get('/api/catalog/apps/shasta-ai')).status(), { timeout: 20_000 }).toBe(200)

  await page.goto('/')
  await page.getByRole('button', { name: 'Shasta Store' }).click()
  await page.getByRole('link', { name: /Shasta AI/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Shasta AI', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Install' }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()

  const app = page.frameLocator('iframe[title="Shasta AI"]')
  await expect(app.getByRole('heading', { name: 'Set up Shasta AI' })).toBeVisible({ timeout: 30_000 })
  await app.getByRole('button', { name: 'Set up for this device' }).click()
  const box = app.getByRole('textbox', { name: 'Message' })
  await expect(box).toBeVisible({ timeout: 10 * 60_000 })
  // deliberately no waiting for the setup screen to go away: a first question sent while setup is still running used to leave it stuck

  await box.fill('Who owns YouTube?')
  await box.press('Enter')
  await expect(app.locator('.row.ai .bubble').last()).toContainText(/Google/i, { timeout: 5 * 60_000 })
  await expect(app.locator('.sources')).toContainText('Wikipedia')

  await box.fill('Compare cats and dogs')
  await box.press('Enter')
  await expect(app.locator('.row.ai')).toHaveCount(2, { timeout: 5 * 60_000 })
  await expect(app.locator('.stage')).toHaveCount(0, { timeout: 5 * 60_000 })
  await expect(app.locator('#gate')).toBeHidden({ timeout: 60_000 })
  await expect(app.locator('#empty')).toBeHidden()
  await page.screenshot({ path: 'test-results/ai-app-chat.png' })

  // isolation still holds, and the only hosts the browser talked to are Shasta's own
  expect([...external]).toEqual([])
})
