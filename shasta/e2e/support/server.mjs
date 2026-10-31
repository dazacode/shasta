import zlib from 'node:zlib'
// Test harness: serves the built Shasta, a Wisp server that is allowed to reach loopback
// (production forbids it), and a small fixture website. Run with: bun e2e/support/server.mjs
import { createHash } from 'node:crypto'
import http from 'node:http'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { server as wisp } from '../../../server/node_modules/@mercuryworkshop/wisp-js/src/entrypoints/server.mjs'
// the real phone-controller relay (bun runs the TypeScript directly), for e2e/shell/phonePad.spec.ts
import { handlePadUpgrade } from '../../../server/src/services/padRelay.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(here, '../../dist')
const SHELL_PORT = Number(process.env.SHELL_PORT || 4173)
// cross-origin isolated like production; COI=0 turns it off
const SITE_PORT = Number(process.env.SITE_PORT || 4174)

wisp.options.allow_private_ips = true
wisp.options.allow_loopback_ips = true
wisp.options.allow_udp_streams = false
wisp.options.stream_limit_total = 500

// two Wisp endpoints on one server, switchable on their own, for the fallback tests: /wisp/ and /wisp-alt/
const wispEnabled = { '/wisp/': true, '/wisp-alt/': true }
const sockets = { '/wisp/': new Set(), '/wisp-alt/': new Set() }
process.on('uncaughtException', (e) => console.error('uncaught', e))

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }

// Offline-shell tests (e2e/shell/offline.spec.ts) pretend a new version was deployed: same files, a changed
// index.html, a new version stamped into sw.js and the manifest. `failing` paths answer 500 (a broken deploy).
let deployed = null
const failing = new Set()

async function fakeDeploy(version) {
  const manifest = JSON.parse(await fs.readFile(path.join(DIST, 'offline-manifest.json'), 'utf8'))
  const sw = (await fs.readFile(path.join(DIST, 'sw.js'), 'utf8')).replace(`"${manifest.version}"`, JSON.stringify(version))
  const index = Buffer.from((await fs.readFile(path.join(DIST, 'index.html'), 'utf8')) + `<!-- ${version} -->`)
  const entry = manifest.files.find((f) => f.url === '/index.html')
  entry.size = index.length
  entry.sha256 = createHash('sha256').update(index).digest('hex')
  manifest.version = version
  return { '/sw.js': Buffer.from(sw), '/index.html': index, '/offline-manifest.json': Buffer.from(JSON.stringify(manifest)) }
}

const shell = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/__ctl/wisp') {
    const which = url.searchParams.get('endpoint') === 'alt' ? '/wisp-alt/' : '/wisp/'
    wispEnabled[which] = url.searchParams.get('state') !== 'off'
    if (!wispEnabled[which]) for (const s of sockets[which]) s.destroy()
    return res.writeHead(200).end(wispEnabled[which] ? 'on' : 'off')
  }
  if (url.pathname === '/__ctl/deploy') {
    const v = url.searchParams.get('version')
    deployed = v ? await fakeDeploy(v) : null
    return res.writeHead(200).end(v || 'original')
  }
  if (url.pathname === '/__ctl/fail') {
    failing.clear()
    for (const p of url.searchParams.getAll('path')) failing.add(p)
    return res.writeHead(200).end([...failing].join(','))
  }
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = path.resolve(DIST, '.' + rel)
  try {
    if (failing.has(rel)) return res.writeHead(500).end('broken deploy')
    if (!file.startsWith(DIST)) throw new Error('forbidden')
    const stat = await fs.stat(file)
    if (!stat.isFile()) throw new Error('nf')
    const body = deployed?.[rel]
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': body ? body.length : stat.size, 'Cache-Control': 'no-cache', ...(process.env.COI !== '0' ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', 'Document-Isolation-Policy': 'isolate-and-credentialless' } : {}), ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) })
    if (body) return res.end(body)
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404).end('not found')
  }
})
shell.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/api/pad/ws')) return handlePadUpgrade(req, socket, head)
  const which = Object.keys(wispEnabled).find((p) => req.url.startsWith(p))
  if (!which || !wispEnabled[which]) return socket.destroy()
  sockets[which].add(socket)
  socket.on('close', () => sockets[which].delete(socket))
  wisp.routeRequest(req, socket, head)
})

// 1x1 png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const page = (title, body, head = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/icon.png">${head}</head><body style="font-family:system-ui"><h1 id="h">${title}</h1>${body}</body></html>`

const FLAKY = Buffer.from(Uint8Array.from({ length: 4 * 1048576 }, (_, i) => (i * 31 + 7) & 255))
const flakyStats = new Map()
const site = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const send = (code, type, body, extra = {}) => res.writeHead(code, { 'Content-Type': type, ...extra }).end(body)
  switch (url.pathname) {
    case '/':
      return send(200, 'text/html', page('Fixture Home', `<a id="a" href="/a">A</a> <a id="b" href="/b">B</a> <a id="popup" href="/popup" target="_blank">popup</a> <a id="dl" href="/download">download</a> <a id="slow" href="/slow">slow</a> <a id="redir" href="/redirect">redirect</a> <button id="xhr" onclick="fetch('/api-attachment').then(r=>r.text()).then(t=>document.title='xhr '+t)">xhr</button>`))
    case '/api-attachment':
      // like Google/YouTube APIs: a background request that still says "attachment"
      return send(200, 'text/plain', 'ok', { 'Content-Disposition': 'attachment; filename="f.txt"' })
    case '/a':
      return send(200, 'text/html', page('Page A', `<input id="field" aria-label="field"><p id="tick">0</p><script>let n=0;setInterval(()=>{document.getElementById('tick').textContent=++n},200)</script><a id="tob" href="/b">to B</a>`))
    case '/b':
      return send(200, 'text/html', page('Page B', '<a id="toa" href="/a">to A</a>'))
    case '/popup':
      return send(200, 'text/html', page('Popup Page', '<p>opened by a link</p>'))
    case '/redirect':
      return res.writeHead(302, { Location: '/b' }).end()
    // a game that starts in a worker and needs 64-bit WebAssembly memory: on a Chrome without it (before 133) the worker
    // dies with this exact error (fiveplay.lol on a Chrome 126 school Chromebook)
    case '/old-chrome-game':
      return send(200, 'text/html', page('Memory64 Game', `<canvas id="canvas"></canvas><script>new Worker('/old-chrome-game.js')</script>`))
    case '/old-chrome-game.js':
      return send(200, 'text/javascript', `throw new TypeError('Cannot convert a BigInt value to a number')`)
    // a keyboard-only canvas game: logs every key it receives the way games read them (e2e/shell/game.spec.ts)
    case '/keys':
      return send(200, 'text/html', page('Key Game', `<canvas id="game" width="480" height="270" tabindex="0" style="background:#123"></canvas><ol id="log"></ol><script>for(const t of ['keydown','keyup'])addEventListener(t,e=>{const li=document.createElement('li');li.textContent=t+' '+e.key+' '+e.code+' '+e.keyCode;document.getElementById('log').append(li)})</script>`))
    // a mouse game in a nested frame (like Geometry Dash on its site): logs what the mouse does, plus a text field
    case '/mouse':
      return send(200, 'text/html', page('Mouse Game', `<iframe id="inner" src="/mouse-inner" style="position:absolute;left:0;top:0;width:100%;height:100%;border:0"></iframe>`))
    case '/mouse-inner':
      return send(200, 'text/html', page('Mouse Inner', `<style>body{margin:0}</style><canvas id="game" width="400" height="300" style="display:block;background:#123"></canvas><input id="name" placeholder="name"><ol id="log"></ol><div style="height:3000px"></div><script>const log=t=>{const li=document.createElement('li');li.textContent=t;document.getElementById('log').append(li)};const c=document.getElementById('game');for(const t of ['mousedown','mouseup','click','contextmenu'])c.addEventListener(t,e=>{e.preventDefault();log(t+' '+e.button)});addEventListener('keydown',e=>log('keydown '+e.code))</script>`))
    // a game that reads controllers (Gamepad API), like an emulator: lists every gamepad it sees and its held buttons
    case '/pads':
      return send(200, 'text/html', page('Pad Game', `<canvas id="game" width="480" height="270" style="background:#231"></canvas><p id="pads">none</p><ol id="events"></ol><script>addEventListener('gamepadconnected',e=>{const li=document.createElement('li');li.textContent='connected '+e.gamepad.index;document.getElementById('events').append(li)});(function poll(){const out=[...navigator.getGamepads()].filter(Boolean).map(p=>p.index+':'+p.buttons.map((b,i)=>b.pressed?i:null).filter(i=>i!==null).join('+'));document.getElementById('pads').textContent=out.join(' ')||'none';requestAnimationFrame(poll)})()</script>`))
    case '/slow':
      return void setTimeout(() => send(200, 'text/html', page('Slow Page', '<p>finally</p>')), Number(url.searchParams.get('ms') || 6000))
    case '/spa':
      return send(200, 'text/html', page('SPA', `<button id="push" onclick="history.pushState({},'','/spa/inner');document.title='SPA inner'">push</button>`))
    case '/spa/inner':
      return send(200, 'text/html', page('SPA inner', ''))
    case '/big': {
      // streams N megabytes, for measuring proxy throughput
      const total = Number(url.searchParams.get('mb') || 10) * 1048576
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': total })
      const chunk = Buffer.alloc(65536, 7)
      let sent = 0
      const pump = () => {
        while (sent < total) {
          sent += chunk.length
          if (!res.write(chunk)) return void res.once('drain', pump)
        }
        res.end()
      }
      return pump()
    }
    case '/flaky': {
      // a game-like page fetching one big file whose first download breaks halfway (proxy/resumingTransport.ts)
      return send(200, 'text/html', page('Flaky Download', `<p id="result">loading</p><script>
        const id = Math.random().toString(36).slice(2)
        fetch('/flaky.bin?id=' + id + (location.search.includes('gz') ? '&gz=1' : '')).then(r => r.arrayBuffer()).then(b => {
          const a = new Uint8Array(b); let bad = -1
          for (let i = 0; i < a.length; i++) if (a[i] !== ((i * 31 + 7) & 255)) { bad = i; break }
          document.getElementById('result').textContent = 'bytes ' + a.length + ' bad ' + bad + ' id ' + id
        }, e => { document.getElementById('result').textContent = 'failed ' + e })
      </script>`))
    }
    case '/flaky.bin': {
      const total = FLAKY.length
      const id = url.searchParams.get('id') || ''
      const stats = flakyStats.get(id) ?? { full: 0, ranged: 0 }
      flakyStats.set(id, stats)
      const head = { 'Content-Type': 'application/octet-stream', ETag: '"flaky-v1"', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
      const m = /^bytes=(\d+)-$/.exec(req.headers.range || '')
      // a Range is honoured unless its If-Range names another version (a weak-ETag resume sends none)
      if (m && (req.headers['if-range'] === undefined || req.headers['if-range'] === '"flaky-v1"')) {
        stats.ranged++
        const from = Number(m[1])
        res.writeHead(206, { ...head, 'Content-Length': total - from, 'Content-Range': `bytes ${from}-${total - 1}/${total}` })
        return void res.end(FLAKY.subarray(from))
      }
      stats.full++
      if (url.searchParams.has('gz') && /gzip/.test(req.headers['accept-encoding'] || '')) {
        // like Cloudflare's brotli'd wasm: compressed, weak ETag, no Content-Length; dies a third of the way in
        const gz = zlib.gzipSync(FLAKY, { level: 1 })
        res.writeHead(200, { ...head, ETag: 'W/"flaky-v1"', 'Content-Encoding': 'gzip' })
        if (stats.full === 1) return void res.write(gz.subarray(0, Math.floor(gz.length / 3)), () => setTimeout(() => res.socket?.destroy(), 200))
        return void res.end(gz)
      }
      res.writeHead(200, { ...head, 'Content-Length': total })
      // the first full download dies halfway, like a tunnel hiccup (libcurl error 56 in the browser)
      if (stats.full === 1) return void res.write(FLAKY.subarray(0, total / 2), () => setTimeout(() => res.socket?.destroy(), 200))
      return void res.end(FLAKY)
    }
    case '/flaky-stats':
      return send(200, 'application/json', JSON.stringify(flakyStats.get(url.searchParams.get('id') || '') ?? null))
    case '/icon.png':
      return send(200, 'image/png', PNG)
    case '/download': {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fixture.bin"', 'Content-Length': 200000 })
      let sent = 0
      const t = setInterval(() => {
        const chunk = Buffer.alloc(20000, 1)
        res.write(chunk)
        sent += chunk.length
        if (sent >= 200000) {
          clearInterval(t)
          res.end()
        }
      }, 150)
      res.on('close', () => clearInterval(t))
      return
    }
    default:
      return send(404, 'text/html', page('Not Found', '<p>nothing here</p>'))
  }
})

shell.listen(SHELL_PORT, () => console.log(`shell http://localhost:${SHELL_PORT}`))
site.listen(SITE_PORT, () => console.log(`site http://localhost:${SITE_PORT}`))
