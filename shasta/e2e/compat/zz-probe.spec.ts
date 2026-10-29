import { test } from '@playwright/test'
import { openShasta } from '../support/helpers'
test.use({ baseURL: 'http://localhost:4173', locale: 'en-US' })
test('probe turbowarp', async ({ page }) => {
  test.setTimeout(90_000)
  page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 400)))
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await openShasta(page)
  const box = page.getByRole('combobox').first()
  await box.click(); await box.fill('https://turbowarp.org/510101811/embed?autoplay&fps=60&settings-button&addons=gamepad,pause'); await box.press('Enter')
  await page.waitForTimeout(25_000)
  const det = page.getByText('Technical details')
  if (await det.count()) { await det.click(); console.log('DETAILS:', await page.locator('details').innerText()) }
  else console.log('no error page')
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-seanolivermarzan-Dev-project-immerse-unblocked/3e6ba0f6-4321-4756-8a07-565b9a92af01/scratchpad/tw.png' })
})
