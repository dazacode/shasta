import { expect, test } from '@playwright/test'
import { SITE, openShasta, pageFrame, visit } from '../support/helpers'

test('the media hub appears when a page plays, with its metadata, and controls it', async ({ page }) => {
  await openShasta(page)
  const hub = page.getByRole('toolbar', { name: 'Browser toolbar' }).getByRole('button', { name: /^Playing:|^Media controls/ })
  await visit(page, `${SITE}/music`, 'Music Page')
  await expect(hub).toHaveCount(0)
  await pageFrame(page).locator('#play').click()

  await expect(hub).toHaveAccessibleName('Playing: Test Tone')
  // the tab shows it is playing sound
  await expect(page.getByRole('button', { name: 'Mute tab' })).toBeVisible()
  await hub.click()
  const card = page.getByRole('article', { name: 'Test Tone, playing' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Fixture Band · Loopback')).toBeVisible()
  // the cover art came through the page's own (proxied) fetch
  await expect(card.locator('img[src^="blob:"]')).toBeVisible()
  // the seek bar follows the playhead
  const seek = card.getByRole('slider', { name: 'Seek' })
  const v1 = Number(await seek.inputValue())
  await expect.poll(async () => Number(await seek.inputValue()), { timeout: 5000 }).toBeGreaterThan(v1 + 0.5)

  // pause goes through the page's own handler, so its UI stays in step
  await card.getByRole('button', { name: 'Pause' }).click()
  await expect(pageFrame(page).locator('#log')).toHaveText('paused by handler')
  await expect(page.getByRole('article', { name: 'Test Tone, paused' })).toBeVisible()
  await expect(hub).toHaveAccessibleName('Media controls')

  // next track exists because the page registered it
  await page.getByRole('article', { name: 'Test Tone, paused' }).getByRole('button', { name: 'Next track' }).click()
  await expect(pageFrame(page).locator('#log')).toHaveText('next')

  // seeking lands on the element
  const paused = page.getByRole('article', { name: 'Test Tone, paused' })
  await paused.getByRole('button', { name: 'Forward 10 seconds' }).click()
  await expect.poll(async () => Number(await paused.getByRole('slider', { name: 'Seek' }).inputValue())).toBeGreaterThanOrEqual(10)

  // stop and hide removes it
  await paused.getByRole('button', { name: 'Stop and hide' }).click()
  await expect(hub).toHaveCount(0)
})
