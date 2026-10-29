// Builds apps/shasta-ai/openui.js: OpenUI's parser + Shasta's component schema, for the Shasta AI store app.
// Run `bun run build:ai-app` after changing shasta/src/ai/genui/library.tsx, then bump the app's version in shasta.json.
process.env.DO_NOT_TRACK = '1' // OpenUI's runtime can report anonymous usage from Node-like runtimes; never while we build
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const genui = path.join(root, 'shasta/src/ai/genui')
const { genuiLibrary } = await import(path.join(genui, 'library.tsx'))
writeFileSync(path.join(genui, 'schema.generated.json'), JSON.stringify(genuiLibrary.toJSONSchema()) + '\n')

const out = await Bun.build({ entrypoints: [path.join(genui, 'app-entry.ts')], target: 'browser', format: 'iife', minify: true, outdir: path.join(root, 'apps/shasta-ai'), naming: 'openui.js' })
if (!out.success) {
  for (const l of out.logs) console.error(l)
  process.exit(1)
}
// OpenUI's library contains an anonymous usage reporter (it never runs inside a browser window, but a privacy-first app should
// not even carry the address). Point it nowhere and verify nothing is left.
const file = path.join(root, 'apps/shasta-ai/openui.js')
const text = await Bun.file(file).text()
const cleaned = text.replaceAll(/https:\/\/[a-z0-9]+\.cloudfront\.net/g, 'about:blank')
if (/cloudfront|posthog\.com/i.test(cleaned)) throw new Error('openui.js still contains a telemetry address')
writeFileSync(file, cleaned)
const size = Bun.file(file).size
console.log(`apps/shasta-ai/openui.js: ${(size / 1024).toFixed(1)} KB`)
