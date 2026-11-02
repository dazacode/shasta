import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __ENGINE_VERSION__: JSON.stringify(engineVersion) },
  plugins: [
    {
      name: 'engine-version',
      transformIndexHtml: (html) => html.replaceAll('%ENGINE_VERSION%', engineVersion),
    },
    // canonical/og/JSON-LD origin + robots.txt/sitemap.xml, so school-filter classifiers can find a
    // topic. VITE_SITE_ORIGIN sets the domain; see docs/unblocking.md.
    seoPlugin(),
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: '../scramjet/packages/core/dist/*.{js,mjs,wasm}', dest: 'scramjet', rename: { stripBase: true } },
        { src: '../scramjet/packages/controller/dist/*.js', dest: 'controller', rename: { stripBase: true } },
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
    offlineManifestPlugin({ app: pkg.version, engine: engineVersion }),
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
    proxy: { '/wisp': { target: 'ws://localhost:8080', ws: true }, '/api': { target: 'http://localhost:8080', ws: true }, '/ai-models': { target: 'http://localhost:8080' }, '/cloud': { target: 'http://localhost:8080', ws: true } },
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
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      // Scramjet is built by its own pnpm workspace (it relies on workspace:/catalog: protocols
      // that bun can't resolve), so we consume its built files directly. Their own imports
      // resolve from the scramjet folder's node_modules.
      { find: /^@mercuryworkshop\/scramjet$/, replacement: scramjet('core/dist/scramjet-external.mjs') },
      { find: /^@mercuryworkshop\/scramjet-controller$/, replacement: scramjet('controller/dist/controller-external.mjs') },
    ],
  },
})
