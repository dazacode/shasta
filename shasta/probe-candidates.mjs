import { chromium } from '@playwright/test'
const CAND = [
  ['vidlink.pro', 'https://vidlink.pro/movie/550'],
  ['embed.su', 'https://embed.su/embed/movie/550'],
  ['vidsrc.to', 'https://vidsrc.to/embed/movie/550'],
  ['2embed.cc', 'https://www.2embed.cc/embed/550'],
  ['multiembed.mov', 'https://multiembed.mov/?video_id=550&tmdb=1'],
  ['111movies', 'https://111movies.com/movie/550'],
  ['vidbinge', 'https://vidbinge.com/movie/550'],
  ['vidora', 'https://vidora.su/movie/550'],
  ['moviesapi.club', 'https://moviesapi.club/movie/550'],
  ['autoembed.cc', 'https://autoembed.cc/embed/movie/550'],
  ['smashy', 'https://player.smashy.stream/movie/550'],
  ['hexa.watch', 'https://hexa.watch/watch/movie/550'],
  ['superembed', 'https://www.superembed.stream/embed/movie/550'],
  ['vidcore', 'https://vidcore.net/movie/550'],
  ['primesrc', 'https://primesrc.me/embed/movie/550'],
  ['vidsrc.cc', 'https://vidsrc.cc/v2/embed/movie/550'],
  ['vidsrc.vip', 'https://vidsrc.vip/embed/movie/550'],
]
const b = await chromium.launch()
for (const [name, url] of CAND) {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 560 } })
  const page = await ctx.newPage()
  let status = 0
  page.on('response', (r) => { if (r.url() === url || r.url().startsWith(url)) status = r.status() })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 22000 })
    await page.waitForTimeout(13000)
    let videos = 0, frames = 0
    for (const f of page.frames()) { frames++; videos += await f.locator('video').count().catch(() => 0) }
    const title = (await page.title().catch(() => '')).slice(0, 32)
    console.log(`${name.padEnd(16)} http=${String(status).padEnd(4)} frames=${String(frames).padEnd(3)} video=${videos}  "${title}"`)
    await page.screenshot({ path: `/tmp/c-${name.replace(/\W/g, '_')}.png` })
  } catch (e) {
    console.log(`${name.padEnd(16)} ERROR ${e.message.slice(0, 60)}`)
  }
  await ctx.close()
}
await b.close()
