import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import vitePluginBundleObfuscator from 'vite-plugin-bundle-obfuscator'
import pkg from './package.json' with { type: 'json' }
import { offlineManifestPlugin } from './offlineManifest.ts'
import { seoPlugin } from './seo.ts'

const LICENSES: Record<string, string> = {
  '../LICENSE': 'AGPL-3.0.txt',
  '../NOTICE.md': 'NOTICE.md',
  'node_modules/@fontsource-variable/geist/LICENSE': 'OFL-Geist.txt',
  'node_modules/@fontsource-variable/geist-mono/LICENSE': 'OFL-Geist-Mono.txt',
}

const scramjet = (p: string) => path.resolve(import.meta.dirname, '../scramjet/packages', p)

// Obfuscate the built app unless explicitly disabled. Dev keeps raw code unless VITE_OBFUSCATE=1.
const OBFUSCATE = process.env.VITE_OBFUSCATE === '1' || (process.env.NODE_ENV !== 'development' && process.env.VITE_OBFUSCATE !== '0')

// Short hash of the engine files. It goes into their URLs (?v=…) so a rebuilt or patched engine can never be
// shadowed by a copy in the browser's HTTP cache (page scripts, worker threads and the service worker all use it).
const engineFiles = ['core/dist/scramjet.js', 'core/dist/scramjet.wasm', 'controller/dist/controller.api.js', 'controller/dist/controller.inject.js', 'controller/dist/controller.sw.js']
const engineHash = createHash('sha1')
for (const f of engineFiles) if (existsSync(scramjet(f))) engineHash.update(readFileSync(scramjet(f)))
const engineVersion = engineHash.digest('hex').slice(0, 10)

// Where the engine files are served (relative to BASE). VITE_NEUTRAL_ENGINE=1 (every Lite build, scripts/lib/liteBuild.ts)
// serves them as /rt/*: a school filter (Cisco Umbrella, 2026-11-03) refused /scramjet/scramjet.js by its URL while
// the page itself loaded, leaving `$scramjet` undefined. Same bytes, other names.
const NEUTRAL_ENGINE = process.env.VITE_NEUTRAL_ENGINE === '1'
// --outDir from the command line (liteBuild passes one), else dist
const outDirOf = () => {
  const i = process.argv.indexOf('--outDir')
  return i > 0 ? path.resolve(process.cwd(), process.argv[i + 1]) : path.resolve(import.meta.dirname, 'dist')
}
const ENGINE_PATHS = NEUTRAL_ENGINE
  ? { core: 'rt/core.js', wasm: 'rt/core.wasm', api: 'rt/api.js', inject: 'rt/inject.js', sw: 'rt/sw.js' }
  : { core: 'scramjet/scramjet.js', wasm: 'scramjet/scramjet.wasm', api: 'controller/controller.api.js', inject: 'controller/controller.inject.js', sw: 'controller/controller.sw.js' }
const engineCopy = NEUTRAL_ENGINE
  ? [
      { src: '../scramjet/packages/core/dist/scramjet.js', dest: 'rt', rename: { stripBase: true as const, name: 'core.js' } },
      { src: '../scramjet/packages/core/dist/scramjet.wasm', dest: 'rt', rename: { stripBase: true as const, name: 'core.wasm' } },
      { src: '../scramjet/packages/controller/dist/controller.api.js', dest: 'rt', rename: { stripBase: true as const, name: 'api.js' } },
      { src: '../scramjet/packages/controller/dist/controller.inject.js', dest: 'rt', rename: { stripBase: true as const, name: 'inject.js' } },
      { src: '../scramjet/packages/controller/dist/controller.sw.js', dest: 'rt', rename: { stripBase: true as const, name: 'sw.js' } },
    ]
  : [
      { src: '../scramjet/packages/core/dist/*.{js,mjs,wasm}', dest: 'scramjet', rename: { stripBase: true as const } },
      { src: '../scramjet/packages/controller/dist/*.js', dest: 'controller', rename: { stripBase: true as const } },
    ]

// Shasuta (the gaming mode, src/shasuta/) is still in development, so a production build leaves it OUT: its imports
// resolve to the inert stand-ins in src/shasutaOff/ and none of its code, styles or strings reach the bundle. Dev
// (`bun run dev`) keeps it. `VITE_SHASUTA=1` builds it in on purpose (`VITE_SHASUTA=0` leaves it out in dev).
// Without src/shasutaOff/ (the public source snapshot ships the stand-ins at the real paths) there is nothing to alias.
const BUILDING = process.argv.includes('build')
const SHASUTA_OFF_DIR = path.resolve(import.meta.dirname, 'src/shasutaOff')
const SHASUTA = process.env.VITE_SHASUTA === '1' || (process.env.VITE_SHASUTA !== '0' && !BUILDING)
if (BUILDING) console.log(`[shasta] Shasuta (gaming mode): ${SHASUTA ? 'INCLUDED' : 'left out'}`)
const shasutaAlias = SHASUTA || !existsSync(SHASUTA_OFF_DIR)
  ? []
  : [
      { find: /^@\/shasuta\/(host|state|album|art)$/, replacement: `${SHASUTA_OFF_DIR}/$1` },
      { find: /^@\/components\/whatsNew\/ShasutaDemo$/, replacement: `${SHASUTA_OFF_DIR}/ShasutaDemo` },
    ]

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __ENGINE_VERSION__: JSON.stringify(engineVersion), __ENGINE_PATHS__: JSON.stringify(ENGINE_PATHS) },
  plugins: [
    {
      name: 'engine-version',
      transformIndexHtml: (html) =>
        html.replaceAll('%ENGINE_VERSION%', engineVersion).replaceAll('%ENGINE_CORE%', ENGINE_PATHS.core).replaceAll('%ENGINE_API%', ENGINE_PATHS.api),
    },
    {
      // the service worker is a public file (not transformed): point its importScripts at the neutral name
      name: 'engine-sw-path',
      apply: 'build',
      // closeBundle: the public folder is copied by then; runs before the offline manifest's (order: post)
      closeBundle() {
        if (!NEUTRAL_ENGINE) return
        const sw = path.resolve(import.meta.dirname, outDirOf(), 'sw.js')
        const src = readFileSync(sw, 'utf8')
        if (!src.includes('"./controller/controller.sw.js"')) throw new Error('sw.js: engine importScripts not found')
        writeFileSync(sw, src.replace('"./controller/controller.sw.js"', `"./${ENGINE_PATHS.sw}"`))
      },
    },
    // canonical/og/JSON-LD origin + robots.txt/sitemap.xml, so school-filter classifiers can find a
    // topic. VITE_SITE_ORIGIN sets the domain; see docs/unblocking.md.
    seoPlugin(),
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        ...engineCopy,
        // the on-device AI's WebAssembly runtime is served by Shasta itself (a school filter may block the CDN the library would use)
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.{mjs,wasm}', dest: 'ort', rename: { stripBase: true } },
      ],
    }),
    {
      // license texts that must travel with what we ship (AGPL for Shasta, SIL OFL for the bundled fonts)
      name: 'licenses',
      apply: 'build',
      writeBundle(options) {
        const out = path.join(options.dir!, 'licenses')
        mkdirSync(out, { recursive: true })
        for (const [from, to] of Object.entries(LICENSES)) copyFileSync(path.resolve(import.meta.dirname, from), path.join(out, to))
      },
    },
    // offline-manifest.json + the version stamped into sw.js (the offline application shell)
    offlineManifestPlugin({ app: pkg.version, engine: engineVersion, versioned: [ENGINE_PATHS.core, ENGINE_PATHS.wasm, ENGINE_PATHS.api, ENGINE_PATHS.inject] }),
    // Obfuscate Shasta's OWN chunks (the app code) on top of esbuild minification, so a downloaded
    // .swbn is not readable source at a glance. Vendor chunks (react, transformers, onnx) are left
    // alone: they are not ours to hide and obfuscating them mostly costs build time. AGPL is
    // unaffected — the corresponding source is still offered (VITE_SOURCE_URL). `VITE_OBFUSCATE=0`
    // turns it off, `VITE_OBFUSCATE=1` forces it on in dev too.
    OBFUSCATE &&
      vitePluginBundleObfuscator({
        apply: 'build',
        log: false,
        autoExcludeNodeModules: true,
        options: {
          compact: true,
          // a fixed seed: the same source must give the same bytes. File names are hashed BEFORE this step, so a
          // random seed shipped new contents under an old name, which browsers cache for a year (immutable) and the
          // offline shell then rejected as "not the file this version expects", leaving people on an old version.
          seed: 'shasta',
          identifierNamesGenerator: 'hexadecimal',
          // keep the names on the ESM import/export edges, or one chunk cannot see another's symbols
          ignoreImports: true,
          renameGlobals: false,
          stringArray: true,
          stringArrayThreshold: 0.75,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          stringArrayIndexShift: true,
          // selfDefending/debugProtection fight with the IWA CSP's Trusted Types default policy
          selfDefending: false,
          debugProtection: false,
        },
      }),
  ],
  // dev: forward the Wisp websocket to the backend started by `bun run dev`
  server: {
    proxy: { '/wisp': { target: 'ws://localhost:8080', ws: true }, '/api': { target: 'http://localhost:8080', ws: true }, '/ai-models': { target: 'http://localhost:8080' }, '/cloud': { target: 'http://localhost:8080', ws: true }, '/nowgg': { target: 'http://localhost:8080' } },
    // cross-origin isolation, like the production server (CROSS_ORIGIN_ISOLATION=0 turns it off)
    headers:
      process.env.CROSS_ORIGIN_ISOLATION === '0'
        ? {}
        : { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', 'Document-Isolation-Policy': 'isolate-and-credentialless' },
    // @dazacode/shasta-wisp lives in the wisp/ submodule, outside this root: allow reading it
    fs: { allow: [path.resolve(import.meta.dirname, '..')] },
  },
  build: {
    rolldownOptions: {
      // pad.html = the phone controller (src/pad/main.ts): its own tiny page, none of the browser
      input: { index: path.resolve(import.meta.dirname, 'index.html'), pad: path.resolve(import.meta.dirname, 'pad.html') },
      output: {
        // Lite (VITE_NEUTRAL_ENGINE): the engine's glue chunks are named after their modules
        // (scramjet-external, controller-external); give them names a URL filter does not match
        ...(NEUTRAL_ENGINE
          ? { chunkFileNames: (c: { name: string }) => `assets/${c.name.replace(/scramjet/gi, 'rt').replace(/controller/gi, 'ctl')}-[hash].js` }
          : {}),
        // Keep the big libraries that only load on demand (transports with inlined wasm, ad blocker, OpenUI, Wisp) out of the
        // shared vendor chunk, which index.html modulepreloads: otherwise first paint waits for ~5 MB it never runs.
        codeSplitting: {
          groups: [
            { name: 'transport-epoxy', test: /node_modules\/@mercuryworkshop\/epoxy-transport/, priority: 30 },
            { name: 'transport-libcurl', test: /node_modules\/@mercuryworkshop\/libcurl-transport/, priority: 30 },
            { name: 'adblocker', test: /node_modules\/@ghostery\//, priority: 30 },
            { name: 'openui', test: /node_modules\/@openuidev\//, priority: 30 },
            { name: 'wisp', test: /shasta-wisp|\/wisp\//, priority: 30 },
          ],
        },
      },
    },
  },
  // the inference worker imports transformers.js, which is a large ES module: build it as one, loaded only when AI is used
  worker: { format: 'es' },
  resolve: {
    alias: [
      ...shasutaAlias,
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      // Scramjet is built by its own pnpm workspace (it relies on workspace:/catalog: protocols
      // that bun can't resolve), so we consume its built files directly. Their own imports
      // resolve from the scramjet folder's node_modules.
      { find: /^@mercuryworkshop\/scramjet$/, replacement: scramjet('core/dist/scramjet-external.mjs') },
      { find: /^@mercuryworkshop\/scramjet-controller$/, replacement: scramjet('controller/dist/controller-external.mjs') },
    ],
  },
})
