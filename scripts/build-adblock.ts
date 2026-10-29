// Builds shasta/public/adblock/engine.bin: the ad blocker (@ghostery/adblocker) with EasyList, EasyPrivacy, Peter Lowe's
// list and the uBlock Origin filters, parsed once here and loaded by the browser as one file. The lists are downloaded
// at build time (from GitHub) so a school filter that blocks GitHub cannot stop the blocker from working.
// `bun scripts/build-adblock.ts` (run.ts calls it when the file is missing or older than ADBLOCK_MAX_AGE_DAYS).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const out = path.join(root, 'shasta/public/adblock')
const { FiltersEngine, adsAndTrackingLists, fetchLists, fetchResources } = await import(path.join(root, 'shasta/node_modules/@ghostery/adblocker/dist/esm/index.js'))

// the public lists, plus Shasta's own few rules for ad networks they do not catch yet (scripts/adblock-extra.txt)
const [lists, resources] = await Promise.all([fetchLists(fetch, adsAndTrackingLists), fetchResources(fetch)])
const extra = readFileSync(path.join(import.meta.dir, 'adblock-extra.txt'), 'utf8')
const engine = FiltersEngine.parse([...lists, extra].join('\n'), {
  enableCompression: true,
  // Shasta applies network blocking, element hiding, procedural selectors and scriptlets (proxy/adCosmetics.ts); HTML
  // filtering and CSP filters would need hooks inside the proxy's rewriter that do not exist
  enableHtmlFiltering: false,
  loadCSPFilters: false,
  loadExtendedSelectors: true,
})
// the stand-ins `$redirect` rules point at (empty scripts, 1x1 images)
engine.updateResources(resources, String(resources.length))
const bytes: Uint8Array = engine.serialize()
mkdirSync(out, { recursive: true })
writeFileSync(path.join(out, 'engine.bin'), bytes)
writeFileSync(path.join(out, 'engine.json'), JSON.stringify({ builtAt: new Date().toISOString(), lists: [...adsAndTrackingLists.map((u: string) => u.split('/assets/')[1]), 'scripts/adblock-extra.txt'] }, null, 2) + '\n')
console.log(`shasta/public/adblock/engine.bin: ${(bytes.byteLength / 1048576).toFixed(1)} MB from ${adsAndTrackingLists.length} lists + adblock-extra.txt`)
