// Social, end to end through the real UI, the real server (Better Auth, social.db, the link relay) and the built app:
// a computer shows the QR code, a phone "scans" it (the test decodes the QR image like a camera would), makes an
// account, both screens show the same code, the person confirms on both, and the computer is signed in to that account.
// Contract: docs/social-protocol.md "Linking". Runs in the `store` project (server on :4180, throw-away data folder).
import { expect, test, devices, type Page } from '@playwright/test'
import { readBarcodes } from 'zxing-wasm/reader'

/** Reads the QR code on screen the way a phone camera would. */
async function scanQr(page: Page): Promise<URL> {
  const qr = page.getByRole('img', { name: "QR code: scan it with your phone's camera" })
  await expect(qr).toBeVisible()
  const png = await qr.screenshot()
  const [hit] = await readBarcodes(new Blob([new Uint8Array(png)], { type: 'image/png' }), { formats: ['QRCode'] })
  expect(hit?.text, 'the QR code decodes').toBeTruthy()
  return new URL(hit.text)
}

test('a phone scans the computer and becomes the account', async ({ browser, baseURL }) => {
  // the computer
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await desk.goto('/')
  const box = desk.getByRole('combobox', { name: 'Address and search bar' })
  await box.click()
  await box.fill('shasta://social')
  await box.press('Enter')
  await expect(desk.getByRole('heading', { name: 'Continue on your phone' })).toBeVisible()

  const link = await scanQr(desk)
  expect(link.pathname).toBe('/me')
  expect(link.hash).toMatch(/^#l=[A-Za-z0-9]+\.[\w-]+\.[\w-]+$/)
  // the build may name the public site as the phone app's home; the test serves it here
  const local = new URL(link.pathname + link.hash, baseURL)

  // the phone opens the link from its camera
  const phone = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage()
  await phone.goto(local.href)
  // the secret after # is gone from the address bar at once
  await expect.poll(() => new URL(phone.url()).hash).toBe('')

  // both screens show the same 3-digit code
  const deskCode = desk.getByLabel(/^Code \d \d \d$/)
  await expect(deskCode).toBeVisible()
  const code = (await deskCode.getAttribute('aria-label'))!.replace(/\D/g, '')
  await expect(phone.getByText(code.split('').join(''), { exact: false }).or(phone.getByText(code.split('').join(' ')))).toBeVisible()

  // a new account on the phone: age (only a band is kept), handle, avatar
  await phone.getByRole('button', { name: 'Make my account and link it' }).click()
  await phone.getByLabel('How old are you?').fill('16')
  await phone.getByRole('button', { name: 'Next' }).click()
  await phone.getByLabel('Handle').fill('e2e_sam')
  await phone.getByRole('button', { name: 'Make my account' }).click()

  // the person confirms on the computer too; only then may the phone approve it
  await desk.getByRole('button', { name: "Yes, that's my phone" }).click()

  // the computer is now signed in to the phone's account
  await expect(desk.getByText('@e2e_sam').first()).toBeVisible({ timeout: 30_000 })

  // ... and stays signed in after a reload (the session token is kept on this device)
  await desk.reload()
  await box.click()
  await box.fill('shasta://social')
  await box.press('Enter')
  await expect(desk.getByText('@e2e_sam').first()).toBeVisible({ timeout: 30_000 })
})

test('under 13 gets no account and is not asked again', async ({ browser, baseURL }) => {
  const phone = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage()
  await phone.goto(new URL('/me', baseURL).href)
  await phone.getByRole('button', { name: 'Make my account' }).click()
  await phone.getByLabel('How old are you?').fill('11')
  await phone.getByRole('button', { name: 'Next' }).click()
  await expect(phone.getByText(/13 and up/)).toBeVisible()
  await phone.reload()
  await expect(phone.getByText(/13 and up/)).toBeVisible()
  await expect(phone.getByLabel('How old are you?')).toHaveCount(0)
})
