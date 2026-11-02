import { chromium } from 'playwright'
const S = process.argv[2]
const server = Bun.serve({ port: 4517, fetch: () => new Response(Bun.file(S + '/pkg/index.html'), { headers: { 'content-type': 'text/html' } }) })
const b = await chromium.launch({ channel: 'chrome' })
for (const mode of ['no-turn', 'turn-blocked']) {
  const ctx = await b.newContext()
  await ctx.route(/\/stratus\/session\/[^/]+\/start$/, async (route) => {
    const r = await route.fetch(); const j = await r.json()
    if (mode === 'no-turn') j.ice_servers = (j.ice_servers || []).filter((s) => !String(s.urls).includes('turn'))
    else j.ice_servers = (j.ice_servers || []).map((s) => ({ ...s, urls: [].concat(s.urls).map((u) => u.replace(/:(\d+)/, ':9')) })) // an unreachable port
    console.log(mode, 'ice', JSON.stringify(j.ice_servers.map((s) => s.urls)))
    await route.fulfill({ response: r, json: j })
  })
  await ctx.addInitScript(() => { const P = window.RTCPeerConnection; window.RTCPeerConnection = function (c) { const pc = new P(c); pc.addEventListener('iceconnectionstatechange', () => console.log('ICE ' + pc.iceConnectionState)); return pc }; window.RTCPeerConnection.prototype = P.prototype })
  const page = await ctx.newPage(); const t0 = Date.now()
  page.on('console', (m) => /^ICE/.test(m.text()) && console.log(mode, ((Date.now() - t0) / 1000).toFixed(1) + 's', m.text()))
  await page.goto('http://localhost:4517/')
  let last = ''
  const until = Date.now() + 90_000
  while (Date.now() < until) {
    const s = await page.evaluate(() => [document.querySelector('#pmsg')?.innerText, document.querySelector('#overlay.gone') ? 'STREAMING' : ''].filter(Boolean).join(' | ').replace(/\s+/g, ' ')).catch(() => '')
    if (s !== last) { console.log(mode, ((Date.now() - t0) / 1000).toFixed(1) + 's', s); last = s }
    if (/STREAMING|Try again/.test(s)) break
    await page.waitForTimeout(500)
  }
  await ctx.close()
}
await b.close(); server.stop()
