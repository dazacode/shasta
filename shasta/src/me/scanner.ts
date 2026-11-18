// The in-app QR scanner, loaded only when the scanner screen opens. BarcodeDetector where the browser has it (Chrome
// on Android); elsewhere (iPhone) the `barcode-detector` ponyfill with zxing's WebAssembly, which is served by Shasta
// itself (`?url`: a same-origin, content-hashed file in /assets/), never from a CDN: the app is cross-origin isolated,
// and a school filter may block the CDN anyway.
import zxingWasm from 'zxing-wasm/reader/zxing_reader.wasm?url'

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

let detector: Promise<Detector> | null = null

async function makeDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?(): Promise<string[]> } }).BarcodeDetector
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats?.()) ?? ['qr_code']
      if (formats.includes('qr_code')) return new Native({ formats: ['qr_code'] })
    } catch {
      /* fall through to the ponyfill */
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasm : prefix + path) } })
  return new BarcodeDetector({ formats: ['qr_code'] }) as unknown as Detector
}

export const getDetector = () => (detector ??= makeDetector().catch((e) => {
  detector = null
  throw e
}))

/** Reads the camera until a QR code is found (or the signal aborts). Returns the code's text. */
export async function scanVideo(video: HTMLVideoElement, signal: AbortSignal): Promise<string> {
  const d = await getDetector()
  while (!signal.aborted) {
    if (video.readyState >= 2) {
      try {
        const found = await d.detect(video)
        if (found[0]?.rawValue) return found[0].rawValue
      } catch {
        /* a frame it could not read */
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new DOMException('aborted', 'AbortError')
}
