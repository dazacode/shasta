// Builds Shasta's retro emulator apps (apps/emu-*, gitignored) from scripts/emulators/: the shared library shell, the
// catalog of systems, and the engines from npm (EmulatorJS + its libretro cores, Ruffle, v86). The server publishes every apps/* folder with a
// shasta.json into the Official storefront (server/src/services/builtin.ts), so a build here ships with the next start.
//   bun scripts/build-emulators.ts                  build (downloads are cached in .cache/emulators)
//   bun scripts/build-emulators.ts --update-lock    accept new package hashes (after changing EJS_VERSION or cores)
//   bun scripts/build-emulators.ts --icons          redraw scripts/emulators/icons/*.png (committed) from the catalog
//   bun scripts/build-emulators.ts --only=nes,gba   build some apps only
// Every package is checked against scripts/emulators/lock.json, and EmulatorJS is patched so it never contacts its own
// CDN or netplay server: the apps run entirely from their own origin, and offline.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APPS, CORES, type Core, type EmulatorApp } from './emulators/catalog'

/** EmulatorJS and core release; bump APP_VERSION with it so installed apps update. */
const EJS_VERSION = '4.2.3'
const RUFFLE_VERSION = '0.7.1'
const V86_VERSION = '0.5.472'
/** v86's npm package leaves out its BIOS images: taken from the repository at this commit */
const V86_BIOS = 'https://raw.githubusercontent.com/copy/v86/b8a39b11dd2076870699e6cac053556271b9bfab/bios'
/** Flycast WASM (Dreamcast): the release's libretro core, packed into EmulatorJS's core format here */
const FLYCAST = 'https://github.com/nasomers/flycast-wasm/releases/download/v1.0'
const FLYCAST_REPO = 'https://raw.githubusercontent.com/nasomers/flycast-wasm/16e9c7b4b7065a4bd42e7490e8aab3e9283d5415'
/** Boxedwine's web release (multi-threaded build + the Wine 6 file system) */
const BOXEDWINE = 'https://github.com/danoon2/Boxedwine/releases/download/26R1.0/Boxedwine26R1Web.zip'
/** container2wasm: the demo's browser glue at this commit, xterm.js, and the prebuilt Debian (riscv64) image */
const C2W_DEMO = 'https://raw.githubusercontent.com/ktock/container2wasm-demo/8228aaa4a7c9d179cbe266a119e69f58746f1742/docs/src'
const C2W_CHUNKS = 3
/** The version every emulator app is published as: bump it whenever the shell, the catalog or EJS_VERSION changes. */
const APP_VERSION = '1.0.0'

const root = path.resolve(import.meta.dir, '..')
const here = path.join(import.meta.dir, 'emulators')
const cache = path.join(root, '.cache/emulators')
const lockFile = path.join(here, 'lock.json')
const updateLock = process.argv.includes('--update-lock')
const redrawIcons = process.argv.includes('--icons')
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')

const lock: Record<string, string> = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {}

async function fetchPackage(name: string, version = EJS_VERSION): Promise<string> {
	const key = `${name}@${version}`
	const dir = path.join(cache, key.replace('/', '__'))
	if (existsSync(path.join(dir, 'package/package.json')) && lock[key]) return path.join(dir, 'package')
	const meta = await (await fetch(`https://registry.npmjs.org/${name}/${version}`)).json() as { dist?: { tarball: string; integrity: string } }
	if (!meta.dist) throw new Error(`${key} is not on npm`)
	if (lock[key] && lock[key] !== meta.dist.integrity) throw new Error(`${key}: npm now reports a different hash than lock.json`)
	if (!lock[key] && !updateLock) throw new Error(`${key} is not in scripts/emulators/lock.json; run with --update-lock to accept it`)
	const res = await fetch(meta.dist.tarball)
	if (!res.ok) throw new Error(`${key}: download failed (${res.status})`)
	const bytes = new Uint8Array(await res.arrayBuffer())
	const [algo, want] = meta.dist.integrity.split('-')
	const got = createHash(algo).update(bytes).digest('base64')
	if (got !== want) throw new Error(`${key}: the download does not match its ${algo} hash`)
	lock[key] = meta.dist.integrity
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })
	const tgz = path.join(dir, 'package.tgz')
	writeFileSync(tgz, bytes)
	const tar = Bun.spawnSync(['tar', '-xzf', tgz, '-C', dir])
	if (tar.exitCode !== 0) throw new Error(`${key}: could not unpack (${tar.stderr})`)
	rmSync(tgz)
	console.log(`  fetched ${key} (${(bytes.length / 1048576).toFixed(1)} MB)`)
	return path.join(dir, 'package')
}

/** A file that is not an npm package, pinned by its sha256 in lock.json. */
async function fetchFile(url: string): Promise<string> {
	const file = path.join(cache, 'files', createHash('sha256').update(url).digest('hex').slice(0, 16) + '-' + path.basename(new URL(url).pathname))
	if (existsSync(file) && lock[url]) return file
	const res = await fetch(url)
	if (!res.ok) throw new Error(`${url}: download failed (${res.status})`)
	const bytes = new Uint8Array(await res.arrayBuffer())
	const sha = 'sha256-' + createHash('sha256').update(bytes).digest('hex')
	if (lock[url] && lock[url] !== sha) throw new Error(`${url} changed: it no longer matches lock.json`)
	if (!lock[url] && !updateLock) throw new Error(`${url} is not in scripts/emulators/lock.json; run with --update-lock to accept it`)
	lock[url] = sha
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, bytes)
	console.log(`  fetched ${url} (${(bytes.length / 1048576).toFixed(1)} MB)`)
	return file
}

/** Ruffle's self-hosted build (ruffle.js loads its chunks and wasm from the same folder). */
async function ruffleRuntime(out: string) {
	const pkg = await fetchPackage('@ruffle-rs/ruffle', RUFFLE_VERSION)
	mkdirSync(out, { recursive: true })
	for (const f of readdirSync(pkg)) if (f.endsWith('.js') || f.endsWith('.wasm')) cpSync(path.join(pkg, f), path.join(out, f))
	cpSync(path.join(pkg, 'LICENSE_MIT'), path.join(out, 'LICENSE-MIT.txt'))
	cpSync(path.join(pkg, 'LICENSE_APACHE'), path.join(out, 'LICENSE-APACHE.txt'))
}

async function v86Runtime(out: string) {
	const pkg = await fetchPackage('v86', V86_VERSION)
	mkdirSync(out, { recursive: true })
	for (const f of ['libv86.js', 'v86.wasm']) cpSync(path.join(pkg, 'build', f), path.join(out, f))
	cpSync(path.join(pkg, 'LICENSE'), path.join(out, 'LICENSE'))
	for (const f of ['seabios.bin', 'vgabios.bin', 'COPYING.LESSER']) cpSync(await fetchFile(`${V86_BIOS}/${f}`), path.join(out, f === 'COPYING.LESSER' ? 'COPYING-SEABIOS.txt' : f))
}

/** EmulatorJS core file (a zip: js + wasm + core.json + licence) and build report for Flycast WASM. */
async function flycastCore(cores: string) {
	// fflate comes from the backend when it is part of this checkout, otherwise from the frontend's own deps
	const from = existsSync(path.join(root, 'server/package.json')) ? 'server/package.json' : 'shasta/package.json'
	const { zipSync } = createRequire(path.join(root, from))('fflate')
	const read = async (url: string) => new Uint8Array(readFileSync(await fetchFile(url)))
	const core = JSON.parse(new TextDecoder().decode(await read(`${FLYCAST_REPO}/config/core.json`)))
	const tuned = JSON.parse(new TextDecoder().decode(await read(`${FLYCAST_REPO}/config/dreamcast-core-options.json`)))
	delete tuned._comment
	// no BIOS slot: EmulatorJS puts BIOS files beside the game, where Flycast does not look (it wants system/dc/)
	core.options = { ...tuned, reicast_hle_bios: 'enabled' }
	const data = zipSync({
		'flycast_libretro.js': await read(`${FLYCAST}/flycast_libretro.js`),
		'flycast_libretro.wasm': [await read(`${FLYCAST}/flycast_libretro.wasm`), { level: 0 }],
		'core.json': new TextEncoder().encode(JSON.stringify(core)),
		'license.txt': await read(`${FLYCAST_REPO}/LICENSE`),
	})
	writeFileSync(path.join(cores, 'flycast-wasm.data'), data)
	writeFileSync(path.join(cores, 'reports/flycast.json'), JSON.stringify({ core: 'flycast', buildStart: lock[`${FLYCAST}/flycast_libretro.wasm`], options: { defaultWebGL2: true } }))
}

/** Boxedwine's own runtime, our play page around it, and the Wine file system (renamed: packages cannot hold .zip). */
async function boxedwineRuntime(out: string) {
	const zip = await fetchFile(BOXEDWINE)
	const tmp = path.join(cache, 'boxedwine-26R1')
	if (!existsSync(path.join(tmp, 'MultiThreaded/boxedwine.js'))) {
		mkdirSync(tmp, { recursive: true })
		const r = Bun.spawnSync(['unzip', '-qo', zip, 'MultiThreaded/*', '-d', tmp])
		if (r.exitCode !== 0) throw new Error(`boxedwine: could not unpack (${r.stderr})`)
	}
	mkdirSync(out, { recursive: true })
	for (const f of ['boxedwine.js', 'boxedwine.wasm', 'boxedwine-shell.js']) cpSync(path.join(tmp, 'MultiThreaded', f), path.join(out, f))
	cpSync(path.join(tmp, 'MultiThreaded/boxedwine.zip'), path.join(out, 'boxedwine-root.data'))
	for (const f of ['play.html', 'boot.js']) cpSync(path.join(here, 'boxedwine', f), path.join(out, f))
}

/** container2wasm: the demo's WASI glue (Apache-2.0), xterm.js + xterm-pty (MIT), and the Debian image gzipped
 *  (served with Content-Encoding: gzip by the Store, so the browser downloads ~70 MB instead of ~136 MB). */
async function c2wRuntime(out: string, image: string, freeOut: string) {
	mkdirSync(path.join(out, 'browser_wasi_shim'), { recursive: true })
	for (const f of ['worker-util.js', 'wasi-util.js', 'browser_wasi_shim/index.js', 'browser_wasi_shim/wasi_defs.js']) cpSync(await fetchFile(`${C2W_DEMO}/${f}`), path.join(out, f))
	cpSync(await fetchFile(`${C2W_DEMO.replace('/docs/src', '')}/LICENSE`), path.join(out, 'LICENSE'))
	cpSync(path.join(here, 'c2w/worker.js'), path.join(out, 'worker.js'))
	const xterm = await fetchPackage('xterm', '5.1.0')
	cpSync(path.join(xterm, 'lib/xterm.js'), path.join(out, 'xterm.js'))
	cpSync(path.join(xterm, 'css/xterm.css'), path.join(out, 'xterm.css'))
	const pty = await fetchPackage('xterm-pty', '0.9.4')
	cpSync(path.join(pty, 'index.js'), path.join(out, 'xterm-pty.js'))
	cpSync(path.join(pty, 'workerTools.js'), path.join(out, 'workerTools.js'))
	mkdirSync(path.dirname(freeOut), { recursive: true })
	for (let i = 0; i < C2W_CHUNKS; i++) {
		const n = String(i).padStart(2, '0')
		const gz = path.join(cache, `c2w-${path.basename(image)}${n}.wasm.gz`)
		if (!existsSync(gz)) writeFileSync(gz, Bun.gzipSync(readFileSync(await fetchFile(`${image}${n}.wasm`)), { level: 9 }))
		cpSync(gz, `${freeOut}${n}.wasm.gz`)
	}
}

/** Replaces `from` with `to` exactly once, so a new EmulatorJS release that moved the code fails the build loudly. */
function patch(src: string, from: string, to: string, what: string): string {
	const at = src.indexOf(from)
	if (at < 0 || src.indexOf(from, at + 1) >= 0) throw new Error(`EmulatorJS patch "${what}" no longer applies: check it against ${EJS_VERSION}`)
	return src.slice(0, at) + to + src.slice(at + from.length)
}

/** EmulatorJS's runtime files with Shasta's patches, laid out as its data folder (ejs/). */
function buildRuntime(pkg: string, out: string) {
	const data = path.join(pkg, 'data')
	let main = readFileSync(path.join(data, 'src/emulator.js'), 'utf8')
	main = patch(main, 'fetch("https://cdn.emulatorjs.org/stable/data/version.json")', 'Promise.resolve({ ok: false }) /* Shasta: no update check against cdn.emulatorjs.org */', 'update check')
	main = patch(main, '`https://cdn.emulatorjs.org/${version}/data/${corePath}`', 'corePath /* Shasta: never fall back to cdn.emulatorjs.org */', 'core CDN fallback')
	main = patch(main, 'this.config.netplayUrl || "https://netplay.emulatorjs.org"', 'this.config.netplayUrl || ""', 'netplay server')
	// the loader's own order; one file instead of eight requests (and no 404 for the missing minified build)
	const order = ['nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js']
	const bundle = [main, ...order.map((f) => readFileSync(path.join(data, 'src', f), 'utf8'))].join('\n;\n')
	for (const m of bundle.matchAll(/(?:fetch|downloadFile)\(\s*["'`](https?:\/\/[^"'`]+)/g)) throw new Error(`EmulatorJS still fetches ${m[1]}`)
	mkdirSync(out, { recursive: true })
	writeFileSync(path.join(out, 'emulator.min.js'), bundle)
	cpSync(path.join(data, 'emulator.css'), path.join(out, 'emulator.min.css'))
	cpSync(path.join(data, 'loader.js'), path.join(out, 'loader.js'))
	cpSync(path.join(data, 'version.json'), path.join(out, 'version.json'))
	cpSync(path.join(data, 'localization'), path.join(out, 'localization'), { recursive: true, filter: (f) => !f.endsWith('.md') })
	cpSync(path.join(data, 'compression'), path.join(out, 'compression'), { recursive: true, filter: (f) => !f.endsWith('.md') })
	cpSync(path.join(pkg, 'LICENSE'), path.join(out, 'LICENSE'))
}

async function drawIcon(app: EmulatorApp): Promise<Buffer> {
	// sharp comes with Shasta's dependencies; only needed when the icons are redrawn
	const sharp = createRequire(path.join(root, 'shasta/package.json'))('sharp')
	const [a, b] = app.colors
	const fontSize = app.badge.length <= 2 ? 96 : app.badge.length === 3 ? 82 : app.badge.length === 4 ? 64 : 52
	// an original mark: a controller outline over the system's short name, never a console maker's logo
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="256" height="256" rx="56" fill="url(#g)"/>
<g fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
<path d="M92 48h72c22 0 36 14 40 34l6 30c3 14-12 22-22 12l-14-14h-86l-14 14c-10 10-25 2-22-12l6-30c4-20 18-34 40-34z"/>
<path d="M88 72v20M78 82h20"/></g>
<circle cx="160" cy="76" r="5" fill="#fff"/><circle cx="174" cy="90" r="5" fill="#fff"/>
<text x="128" y="${196 + fontSize * 0.08}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="800" font-size="${fontSize}" fill="#fff" letter-spacing="-1">${app.badge}</text>
</svg>`
	return sharp(Buffer.from(svg)).png().toBuffer()
}

async function buildApp(app: EmulatorApp, corePkgs: Map<string, string>) {
	const out = path.join(root, 'apps', `emu-${app.id}`)
	const engine = app.engine ?? 'emulatorjs'
	rmSync(out, { recursive: true, force: true })
	mkdirSync(out, { recursive: true })
	const coreIds = [...new Set(app.systems.flatMap((s) => s.cores ?? []))]
	if (engine === 'emulatorjs') {
		mkdirSync(path.join(out, 'ejs/cores/reports'), { recursive: true })
		cpSync(path.join(cache, `runtime-${EJS_VERSION}`), path.join(out, 'ejs'), { recursive: true })
		for (const id of coreIds) {
			if (CORES[id].custom) {
				await flycastCore(path.join(out, 'ejs/cores'))
				continue
			}
			const pkg = corePkgs.get(id)!
			for (const f of readdirSync(pkg)) if (f.endsWith('.data')) cpSync(path.join(pkg, f), path.join(out, 'ejs/cores', f))
			cpSync(path.join(pkg, 'reports', `${id}.json`), path.join(out, 'ejs/cores/reports', `${id}.json`))
		}
	} else if (engine === 'ruffle') await ruffleRuntime(path.join(out, 'ruffle'))
	else if (engine === 'v86') await v86Runtime(path.join(out, 'v86'))
	else if (engine === 'boxedwine') await boxedwineRuntime(path.join(out, 'boxedwine'))
	else if (engine === 'c2w') await c2wRuntime(path.join(out, 'c2w'), app.free![0].source, path.join(out, app.free![0].file))
	for (const f of engine === 'c2w' ? [] : (app.free ?? [])) {
		mkdirSync(path.dirname(path.join(out, f.file)), { recursive: true })
		cpSync(await fetchFile(f.source), path.join(out, f.file))
	}

	const html = readFileSync(path.join(here, 'shell/index.html'), 'utf8')
		.replaceAll('{{NAME}}', app.name)
		.replaceAll('{{ACCENT}}', app.colors[0])
		.replaceAll('{{ACCENT2}}', app.colors[1])
	writeFileSync(path.join(out, 'index.html'), html)
	for (const f of ['retro.js', 'retro.css']) cpSync(path.join(here, 'shell', f), path.join(out, f))
	const iconFile = path.join(here, 'icons', `${app.id}.png`)
	if (redrawIcons || !existsSync(iconFile)) {
		mkdirSync(path.dirname(iconFile), { recursive: true })
		writeFileSync(iconFile, await drawIcon(app))
	}
	cpSync(iconFile, path.join(out, 'icon.png'))

	const cores: Core[] = app.credits ?? coreIds.map((id) => CORES[id])
	const version = { emulatorjs: EJS_VERSION, ruffle: RUFFLE_VERSION, v86: V86_VERSION, boxedwine: '26R1', c2w: '' }[engine]
	const free = (app.free ?? []).map(({ source, ...f }) => (engine === 'c2w' ? { ...f, chunks: C2W_CHUNKS } : f))
	writeFileSync(
		path.join(out, 'config.json'),
		JSON.stringify({ id: app.id, name: app.name, summary: app.summary, colors: app.colors, engine, version, systems: app.systems, cores, free, demanding: app.demanding ?? '' }, null, 1),
	)
	const bios = app.systems.filter((s) => s.bios?.need === 'required').map((s) => s.label)
	const description = [
		app.demanding ?? '',
		app.about,
		engine === 'c2w'
			? ''
			: engine === 'emulatorjs'
			? 'Open a game file from your device, or drop it on the app. Games you open are listed in the app for next time, and in-game saves and save states are kept in this browser.'
			: 'Open a file from your device, or drop it on the app. Files you open are listed in the app for next time and stay in this browser.',
		bios.length ? `${bios.join(', ')} ${bios.length === 1 ? 'needs' : 'need'} the console's own BIOS file, which you add once in the app.` : '',
		engine === 'c2w' ? '' : engine === 'emulatorjs' ? 'Shasta does not include games or BIOS files: play games you own or free homebrew.' : 'Shasta does not include games: use files you own or freely licensed ones.',
		engine === 'emulatorjs' ? `Emulation by ${cores.map((c) => c.name).join(', ')}, running in EmulatorJS.` : `Made with ${cores.map((c) => c.name).join(', ')}.`,
	].filter(Boolean).join('\n\n')
	const credits = [...cores.map((c) => ({ role: 'developer', name: c.name, url: c.url })), ...(engine === 'emulatorjs' ? [{ role: 'port', name: 'EmulatorJS', url: 'https://emulatorjs.org' }] : [])]
	writeFileSync(
		path.join(out, 'shasta.json'),
		JSON.stringify({ name: app.name, summary: app.summary, description, category: 'games', tags: [...app.tags, 'emulator', 'retro'], version: APP_VERSION, notes: '', icon: 'icon.png', credits }, null, 1) + '\n',
	)
	return out
}

const apps = only ? APPS.filter((a) => only.includes(a.id)) : APPS
if (!apps.length) throw new Error(`no emulator app matches ${only}`)
console.log(`EmulatorJS ${EJS_VERSION}: ${apps.length} apps`)
const ejsPkg = await fetchPackage('@emulatorjs/emulatorjs')
const corePkgs = new Map<string, string>()
for (const id of new Set(apps.flatMap((a) => a.systems.flatMap((s) => s.cores ?? [])))) {
	if (!CORES[id]) throw new Error(`catalog: unknown core ${id}`)
	if (CORES[id].custom) continue
	corePkgs.set(id, await fetchPackage(`@emulatorjs/core-${id}`))
}
const runtime = path.join(cache, `runtime-${EJS_VERSION}`)
rmSync(runtime, { recursive: true, force: true })
buildRuntime(ejsPkg, runtime)
const saveLock = () => writeFileSync(lockFile, JSON.stringify(Object.fromEntries(Object.entries(lock).sort()), null, '\t') + '\n')
for (const app of apps) {
	let out: string
	try {
		out = await buildApp(app, corePkgs)
	} finally {
		saveLock()
	}
	const bytes = Number(Bun.spawnSync(['du', '-sk', out]).stdout.toString().split('\t')[0]) * 1024
	console.log(`  apps/emu-${app.id}: ${app.name} (${(bytes / 1048576).toFixed(0)} MB)`)
}
