// Entry point of the small browser bundle that ships inside the Shasta AI store app (apps/shasta-ai/openui.js): OpenUI's own
// parser plus the schema of Shasta's component library. The app draws the parsed tree with plain DOM code. Built by
// `bun run build:ai-app` (scripts/build-ai-app.ts); the schema is generated from library.tsx so the two cannot drift.
import { createParser } from '@openuidev/lang-core'
import schema from './schema.generated.json'

const parser = createParser(schema as never, 'Stack')

;(globalThis as { ShastaOpenUI?: unknown }).ShastaOpenUI = {
  /** OpenUI Lang text -> { root, errors } where root is the element tree (or null while it is not drawable yet) */
  parse(text: string) {
    try {
      const r = parser.parse(text)
      return { root: r.root ?? null, errors: r.meta.errors.map((e: { code: string }) => e.code), incomplete: r.meta.incomplete }
    } catch {
      return { root: null, errors: ['parse-failed'], incomplete: true }
    }
  },
}
