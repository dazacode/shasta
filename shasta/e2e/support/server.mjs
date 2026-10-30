// Test harness: serves the built Shasta, a Wisp server that is allowed to reach loopback
// (production forbids it), and a small fixture website. Run with: bun e2e/support/server.mjs
import { createHash } from 'node:crypto'
import http from 'node:http'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { server as wisp } from '../../../server/node_modules/@mercuryworkshop/wisp-js/src/entrypoints/server.mjs'

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
