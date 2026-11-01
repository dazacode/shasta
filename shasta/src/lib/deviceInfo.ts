// Settings -> Advanced -> Developer tools -> Device: what this computer and browser can do, read on demand. The things
// that decide whether a game runs (Chrome version, Memory64, threads, WebGPU limits, memory, storage quota) in one
// place, for people who cannot open DevTools. Read locally, never sent anywhere.
import { chromeVersion } from './browserSupport'
import { getSettings } from '@/stores/settingsStore'
import { activeWispUrl, connectionInfo, engineVersion, serviceWorkerStatus } from '@/proxy/scramjetAdapter'
import { hasMemory64 } from '@/proxy/memory64Shim'

export interface InfoSection {
  title: string
  rows: [label: string, value: string][]
  /** plain-words consequences worth a line of their own */
  notes?: string[]
}

const yes = (v: boolean) => (v ? 'yes' : 'no')
const mb = (n?: number) => (n === undefined ? 'unknown' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`)

async function wasmRows(): Promise<[string, string][]> {
  const rows: [string, string][] = [['64-bit memory (Memory64)', hasMemory64() ? 'yes' : 'no (Shasta converts 64-bit games to 32-bit)']]
  try {
    const f = await import('wasm-feature-detect')
    const probes: [string, () => Promise<boolean>][] = [
      ['Threads (SharedArrayBuffer)', f.threads],
      ['SIMD', f.simd],
      ['Relaxed SIMD', f.relaxedSimd],
      ['Exceptions', f.exceptions],
      ['Exceptions (exnref, Chrome 137+)', f.exceptionsFinal],
      ['Garbage collection (Chrome 119+)', f.gc],
      ['Tail calls', f.tailCall],
      ['Stack switching (JSPI, Chrome 137+)', f.jspi],
      ['Multiple memories (Chrome 120+)', f.multiMemory],
    ]
    for (const [label, probe] of probes) rows.push([label, yes(await probe().catch(() => false))])
  } catch {
    rows.push(['Other features', 'could not be tested'])
  }
  return rows
}

const GPU_LIMITS = ['maxSampledTexturesPerShaderStage', 'maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxBindGroups', 'maxColorAttachments', 'maxInterStageShaderVariables', 'maxComputeInvocationsPerWorkgroup'] as const

async function gpuSection(): Promise<InfoSection> {
  const rows: [string, string][] = []
  const notes: string[] = []
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) {
    rows.push(['WebGPU', 'not available in this browser'])
    notes.push('Games that need WebGPU will not start here.')
  } else {
    try {
      // `any`: Chrome 126 has requestAdapterInfo() and no `info`; newer Chrome the other way round
      const adapter: any = await gpu.requestAdapter()
      if (!adapter) {
        rows.push(['WebGPU', 'no graphics adapter (blocked or unsupported GPU)'])
        notes.push('WebGPU exists but this GPU is not allowed to use it: WebGPU games will not start.')
      } else {
        const info = adapter.info ?? (typeof adapter.requestAdapterInfo === 'function' ? await adapter.requestAdapterInfo().catch(() => null) : null)
        rows.push(['WebGPU', 'available'])
        if (info) rows.push(['GPU', [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' · ') || 'unnamed'])
        for (const k of GPU_LIMITS) if (adapter.limits?.[k] !== undefined) rows.push([k, k.includes('Size') ? mb(Number(adapter.limits[k])) : String(adapter.limits[k])])
        rows.push(['Features', [...(adapter.features ?? [])].sort().join(', ') || 'none'])
        const tex = Number(adapter.limits?.maxSampledTexturesPerShaderStage ?? 0)
        if (tex && tex <= 16) notes.push(`WebGPU allows ${tex} textures per shader stage here. Big 3D games built for more (newer Chrome allows up to 48) draw a black screen.`)
        if (!adapter.features?.has?.('clip-distances')) notes.push('No clip distances: Shasta rewrites shaders that use them.')
      }
    } catch (e) {
      rows.push(['WebGPU', `error: ${(e as Error).message}`])
    }
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl) rows.push(['WebGL 2', 'not available'])
    else {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      rows.push(['WebGL 2', 'available'])
      rows.push(['WebGL renderer', String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))])
      rows.push(['WebGL max texture size', String(gl.getParameter(gl.MAX_TEXTURE_SIZE))])
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    rows.push(['WebGL 2', 'could not be tested'])
  }
  return { title: 'Graphics', rows, notes }
}

export async function gatherDeviceInfo(): Promise<InfoSection[]> {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string; mobile?: boolean }; connection?: { effectiveType?: string; downlink?: number; saveData?: boolean } }
  // the brand list first (HeadlessChrome/126 in the user agent is still Chrome 126)
  const brand = (navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[] } }).userAgentData?.brands?.find((b) => /Chrom/.test(b.brand))
  const chrome = (brand ? Number(brand.version) : null) || chromeVersion() || Number(/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1]) || null
  const settings = getSettings()
  const conn = connectionInfo()

  const browser: InfoSection = {
    title: 'Browser',
    rows: [
      ['Chrome version', chrome ? String(chrome) : 'not Chrome'],
      ['User agent', navigator.userAgent],
      ['Platform', nav.userAgentData?.platform || navigator.platform || 'unknown'],
      ['Language', navigator.languages?.join(', ') || navigator.language],
      ['Cross-origin isolated (threads)', yes(self.crossOriginIsolated === true)],
      ['SharedArrayBuffer', yes(typeof SharedArrayBuffer === 'function')],
      ['Online', yes(navigator.onLine)],
      ['Network', nav.connection ? `${nav.connection.effectiveType ?? '?'}${nav.connection.downlink ? `, ~${nav.connection.downlink} Mbit/s` : ''}${nav.connection.saveData ? ', data saver on' : ''}` : 'unknown'],
    ],
    notes: [
      ...(chrome && chrome < 133 ? [`Chrome ${chrome} is older than 133: games built for 64-bit WebAssembly memory need Shasta's conversion, and some newer graphics features are missing.`] : []),
      ...(self.crossOriginIsolated ? [] : ['Not cross-origin isolated: games that use threads will not start.']),
    ],
  }
  const device: InfoSection = {
    title: 'Device',
    rows: [
      ['Memory (reported)', nav.deviceMemory ? `${nav.deviceMemory} GB${nav.deviceMemory <= 4 ? ' (browsers report 4 for 4 GB and less)' : ''}` : 'unknown'],
      ['CPU threads', String(navigator.hardwareConcurrency || 'unknown')],
      ['Screen', `${screen.width}×${screen.height} at ${devicePixelRatio}x`],
      ['Touch', navigator.maxTouchPoints ? `${navigator.maxTouchPoints} points` : 'no'],
    ],
  }
  const storage: InfoSection = { title: 'Storage', rows: [] }
  try {
    const est = await navigator.storage.estimate()
    storage.rows.push(['Used', mb(est.usage)], ['Quota', mb(est.quota)], ['Persistent', yes(await navigator.storage.persisted().catch(() => false))])
    if (est.quota && est.quota < 2 * 1024 ** 3) storage.notes = ['Less than 2 GB of storage quota: big games that cache their files may fail to save them. Free up disk space.']
  } catch {
    storage.rows.push(['Quota', 'unknown'])
  }
  const shasta: InfoSection = {
    title: 'Shasta',
    rows: [
      ['Version', __APP_VERSION__],
      ['Engine', engineVersion()],
      ['Page engine', settings.pageEngine],
      ['Transport', settings.transport],
      ['Connection', `${conn.state}${conn.latency ? `, ${conn.latency} ms` : ''}${conn.detail ? ` (${conn.detail})` : ''}`],
      ['Relay', activeWispUrl() || 'none yet'],
      ['Service worker', serviceWorkerStatus()],
    ],
  }
  const [wasm, gpu] = await Promise.all([wasmRows(), gpuSection()])
  return [browser, device, { title: 'WebAssembly', rows: wasm }, gpu, storage, shasta]
}

export function deviceText(sections: InfoSection[]): string {
  return sections.map((s) => [`## ${s.title}`, ...s.rows.map(([k, v]) => `${k}: ${v}`), ...(s.notes ?? []).map((n) => `! ${n}`)].join('\n')).join('\n\n')
}
