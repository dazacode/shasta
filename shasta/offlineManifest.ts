// Build step for the offline application shell (see public/sw.js): lists every file Shasta needs to start without
// a network, with its size and sha256, and stamps the build's version into dist/sw.js. A new version changes the
// bytes of sw.js, which is what makes the browser install the update.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

export type OfflineGroup = 'core' | 'ai'

export interface OfflineFile {
  /** the exact URL the app requests (engine files carry ?v=) */
  url: string
  size: number
  sha256: string
  group: OfflineGroup
}

export interface OfflineManifest {
  version: string
  app: string
  engine: string
  files: OfflineFile[]
}

export const VERSION_PLACEHOLDER = '__SHASTA_SHELL_VERSION__'

/**
 * Which group a built file belongs to, or null when it is never needed offline. `core` is the whole browser
 * interface; `ai` is the ONNX Runtime wasm (27 MB), only kept when the person asks for it.
 */
export function classify(rel: string): OfflineGroup | null {
  if (rel === 'sw.js' || rel === 'offline-manifest.json' || rel.endsWith('.map') || rel.startsWith('licenses/')) return null
  if (rel.startsWith('ort/')) return 'ai'
  // the ad blocker's filter engine (5 MB) is fetched when browsing starts; browsing needs the network anyway
  if (rel.startsWith('adblock/')) return null
  // holiday photos (~1.2 MB, one shown at a time, a few weeks a year): the browser's own cache is enough; offline the
  // new tab shows its plain dark background behind them
  if (rel.startsWith('seasonal/')) return null
  // Vite's hashed copy of the ORT wasm is never loaded: the inference worker points ORT at /ort/
  if (/^assets\/ort-wasm[^/]*\.wasm$/.test(rel)) return null
  // only scramjet.js is loaded (index.html, the controller and worker threads); the other builds are unused
  if (/^scramjet\/(scramjet_bundled\.m?js|scramjet-external\.mjs|scramjet\.mjs)$/.test(rel)) return null
  // every browser Shasta supports picks the .woff2 listed first in each @font-face
  if (rel.endsWith('.woff')) return null
  // dash.js (1.7 MB) is only used by the rare DASH source in Watch, and playback needs the network anyway
  if (/^assets\/dash\.all\.min-/.test(rel)) return null
  return 'core'
}

/** Files whose URL carries the engine version (they have fixed names; see engineFiles() in scramjetAdapter.ts). */
const VERSIONED = new Set(['scramjet/scramjet.js', 'scramjet/scramjet.wasm', 'controller/controller.api.js', 'controller/controller.inject.js'])

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')]
  })
}

export function buildManifest(dist: string, app: string, engine: string): OfflineManifest {
  const files: OfflineFile[] = []
  for (const rel of walk(dist).sort()) {
    const group = classify(rel)
    if (!group) continue
    const data = readFileSync(path.join(dist, rel))
    const url = rel === 'index.html' ? '/index.html' : `/${rel}${VERSIONED.has(rel) ? `?v=${engine}` : ''}`
    files.push({ url, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), group })
  }
  const version = createHash('sha256')
    .update(files.map((f) => `${f.url} ${f.sha256}`).join('\n'))
    .digest('hex')
    .slice(0, 12)
  return { version, app, engine, files }
}

export function offlineManifestPlugin({ app, engine }: { app: string; engine: string }): Plugin {
  let outDir = ''
  return {
    name: 'shasta-offline-manifest',
    apply: 'build',
    configResolved: (c) => void (outDir = path.resolve(c.root, c.build.outDir)),
    // after every writeBundle hook (vite-plugin-static-copy copies the engine and ORT there)
    closeBundle: {
      order: 'post',
      handler() {
        const manifest = buildManifest(outDir, app, engine)
        writeFileSync(path.join(outDir, 'offline-manifest.json'), JSON.stringify(manifest))
        const sw = path.join(outDir, 'sw.js')
        const source = readFileSync(sw, 'utf8')
        if (!source.includes(VERSION_PLACEHOLDER)) throw new Error('sw.js has no version placeholder')
        writeFileSync(sw, source.replace(VERSION_PLACEHOLDER, manifest.version))
        const mb = (n: number) => (n / 1048576).toFixed(1)
        const sum = (g: OfflineGroup) => manifest.files.filter((f) => f.group === g).reduce((n, f) => n + f.size, 0)
        console.log(`offline shell ${manifest.version}: core ${mb(sum('core'))} MB, ai runtime ${mb(sum('ai'))} MB, ${manifest.files.length} files`)
      },
    },
  }
}
