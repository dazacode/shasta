import { expect, test, type Browser, type Page } from '@playwright/test'
import { SITE, openShasta, pageFrame, visit } from '../support/helpers'

const log = (page: Page) => pageFrame(page).locator('#log li')

test('a phone scans the window\'s code, joins as player 1, and its buttons reach the game as keys', async ({ page, browser }) => {
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  await page.getByRole('button', { name: /^Shasta menu/ }).click()
  await page.getByRole('menuitem', { name: /Controls & controller/ }).click()
  const dialog = page.getByRole('dialog', { name: /Controls for/ })
  await dialog.getByRole('button', { name: 'Use your phone as a controller' }).click()
  const qr = dialog.getByRole('img', { name: /scan it with your phone/ })
  await expect(qr).toBeVisible()
  const code = (await dialog.locator('.select-all').textContent())!.trim()
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/)
  await dialog.getByRole('button', { name: 'Done' }).click()

  // the phone: a touch screen in portrait, opening the link from the QR code
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const phone = await phoneCtx.newPage()
  await phone.goto(`/pad.html?c=${code.toLowerCase()}`)
  await expect(phone.getByText('P1', { exact: true })).toBeVisible()
  await expect(phone.locator('.title')).toContainText('Key Game')
  await expect(page.getByText("Player 1's phone is connected.")).toBeVisible()

  // A = Space (the default layout), held while the finger is down
  const a = phone.getByRole('button', { name: 'A', exact: true })
  const box = (await a.boundingBox())!
  const cdp = await phoneCtx.newCDPSession(phone)
  const touch = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
  await touch('touchStart', box.x + box.width / 2, box.y + box.height / 2)
  await expect(log(page).filter({ hasText: /^keydown\s+Space 32$/ })).toHaveCount(1)
  await touch('touchEnd', 0, 0)
  await expect(log(page).filter({ hasText: /^keyup\s+Space 32$/ })).toHaveCount(1)

  // thumb on the top of the D-pad = ArrowUp
  const dpad = (await phone.getByLabel('D-pad').boundingBox())!
  await touch('touchStart', dpad.x + dpad.width / 2, dpad.y + dpad.height * 0.12)
  await expect(log(page).filter({ hasText: 'keydown ArrowUp ArrowUp 38' })).toHaveCount(1)
  await touch('touchEnd', 0, 0)
  await expect(log(page).filter({ hasText: 'keyup ArrowUp ArrowUp 38' })).toHaveCount(1)

  // the window stops the room: the phone is told
  await page.getByRole('button', { name: /^Shasta menu/ }).click()
  await page.getByRole('menuitem', { name: /Controls & controller/ }).click()
  await dialog.getByRole('button', { name: 'Stop phone controllers' }).click()
  await expect(phone.getByRole('heading', { name: 'Controller disconnected' })).toBeVisible()
  await phoneCtx.close()
})

test('the controller page asks for a code when opened without one, and refuses a wrong one', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })
  const phone = await ctx.newPage()
  await phone.goto('/pad.html')
  await phone.getByLabel('Controller code').fill('zzzzzz')
  await phone.getByRole('button', { name: 'Connect' }).click()
  await expect(phone.getByText(/That code is not open/)).toBeVisible()
  await ctx.close()
})

/** A phone that opened the controller link, with a finger that can press and release a button. */
async function joinPhone(browser: Browser, code: string, player: number) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })
  const phone = await ctx.newPage()
  await phone.goto(`/pad.html?c=${code}`)
  await expect(phone.getByText(`P${player}`, { exact: true })).toBeVisible()
  const cdp = await ctx.newCDPSession(phone)
  const touch = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
  const hold = async (name: string) => {
    const box = (await phone.getByRole('button', { name, exact: true }).boundingBox())!
    await touch('touchStart', box.x + box.width / 2, box.y + box.height / 2)
  }
  return { ctx, phone, hold, release: () => touch('touchEnd') }
}

async function openRoom(page: Page) {
  await page.getByRole('button', { name: /^Shasta menu/ }).click()
  await page.getByRole('menuitem', { name: /Controls & controller/ }).click()
  const dialog = page.getByRole('dialog', { name: /Controls for/ })
  await dialog.getByRole('button', { name: 'Use your phone as a controller' }).click()
  await expect(dialog.getByRole('img', { name: /scan it with your phone/ })).toBeVisible()
  const code = (await dialog.locator('.select-all').textContent())!.trim()
  await dialog.getByRole('button', { name: 'Done' }).click()
  return code
}

test('two phones are two players: each presses its own player\'s keys on one keyboard', async ({ page, browser }) => {
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  const code = await openRoom(page)
  const p1 = await joinPhone(browser, code, 1)
  const p2 = await joinPhone(browser, code, 2)

  // player 2's A is G (WASD side), player 1's A is Space: held together, both reach the game
  await p2.hold('A')
  await expect(log(page).filter({ hasText: 'keydown g KeyG 71' })).toHaveCount(1)
  await p1.hold('A')
  await expect(log(page).filter({ hasText: /^keydown\s+Space 32$/ })).toHaveCount(1)
  await p2.release()
  await expect(log(page).filter({ hasText: 'keyup g KeyG 71' })).toHaveCount(1)
  await expect(log(page).filter({ hasText: /^keyup\s+Space 32$/ })).toHaveCount(0)
  await p1.release()
  await expect(log(page).filter({ hasText: /^keyup\s+Space 32$/ })).toHaveCount(1)
  await p1.ctx.close()
  await p2.ctx.close()
})

test('a third phone joins a game that reads controllers as a real gamepad', async ({ page, browser }) => {
  await openShasta(page)
  await visit(page, `${SITE}/pads`, 'Pad Game')
  const code = await openRoom(page)
  const phones = [await joinPhone(browser, code, 1), await joinPhone(browser, code, 2), await joinPhone(browser, code, 3)]
  const pads = pageFrame(page).locator('#pads')
  // players 1 and 2 have keys by default; player 3 has none, so it is gamepad 3 (index 2), announced like a real one
  await expect(pads).toHaveText('2:')
  await expect(pageFrame(page).locator('#events li')).toHaveText(['connected 2'])
  await phones[2].hold('B')
  await expect(pads).toHaveText('2:1')
  await phones[2].release()
  await expect(pads).toHaveText('2:')

  // "phones join as real gamepads": all three are gamepads 1-3
  await page.getByRole('button', { name: /^Shasta menu/ }).click()
  await page.getByRole('menuitem', { name: /Controls & controller/ }).click()
  await page.getByRole('switch', { name: 'Phones join as real gamepads' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(pads).toHaveText('0: 1: 2:')
  await phones[0].hold('A')
  await expect(pads).toHaveText('0:0 1: 2:')
  await phones[0].release()
  for (const p of phones) await p.ctx.close()
})

test('a phone connects straight to the window when it can, and falls back to the server when that is turned off', async ({ page, browser }) => {
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  const code = await openRoom(page)
  const p1 = await joinPhone(browser, code, 1)
  await expect(p1.phone.getByRole('status').filter({ hasText: /^Direct$/ })).toBeVisible({ timeout: 15_000 })
  await p1.hold('A')
  await expect(log(page).filter({ hasText: /^keydown\s+Space 32$/ })).toHaveCount(1)
  await p1.release()
  await expect(log(page).filter({ hasText: /^keyup\s+Space 32$/ })).toHaveCount(1)
  await p1.ctx.close()

  // Settings -> Privacy: direct phone connection off -> the next phone stays on the relay and still works
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('shasta-settings') || '{}')
    raw.state = raw.state ?? {}
    raw.state.settings = { ...(raw.state.settings ?? {}), phoneDirect: false }
    localStorage.setItem('shasta-settings', JSON.stringify(raw))
  })
  await page.reload()
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  const code2 = await openRoom(page)
  const p2 = await joinPhone(browser, code2, 1)
  await expect(p2.phone.getByRole('status').filter({ hasText: /^Via Shasta$/ })).toBeVisible()
  await p2.hold('B')
  await expect(log(page).filter({ hasText: 'keydown x KeyX 88' })).toHaveCount(1)
  await p2.release()
  await expect(p2.phone.getByRole('status').filter({ hasText: /^Via Shasta$/ })).toBeVisible()
  await p2.ctx.close()
})

test('a quick tap on the phone still reaches the game (press and release arrive together)', async ({ page, browser }) => {
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  const code = await openRoom(page)
  const p1 = await joinPhone(browser, code, 1)
  // what a fast finger (or iPhone Safari's tap) sends: down and up within a millisecond, both before the window's next frame
  await p1.hold('A')
  await p1.release()
  await expect(log(page).filter({ hasText: /^keydown\s+Space 32$/ })).toHaveCount(1)
  await expect(log(page).filter({ hasText: /^keyup\s+Space 32$/ })).toHaveCount(1)
  await p1.ctx.close()
})

test('scanning the code in the Controls dialog closes it, so the phone plays at once', async ({ page, browser }) => {
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  await page.getByRole('button', { name: /^Shasta menu/ }).click()
  await page.getByRole('menuitem', { name: /Controls & controller/ }).click()
  const dialog = page.getByRole('dialog', { name: /Controls for/ })
  await dialog.getByRole('button', { name: 'Use your phone as a controller' }).click()
  const code = (await dialog.locator('.select-all').textContent())!.trim()
  // no "Done": the person scans and starts pressing right away
  const p1 = await joinPhone(browser, code, 1)
  await expect(dialog).toBeHidden()
  await p1.hold('A')
  await expect(log(page).filter({ hasText: /^keydown\s+Space 32$/ })).toHaveCount(1)
  await p1.release()
  await p1.ctx.close()
})

test('a phone in Touchpad mode is the mouse and keyboard: moves, clicks, right-clicks and types into a nested game frame', async ({ page, browser }) => {
  await openShasta(page)
  await visit(page, `${SITE}/mouse`, 'Mouse Game')
  const code = await openRoom(page)
  const p1 = await joinPhone(browser, code, 1)
  await p1.phone.getByRole('button', { name: 'Touchpad' }).click()
  const pad = (await p1.phone.getByLabel('Touchpad').boundingBox())!
  const cdp = await p1.ctx.newCDPSession(p1.phone)
  const touch = (type: string, points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ ...p, id: i + 1 })) })
  const cx = pad.x + pad.width / 2
  const cy = pad.y + pad.height / 2
  const inner = pageFrame(page).frameLocator('#inner')
  const log = inner.locator('#log li')

  // the cursor starts in the middle of the tab; slide up-left onto the canvas (top-left of the page), then tap
  await touch('touchStart', [{ x: cx, y: cy }])
  for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: cx - i * 15, y: cy - i * 8 }])
  await touch('touchEnd', [])
  await expect(page.locator('[data-shasta-phone-cursor]')).toBeVisible()
  await page.waitForTimeout(400)
  await touch('touchStart', [{ x: cx, y: cy }])
  await touch('touchEnd', [])
  await expect(log.filter({ hasText: /^mousedown 0$/ })).toHaveCount(1)
  await expect(log.filter({ hasText: /^click 0$/ })).toHaveCount(1)

  // two-finger tap = right click
  await page.waitForTimeout(400)
  await touch('touchStart', [{ x: cx, y: cy }, { x: cx + 40, y: cy }])
  await touch('touchEnd', [])
  await expect(log.filter({ hasText: /^contextmenu 2$/ })).toHaveCount(1)

  // the Left button, held: down while held, up when released
  const left = (await p1.phone.getByRole('button', { name: 'Left click' }).boundingBox())!
  await touch('touchStart', [{ x: left.x + left.width / 2, y: left.y + left.height / 2 }])
  await expect(log.filter({ hasText: /^mousedown 0$/ })).toHaveCount(2)
  await touch('touchEnd', [])
  await expect(log.filter({ hasText: /^mouseup 0$/ })).toHaveCount(2)

  // a key on the touchpad screen reaches the game as a key
  const space = (await p1.phone.getByRole('button', { name: 'Space', exact: true }).boundingBox())!
  await touch('touchStart', [{ x: space.x + space.width / 2, y: space.y + space.height / 2 }])
  await touch('touchEnd', [])
  await expect(log.filter({ hasText: /^keydown Space$/ })).toHaveCount(1)

  // the phone's own keyboard: letters arrive as key presses
  await p1.phone.getByRole('button', { name: 'Type with the keyboard' }).tap()
  await p1.phone.keyboard.type('hi')
  await expect(log.filter({ hasText: /^keydown Key[HI]$/ })).toHaveCount(2)
  await p1.ctx.close()
})
