// Shasta's emulator app shell, shared by every apps/emu-* app (scripts/build-emulators.ts writes config.json next to it).
// The library page keeps the person's own game and BIOS files in this app's IndexedDB; playing hands one file to the
// app's engine: EmulatorJS (ejs/, which keeps in-game saves and save states in its own IndexedDB on the same origin),
// Ruffle (ruffle/), v86 (v86/), Boxedwine (boxedwine/play.html, its own page) or container2wasm (c2w/).
// Nothing here talks to a server: the app works offline once it is open.

const $ = (id) => document.getElementById(id)
const cfg = await (await fetch('config.json')).json()

// ---------- storage ----------
const DB_NAME = 'shasta-retro'
let dbp
function db() {
  dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open(DB_NAME, 2)
    r.onupgradeneeded = () => {
      const have = r.result.objectStoreNames
      if (!have.contains('games')) r.result.createObjectStore('games', { keyPath: 'id' })
      if (!have.contains('bios')) r.result.createObjectStore('bios', { keyPath: 'system' })
      // v2: what boxedwine/play.html should run (one record, "current")
      if (!have.contains('launch')) r.result.createObjectStore('launch')
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
  return dbp
}
async function tx(store, mode, fn) {
  const d = await db()
  return new Promise((ok, fail) => {
    const t = d.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => ok(req?.result)
    t.onerror = t.onabort = () => fail(t.error)
  })
}
const all = (store) => tx(store, 'readonly', (s) => s.getAll())
const get = (store, key) => tx(store, 'readonly', (s) => s.get(key))
const put = (store, value) => tx(store, 'readwrite', (s) => s.put(value))
const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key))

// ---------- helpers ----------
const extOf = (name) => (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase()
const ARCHIVES = ['zip', '7z']
const sysById = (id) => cfg.systems.find((s) => s.id === id)
const loadScript = (src) =>
  new Promise((ok, fail) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = ok
    s.onerror = () => fail(new Error(`could not load ${src}`))
    document.body.append(s)
  })
function size(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v)
  }
  for (const k of kids) if (k != null) e.append(k)
  return e
}
function notice(text, ok = false) {
  const n = $('notice')
  n.hidden = !text
  n.textContent = text || ''
  n.classList.toggle('ok', ok)
}
function choose(title, text, options) {
  return new Promise((resolve) => {
    const d = $('choose')
    $('choose-title').textContent = title
    $('choose-text').textContent = text
    const list = $('choose-list')
    list.replaceChildren(...options.map((o) => el('button', { value: o.value, class: o.primary ? 'primary' : '' }, o.label)))
    d.onclose = () => resolve(d.returnValue === 'cancel' ? null : d.returnValue)
    d.returnValue = 'cancel'
    d.showModal()
  })
}

// ---------- page ----------
$('summary').textContent = cfg.summary
if (cfg.demanding) {
  const warn = el('p', { class: 'notice', role: 'note' }, el('strong', {}, 'Heads up: '), cfg.demanding)
  $('drop').before(warn)
}
const exts = [...new Set(cfg.systems.flatMap((s) => s.ext))]
// an app that runs only what it includes (the Linux terminal) has nothing to open
if (!exts.length) $('drop').hidden = true
$('opens').textContent = `Opens ${exts.map((e) => '.' + e).join(' ')}${exts.some((e) => ARCHIVES.includes(e)) ? '' : ', or any of them in a .zip'}`
$('disc').hidden = !cfg.systems.some((s) => s.disc)

async function renderBios() {
  const needing = cfg.systems.filter((s) => s.bios)
  $('bios').hidden = !needing.length
  if (!needing.length) return
  const have = new Map((await all('bios')).map((b) => [b.system, b]))
  const NEED = { required: 'Needed', optional: 'Optional', cd: 'For CD games' }
  $('bios-list').replaceChildren(
    ...needing.map((s) => {
      const b = have.get(s.id)
      return el(
        'li',
        {},
        el('div', { class: 'grow' }, el('div', { class: 'name' }, s.label), el('div', { class: 'muted small' }, b ? `Added: ${b.name} (${size(b.file.size)})` : s.bios.files)),
        el('span', { class: `tag ${b ? 'have' : s.bios.need === 'required' ? 'need' : ''}` }, b ? 'Added' : NEED[s.bios.need]),
        b ? el('button', { onclick: async () => { await del('bios', s.id); renderBios() } }, 'Remove') : el('button', { onclick: () => pickBios(s) }, 'Add'),
      )
    }),
  )
}

function pickBios(sys) {
  return new Promise((resolve) => {
    const input = $('bios-file')
    input.value = ''
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(false)
      try {
        await put('bios', { system: sys.id, name: f.name, file: f })
        notice(`Added ${f.name} for ${sys.label}.`, true)
      } catch {
        notice('This browser would not store that file. Check that it has storage space and is not in a private window.')
        return resolve(false)
      }
      await renderBios()
      resolve(true)
    }
    input.click()
  })
}

async function renderLibrary() {
  const games = (await all('games')).sort((a, b) => (b.played || b.added) - (a.played || a.added))
  $('library').hidden = !games.length
  $('games').replaceChildren(
    ...games.map((g) =>
      el(
        'li',
        {},
        el('button', { class: 'play', onclick: () => play(g), title: `Play ${g.name}` }, el('span', { class: 'title' }, g.name.replace(/\.[^.]+$/, '')), el('span', { class: 'meta' }, `${sysById(g.system)?.label ?? g.system} · ${size(g.file.size)}`)),
        el('button', { class: 'del', 'aria-label': `Remove ${g.name} from this list`, title: 'Remove from this list (keeps its saves)', onclick: async () => { await del('games', g.id); renderLibrary(); usage() } }, '✕'),
      ),
    ),
  )
}

function renderFree() {
  $('free').hidden = !cfg.free.length
  $('free-list').replaceChildren(
    ...cfg.free.map((f) =>
      el('li', {}, el('button', { class: 'play', onclick: () => playFree(f), title: `Start ${f.name}` }, el('span', { class: 'title' }, f.name), el('span', { class: 'meta' }, f.note))),
    ),
  )
}

async function playFree(f) {
  // the Linux image is fetched by its worker, in chunks
  if (cfg.engine === 'c2w') return play({ id: `free:${f.file}`, name: f.name, system: f.system, image: f.file, chunks: f.chunks, free: true })
  try {
    const res = await fetch(f.file)
    if (!res.ok) throw new Error(String(res.status))
    play({ id: `free:${f.file}`, name: f.name, system: f.system, file: await res.blob(), drive: f.drive, free: true })
  } catch {
    notice(`${f.name} could not be loaded.`)
  }
}

async function usage() {
  try {
    const { usage: used } = await navigator.storage.estimate()
    $('usage').textContent = used ? `Using ${size(used)} of this browser's storage.` : ''
  } catch {}
}

// ---------- opening a file ----------
async function systemFor(file) {
  const ext = extOf(file.name)
  let fits = cfg.systems.filter((s) => s.ext.includes(ext))
  if (!fits.length && ARCHIVES.includes(ext)) fits = cfg.systems
  if (!fits.length) {
    notice(`${cfg.name} doesn't open .${ext || '(no extension)'} files. It opens ${exts.map((e) => '.' + e).join(' ')}.`)
    return null
  }
  if (fits.length === 1) return fits[0]
  const pick = await choose('Which system is this game for?', file.name, fits.map((s) => ({ value: s.id, label: s.label })))
  return pick ? sysById(pick) : null
}

async function open(file) {
  notice('')
  const sys = await systemFor(file)
  if (!sys) return
  const id = `${sys.id}:${file.name}:${file.size}`
  const game = { id, name: file.name, system: sys.id, added: Date.now(), played: 0, file }
  try {
    await put('games', game)
  } catch {
    // too big for this browser's storage (or a private window): still playable now, just not kept in the list
    notice(`${file.name} is playing, but this browser had no room to keep it in Your games.`)
  }
  play(game)
}

$('pick').onclick = () => $('file').click()
$('file').onchange = () => {
  const f = $('file').files?.[0]
  $('file').value = ''
  if (f) open(f)
}
const drop = $('drop')
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target === drop) $('file').click()
})
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over') })
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  const f = e.dataTransfer?.files?.[0]
  if (f) open(f)
})
// a file dropped anywhere else on the page should not navigate the frame away
addEventListener('dragover', (e) => e.preventDefault())
addEventListener('drop', (e) => e.preventDefault())

// ---------- playing ----------
let playing = false
async function play(game) {
  if (playing) return
  const sys = sysById(game.system)
  if (!sys) return notice('This game was added for a system this app no longer has.')
  if (sys.threads && !(self.crossOriginIsolated && typeof SharedArrayBuffer === 'function')) {
    return notice(`${sys.label} needs a browser feature (shared memory for threads) that isn't available here. Open ${cfg.name} from Shasta's Library to play.`)
  }
  let bios = sys.bios ? await get('bios', sys.id) : null
  if (sys.bios?.need === 'required' && !bios) {
    const go = await choose(`${sys.label} needs its BIOS`, `This system won't start without ${sys.bios.files}. Shasta can't include it: add the file from your own console.`, [{ value: 'add', label: 'Add the BIOS file', primary: true }])
    if (go !== 'add' || !(await pickBios(sys))) return
    bios = await get('bios', sys.id)
  }
  playing = true
  if (!game.free) put('games', { ...game, played: Date.now() }).catch(() => {})

  $('home').hidden = true
  $('player').hidden = false
  $('now').textContent = game.name === sys.label ? game.name : `${game.name} · ${sys.label}`
  try {
    await ENGINES[cfg.engine](game, sys, bios)
  } catch (e) {
    console.error(e)
    $('game').replaceChildren(el('p', { class: 'muted', style: 'padding:24px' }, `${cfg.name} could not start: ${e.message || e}`))
  }
}

const ENGINES = { emulatorjs: playEmulatorJS, ruffle: playRuffle, v86: playV86, boxedwine: playBoxedwine, c2w: playLinux }

function playEmulatorJS(game, sys, bios) {
  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: sys.id,
    EJS_gameUrl: new File([game.file], game.name),
    EJS_gameName: game.name.replace(/\.[^.]+$/, ''),
    EJS_pathtodata: 'ejs/',
    EJS_biosUrl: bios ? new File([bios.file], bios.name) : '',
    EJS_startOnLoaded: true,
    EJS_threads: !!sys.threads,
    EJS_color: cfg.colors[0],
    EJS_backgroundColor: '#000',
  })
  return loadScript('ejs/loader.js')
}

async function playRuffle(game) {
  // a self-contained .swf only: no address of its own, so it cannot load extra files from the web
  window.RufflePlayer = { config: { publicPath: 'ruffle/', autoplay: 'on', unmuteOverlay: 'hidden', letterbox: 'on', showSwfDownload: false, splashScreen: false, openUrlMode: 'deny', allowNetworking: 'none' } }
  await loadScript('ruffle/ruffle.js')
  const player = window.RufflePlayer.newest().createPlayer()
  player.style.width = '100%'
  player.style.height = '100%'
  $('game').append(player)
  const api = typeof player.ruffle === 'function' ? player.ruffle() : player
  await api.load({ data: new Uint8Array(await game.file.arrayBuffer()), swfFileName: game.name })
  window.SHASTA_RUFFLE = player
}

async function playV86(game) {
  await loadScript('v86/libv86.js')
  const screen = el('div', { id: 'screen', style: 'width:100%;height:100%;display:grid;place-items:center;background:#000;overflow:hidden' },
    el('div', { style: 'white-space:pre;font:14px monospace;line-height:14px;color:#ccc' }),
    el('canvas', { style: 'display:none' }))
  $('game').append(screen)
  const buffer = await game.file.arrayBuffer()
  const ext = extOf(game.name)
  // a CD by its type; a floppy by its size (up to 2.88 MB); everything else is a hard disk
  const drive = game.drive || (ext === 'iso' ? 'cdrom' : buffer.byteLength <= 2949120 ? 'fda' : 'hda')
  const emulator = new window.V86({
    wasm_path: 'v86/v86.wasm',
    memory_size: 128 * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    screen_container: screen,
    bios: { url: 'v86/seabios.bin' },
    vga_bios: { url: 'v86/vgabios.bin' },
    [drive]: { buffer },
    boot_order: drive === 'cdrom' ? 0x123 : drive === 'fda' ? 0x321 : 0x213,
    autostart: true,
  })
  screen.addEventListener('click', () => emulator.lock_mouse?.())
  window.SHASTA_V86 = emulator
}

function saveNow() {
  try {
    window.EJS_emulator?.gameManager?.saveSaveFiles()
  } catch {}
}
$('back').onclick = () => {
  // EmulatorJS cannot be torn down in place: write the in-game save, give IndexedDB a moment, start fresh
  saveNow()
  $('back').disabled = true
  setTimeout(() => location.reload(), 500)
}
addEventListener('pagehide', saveNow)
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow()
})

// ---------- Windows programs (Boxedwine) ----------
// Boxedwine mounts one zip at C:\files and runs one program from it. A lone .exe is wrapped in a zip here; for a zip,
// the person picks the program when there is more than one.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function zipOne(name, bytes) {
  const n = new TextEncoder().encode(name)
  const crc = crc32(bytes)
  const local = new DataView(new ArrayBuffer(30))
  ;[[0, 0x04034b50, 4], [4, 20, 2], [14, crc, 4], [18, bytes.length, 4], [22, bytes.length, 4], [26, n.length, 2]].forEach(([o, v, w]) => (w === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true)))
  const central = new DataView(new ArrayBuffer(46))
  ;[[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [16, crc, 4], [20, bytes.length, 4], [24, bytes.length, 4], [28, n.length, 2]].forEach(([o, v, w]) => (w === 4 ? central.setUint32(o, v, true) : central.setUint16(o, v, true)))
  const end = new DataView(new ArrayBuffer(22))
  const cdOffset = 30 + n.length + bytes.length
  ;[[0, 0x06054b50, 4], [8, 1, 2], [10, 1, 2], [12, 46 + n.length, 4], [16, cdOffset, 4]].forEach(([o, v, w]) => (w === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)))
  return new Blob([local, n, bytes, central, n, end])
}
/** Names of the files in a zip, from its central directory. */
function zipNames(buf) {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) return null
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const names = []
  for (let i = 0; i < count && p + 46 <= buf.byteLength; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const len = v.getUint16(p + 28, true)
    names.push(new TextDecoder().decode(new Uint8Array(buf, p + 46, len)))
    p += 46 + len + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
  }
  return names
}
const C_FILES = '/home/username/.wine/dosdevices/c:/files'
async function playBoxedwine(game) {
  const buf = await game.file.arrayBuffer()
  let zip, zipName, program
  if (extOf(game.name) === 'exe') {
    zipName = 'game.zip'
    program = game.name.replace(/[^\w.-]/g, '_')
    zip = zipOne(program, new Uint8Array(buf))
  } else {
    const exes = (zipNames(buf) ?? []).filter((n) => /\.(exe|bat)$/i.test(n) && !n.startsWith('__MACOSX/'))
    if (!exes.length) throw new Error('that .zip has no Windows program (.exe) in it')
    let pick = exes[0]
    if (exes.length > 1) {
      pick = await choose('Which program should start?', game.name, exes.map((n) => ({ value: n, label: n })))
      if (!pick) return location.reload()
    }
    zip = game.file
    const parts = pick.split('/')
    // Boxedwine starts in the program's folder when the zip is named after it; otherwise give it the full path
    if (parts.length === 2 && /^[\w.-]+$/.test(parts[0])) {
      zipName = `${parts[0]}.zip`
      program = parts[1]
    } else {
      zipName = 'game.zip'
      program = parts.length === 1 ? pick : `${C_FILES}/${pick}`
    }
  }
  // Boxedwine runs batch files through cmd only when it sees a lowercase .bat (Wine finds the file either way)
  program = program.replace(/\.bat$/i, '.bat')
  await tx('launch', 'readwrite', (s) => s.put({ zip, zipName, title: game.name }, 'current'))
  location.href = `boxedwine/play.html?app=${encodeURIComponent(zipName).replace(/%2E/gi, '.')}&p=${program.replace(/ /g, '%20')}`
}

// ---------- Linux terminal (container2wasm) ----------
async function playLinux(game) {
  const css = el('link', { rel: 'stylesheet', href: 'c2w/xterm.css' })
  document.head.append(css)
  await loadScript('c2w/xterm.js')
  await loadScript('c2w/xterm-pty.js')
  const box = el('div', { style: 'width:100%;height:100%;padding:8px;box-sizing:border-box;background:#000' })
  $('game').append(box)
  const term = new window.Terminal({ fontSize: 15, cursorBlink: true, theme: { background: '#000000' } })
  term.open(box)
  // fit the terminal to the frame (xterm.js's fit addon, by hand)
  const fit = () => {
    const cell = term._core?._renderService?.dimensions?.css?.cell
    if (cell?.width && cell?.height) term.resize(Math.max(20, Math.floor((box.clientWidth - 16) / cell.width)), Math.max(8, Math.floor((box.clientHeight - 16) / cell.height)))
  }
  fit()
  addEventListener('resize', fit)
  term.write('Starting Debian Linux. The first start downloads about 70 MB and can take a minute or two...\r\n')
  const { master, slave } = window.openpty()
  const t = slave.ioctl('TCGETS')
  t.iflag &= ~(window.ISTRIP | window.INLCR | window.IGNCR | window.ICRNL | window.IXON)
  t.oflag &= ~window.OPOST
  t.lflag &= ~(window.ECHO | window.ECHONL | window.ICANON | window.ISIG | window.IEXTEN)
  slave.ioctl('TCSETS', new window.Termios(t.iflag, t.oflag, t.cflag, t.lflag, t.cc))
  term.loadAddon(master)
  const worker = new Worker('c2w/worker.js')
  worker.addEventListener('message', (e) => {
    if (e.data?.type === 'shasta-error') term.write(`\r\nLinux could not start: ${e.data.message}\r\n`)
  })
  worker.postMessage({ type: 'init', imagename: new URL(game.image, location.href).href, chunks: game.chunks })
  new window.TtyServer(slave).start(worker)
  term.focus()
  window.SHASTA_LINUX = { term, worker }
}

// ---------- licences ----------
$('licences').onclick = () => {
  const body = $('about-body')
  const ejs = cfg.engine === 'emulatorjs'
  body.replaceChildren(
    el('p', {}, ejs ? `${cfg.name} runs EmulatorJS ${cfg.version} (GPL-3.0) with these libretro cores, built for the web by the EmulatorJS project. Their source code is at the addresses below.` : `${cfg.name} is made with this free software. Its source code is at the addresses below.`),
    el('ul', {}, ...cfg.cores.map((c) => el('li', {}, `${c.name} — ${c.licence === 'non-commercial' ? 'free for non-commercial use' : c.licence}`, el('br'), el('code', {}, c.url)))),
    ejs ? el('p', {}, 'EmulatorJS: ', el('code', {}, 'https://github.com/EmulatorJS/EmulatorJS')) : null,
  )
  $('about').showModal()
}

renderBios()
renderFree()
renderLibrary()
usage()
