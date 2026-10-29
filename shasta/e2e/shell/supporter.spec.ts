import { test, expect } from '@playwright/test'
import { go, newTab, openShasta } from '../support/helpers'

// The supporter endpoints are mocked: a real Ed25519 key signs the pass here, the page checks it with WebCrypto.
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')

test('redeem a supporter code: badge, unlocked wallpaper, remove', async ({ page }) => {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400
  const payload = new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'supporter', iat: exp - 31 * 86400, exp }))
  const token = `${b64url(payload)}.${b64url(new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)))}`
  let redeemed = ''
  await page.route('**/api/supporter/public-key', (r) => r.fulfill({ json: { key: b64url(pub) } }))
  await page.route('**/api/supporter/redeem', (r) => {
    redeemed = (r.request().postDataJSON() as { code: string }).code
    return r.fulfill({ json: { token, kind: 'supporter', exp } })
  })

  await openShasta(page)
  await newTab(page)
  await go(page, 'shasta://settings#supporter')
  await expect(page.getByRole('heading', { name: 'Supporter', level: 2 })).toBeVisible()
  await page.getByLabel('Add a code').fill(' shasta-abcd-efgh-jkmo ')
  await page.getByRole('button', { name: 'Redeem' }).click()
  await expect(page.getByText(/Supporter · 30 days left/)).toBeVisible()
  expect(redeemed).toBe('SHASTA-ABCD-EFGH-JKM0')
  await expect(page.getByRole('main').getByRole('button', { name: 'Supporter' }).first()).toBeVisible()

  await go(page, 'shasta://settings#newtab')
  await expect(page.getByRole('radio', { name: 'Aurora', exact: true })).toBeVisible()

  await go(page, 'shasta://settings#supporter')
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Remove from this device' }).click()
  await expect(page.getByText(/Not a Supporter on this device/)).toBeVisible()
  await go(page, 'shasta://settings#newtab')
  await expect(page.getByRole('radio', { name: /Aurora \(Supporter perk, locked\)/ })).toBeVisible()
})

test('support page: 3-step guide, inline code box, success state', async ({ page }) => {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400
  const payload = new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'supporter', iat: exp - 31 * 86400, exp }))
  const token = `${b64url(payload)}.${b64url(new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)))}`
  let redeemed = ''
  await page.route('**/api/supporter/public-key', (r) => r.fulfill({ json: { key: b64url(pub) } }))
  await page.route('**/api/supporter/redeem', (r) => {
    redeemed = (r.request().postDataJSON() as { code: string }).code
    return redeemed === 'SHASTA-ABCD-EFGH-JKM0' ? r.fulfill({ json: { token, kind: 'supporter', exp } }) : r.fulfill({ status: 404, json: { error: 'unknown' } })
  })

  await openShasta(page)
  await newTab(page)
  // stale keys from the old payment flow are deleted on load
  await page.evaluate(() => {
    localStorage.setItem('shasta-support-ref', 'x')
    sessionStorage.setItem('shasta-support-pending', 'x')
  })
  await go(page, 'shasta://support')
  await expect(page.getByRole('heading', { name: '1. Support on Ko-fi' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '2. Join the Discord' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '3. Get your code' })).toBeVisible()
  await expect(page.getByLabel('Your email')).toHaveCount(0)
  const ko = page.getByRole('link', { name: 'Support on Ko-fi' })
  if ((await ko.count()) > 0) {
    await expect(ko).toHaveAttribute('target', '_blank')
    await expect(ko).toHaveAttribute('rel', /noopener/)
    await expect(ko).toHaveAttribute('href', /^https:\/\//)
  }
  expect(await page.evaluate(() => [localStorage.getItem('shasta-support-ref'), sessionStorage.getItem('shasta-support-pending')])).toEqual([null, null])

  const box = page.getByLabel(/3\. Get your code/)
  await box.fill('SHASTA-ZZZZ-ZZZZ-ZZZZ')
  await page.getByRole('button', { name: 'Redeem' }).click()
  await expect(page.getByRole('alert')).toContainText(/isn't known/)

  await box.fill(' shasta-abcd-efgh-jkmo ')
  await page.getByRole('button', { name: 'Redeem' }).click()
  await expect(page.getByText('Code accepted. Thank you!')).toBeVisible({ timeout: 15_000 })
  expect(redeemed).toBe('SHASTA-ABCD-EFGH-JKM0')
  await expect(page.getByRole('button', { name: 'See the new tab wallpapers' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Supporter settings' })).toBeVisible()
})
