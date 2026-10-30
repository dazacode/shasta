import { chromium } from '@playwright/test'
const base = process.env.BASE || 'http://127.0.0.1:8099'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Watch', exact: true }).first().click()
await page.getByRole('heading', { name: 'Watch' }).waitFor()
await page.getByRole('searchbox').fill('fight club')
await page.waitForTimeout(3500)
await page.locator('button[data-card]').first().click()
await page.waitForTimeout(20000)
const chips = await page.locator('button', { hasText: /^(VidSrc|2Embed|VidLink|MultiEmbed)/ }).allInnerTexts()
const body = await page.locator('body').innerText()
const failed = /could not load this page|failed to load|failed with error/i.test(body)
// canvases/videos inside the (same-origin, proxied) iframe
const inner = await page.evaluate(() => {
  const f = document.querySelector('iframe')
  try {
    const d = f && f.contentDocument
    return { video: d?.querySelectorAll('video').length ?? 0, frames: d?.querySelectorAll('iframe').length ?? 0, hasError: !!d?.querySelector('meta[name="shasta-error"]') }
  } catch { return { cross: true } }
})
await page.screenshot({ path: '/tmp/watch-play2.png' })
console.log('sources:', JSON.stringify(chips.slice(0, 5)), 'embedFailed:', failed)
console.log('iframe inner:', JSON.stringify(inner))
console.log('pageerrors:', errs.length ? errs : 'none')
await b.close()
