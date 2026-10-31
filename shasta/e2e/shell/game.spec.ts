import { expect, test } from '@playwright/test'
import { SITE, activeTab, omnibox, openShasta, pageFrame, visit } from '../support/helpers'

const log = (page: import('@playwright/test').Page) => pageFrame(page).locator('#log li')

test('a game:// tab opens on the launcher splash and fades into the game once its canvas is up', async ({ page }) => {
  await page.addInitScript((site) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('shasta-game-tip-v1', '1')
    localStorage.setItem(
      'shasta-session',
      JSON.stringify({
        version: 1,
        activeId: 't1',
        groups: [],
        closed: [],
        tabs: [{ id: 't1', url: `${site}/keys`, title: 'Key Game', pinned: false, groupId: null, app: { id: 'key-game', slug: 'key-game', scheme: 'game', name: 'Key Game', iconUrl: null, kind: 'linked', home: `${site}/keys` } }],
      }),
    )
  }, SITE)
  await openShasta(page)
  const splash = page.getByRole('status', { name: /^Key Game:/ })
  await expect(splash).toBeVisible()
  await expect(splash.getByRole('heading', { name: 'Key Game' })).toBeVisible()
  await expect(splash.getByRole('button', { name: 'Controls' })).toBeVisible()
  // it leaves by itself once the game's canvas is on screen
  await expect(splash).toHaveCount(0, { timeout: 30_000 })
  await expect(pageFrame(page).locator('#game')).toBeVisible()
  // a game:// tab is in game mode while in front, and the game-mode bar offers the controls
  await expect(page.getByRole('button', { name: /Game mode/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Controls', exact: true })).toBeVisible()
})

test('a remapped key reaches the game as the key it expects (key, code and keyCode)', async ({ page }) => {
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  await page.getByRole('button', { name: /^Shasta menu/ }).click()
  await page.getByRole('menuitem', { name: /Controls & controller/ }).click()
  const dialog = page.getByRole('dialog', { name: /Controls for/ })
  await dialog.getByRole('button', { name: 'Remap a key' }).click()
  await page.keyboard.press('KeyW')
  await page.keyboard.press('ArrowUp')
  await expect(dialog.getByRole('listitem').filter({ hasText: /^W.*↑/ })).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Done' }).click()

  await pageFrame(page).locator('#game').click()
  await page.keyboard.press('KeyW')
  await expect(log(page).filter({ hasText: 'keydown ArrowUp ArrowUp 38' })).toHaveCount(1)
  await expect(log(page).filter({ hasText: 'keyup ArrowUp ArrowUp 38' })).toHaveCount(1)
  await expect(log(page).filter({ hasText: /KeyW/ })).toHaveCount(0)
  // other keys pass through untouched
  await page.keyboard.press('KeyZ')
  await expect(log(page).filter({ hasText: 'keydown z KeyZ 90' })).toHaveCount(1)
  // saved for this site on this device
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shasta-game-controls') || 'null'))
  expect(Object.values(saved.profiles)[0]).toMatchObject({ keys: { KeyW: 'ArrowUp' } })
  await expect(omnibox(page)).toBeVisible()
})

test('a controller button is sent to the game as a key in game mode', async ({ page }) => {
  // a fake controller: button A held while window.__padA is true
  await page.addInitScript(() => {
    // the init script runs in every frame too: all of them read the flag from the top window
    const w = (window.top ?? window) as Window & { __padA?: boolean }
    const pad = () => ({ id: 'Test Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(), axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0 && !!w.__padA, touched: false, value: i === 0 && w.__padA ? 1 : 0 })) })
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad()], configurable: true })
  })
  await openShasta(page)
  await visit(page, `${SITE}/keys`, 'Key Game')
  await expect(activeTab(page)).toBeVisible()
  await page.keyboard.press('Alt+Shift+G')
  await expect(page.getByRole('button', { name: /Game mode/ })).toBeVisible()
  await page.evaluate(() => ((window as Window & { __padA?: boolean }).__padA = true))
  await expect(log(page).filter({ hasText: /^keydown\s+Space 32$/ })).toHaveCount(1)
  await page.evaluate(() => ((window as Window & { __padA?: boolean }).__padA = false))
  await expect(log(page).filter({ hasText: /^keyup\s+Space 32$/ })).toHaveCount(1)
})
