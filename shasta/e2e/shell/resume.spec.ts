import { expect, test } from '@playwright/test'
import { SITE, openShasta, pageFrame, visit } from '../support/helpers'

test('a big download that breaks halfway continues where it stopped, and the page gets every byte', async ({ page, request }) => {
  await openShasta(page)
  await visit(page, `${SITE}/flaky`, 'Flaky Download')
  const result = pageFrame(page).locator('#result')
  await expect(result).toHaveText(/^bytes 4194304 bad -1 id \w+$/, { timeout: 30_000 })
  const id = (await result.textContent())!.split(' id ')[1]
  // it really broke once and was resumed with a Range request, not downloaded again from the start
  expect(await (await request.get(`${SITE}/flaky-stats?id=${id}`)).json()).toEqual({ full: 1, ranged: 1 })
})

test('a compressed download that breaks (libcurl just ends the stream) is caught and continued uncompressed', async ({ page, request }) => {
  await openShasta(page)
  await visit(page, `${SITE}/flaky?gz`, 'Flaky Download')
  const result = pageFrame(page).locator('#result')
  await expect(result).toHaveText(/^bytes 4194304 bad -1 id \w+$/, { timeout: 30_000 })
  const id = (await result.textContent())!.split(' id ')[1]
  expect(await (await request.get(`${SITE}/flaky-stats?id=${id}`)).json()).toEqual({ full: 1, ranged: 1 })
})
