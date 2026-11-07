// Stand-in for shasuta/album.ts in a build without Shasuta (see state.ts here).
export type CaptureResult = { ok: true } | { ok: false; reason: string }
export async function captureActiveTab(): Promise<CaptureResult> {
  return { ok: false, reason: 'Not available in this version.' }
}
