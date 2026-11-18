// The SessionBundle a desktop hands the phone while linking (docs/social-protocol.md "Linking", step 7): the Store
// library as a manifest of ids, the portable settings, and the Store game in front. Never history, cookies, site data,
// tabs or anything a site saved (the same allow-list as profile export, lib/profile.ts). It arrives from another device,
// so it is validated, never trusted, and only ever ADDED to what the phone has (mergeLocal).
// The settings store is imported lazily: it is big, and the phone app needs it only for this one step.
import { fromManifest, loadLocal, mergeLocal, replaceLocal, toManifest, type LibraryManifest } from '@/store/localLibrary'
import type { SessionBundle } from './types'

const MAX_BUNDLE_CHARS = 60_000
const APP_ID = /^[A-Za-z0-9_-]{1,80}$/

/** Checks the shape and size of an incoming bundle; null when it is not one. Exported for tests. */
export function validateBundle(raw: unknown): SessionBundle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (b.v !== 1) return null
  try {
    if (JSON.stringify(raw).length > MAX_BUNDLE_CHARS) return null
  } catch {
    return null
  }
  // the library is re-read through fromManifest (which drops anything malformed) and written back as a clean manifest
  const library = toManifest(fromManifest(b.library))
  const settings = b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings) ? (b.settings as Record<string, unknown>) : {}
  const p = b.playing as { appId?: unknown } | null | undefined
  const playing = p && typeof p === 'object' && typeof p.appId === 'string' && APP_ID.test(p.appId) ? { appId: p.appId } : null
  return { v: 1, library, settings, playing }
}

/** The desktop side: what this device would hand over. `playing` is the Store app in front (tab.app), if any. */
export async function buildBundle(playing: string | null = null): Promise<SessionBundle> {
  const [{ PORTABLE_SETTINGS }, { getSettings }] = await Promise.all([import('@/lib/profile'), import('@/stores/settingsStore')])
  const all = getSettings() as unknown as Record<string, unknown>
  const settings: Record<string, unknown> = {}
  for (const k of PORTABLE_SETTINGS) settings[k] = all[k]
  return { v: 1, library: toManifest(await loadLocal()), settings, playing: playing && APP_ID.test(playing) ? { appId: playing } : null }
}

export interface ImportResult {
  /** apps that were new to this phone */
  added: number
  /** settings that were applied */
  settings: number
}

/** The phone side: adds the bundle's library to this device's (IndexedDB `shasta`) and applies its settings. */
export async function importBundle(bundle: SessionBundle): Promise<ImportResult> {
  const local = await loadLocal()
  const incoming = fromManifest(bundle.library as LibraryManifest)
  const merged = mergeLocal(local, incoming)
  await replaceLocal(merged)
  const [{ sanitizeSettings }, { useSettings }] = await Promise.all([import('@/lib/profile'), import('@/stores/settingsStore')])
  const clean = sanitizeSettings(bundle.settings)
  const n = Object.keys(clean).length
  if (n) useSettings.getState().update(clean)
  return { added: merged.installs.length - local.installs.length, settings: n }
}
