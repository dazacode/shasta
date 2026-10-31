// Internet Archive games (proxy/archivePlayer.ts): the player starts without a click on its power button, the screen
// fills the tab at its own aspect ratio, and Enter inserts a coin and starts an arcade game. Needs the network.
import { test, expect, type Frame, type Page } from '@playwright/test'
import { go, openShasta } from '../support/helpers'

test.use({ baseURL: 'http://localhost:4173', locale: 'en-US' })

async function openGame(page: Page, id: string): Promise<Frame> {
  await openShasta(page)
  await go(page, `https://archive.org/embed/${id}`)
  await expect.poll(() => page.frames().find((f) => f.url().includes('archive.org')) ?? null, { timeout: 30_000 }).not.toBeNull()
  return page.frames().find((f) => f.url().includes('archive.org'))!
}

const screenBox = (f: Frame) =>
  f.evaluate(() => {
    const c = document.querySelector('#canvasholder canvas') as HTMLCanvasElement | null
    if (!c || getComputedStyle(document.getElementById('canvasholder')!).visibility !== 'visible') return null
    const r = c.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, aspect: c.width / c.height, vw: innerWidth, vh: innerHeight }
  })

for (const id of ['arcade_1942', 'msdos_Prince_of_Persia_1990']) {
  test(`${id} starts by itself and fills the tab`, async ({ page }) => {
    test.setTimeout(120_000)
    const f = await openGame(page, id)
    await expect.poll(() => screenBox(f).then((b) => (b ? Math.round(b.h) : 0)), { timeout: 60_000 }).toBeGreaterThan(600)
    const b = (await screenBox(f))!
    // touches two opposite edges, centred, not stretched
    expect(Math.min(Math.abs(b.w - b.vw), Math.abs(b.h - b.vh))).toBeLessThan(2)
    expect(Math.abs(b.x * 2 + b.w - b.vw)).toBeLessThan(2)
    expect(Math.abs(b.y * 2 + b.h - b.vh)).toBeLessThan(2)
    expect(Math.abs(b.w / b.h - b.aspect)).toBeLessThan(0.02)
  })
}

test('Enter inserts a coin and starts an arcade game', async ({ page }) => {
  test.setTimeout(120_000)
  const f = await openGame(page, 'arcade_1942')
  await expect.poll(() => screenBox(f).then(Boolean), { timeout: 60_000 }).toBe(true)
  await f.evaluate(() => {
    const w = window as unknown as { __keys: string[] }
    w.__keys = []
    addEventListener('keydown', (e) => w.__keys.push(e.key), true)
  })
  await page.mouse.click(640, 400)
  await page.keyboard.press('Enter')
  await expect.poll(() => f.evaluate(() => (window as unknown as { __keys: string[] }).__keys.join(',')), { timeout: 5000 }).toContain('5')
  await expect.poll(() => f.evaluate(() => (window as unknown as { __keys: string[] }).__keys.join(',')), { timeout: 5000 }).toContain('1')
})
