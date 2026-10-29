import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8080' })
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })
vi.stubGlobal('document', { addEventListener: () => undefined })

describe('settings migration', () => {
  it('fills in new fields and keeps existing values', async () => {
    const { migrateSettings, defaultSettings } = await import('@/stores/settingsStore')
    const migrated = migrateSettings({ settings: { searchEngine: 'brave', wispUrl: 'wss://example.test/wisp/' } }, 1).settings!
    expect(migrated.searchEngine).toBe('brave')
    expect(migrated.wispUrl).toBe('wss://example.test/wisp/')
    expect(migrated.theme).toBe(defaultSettings().theme)
    expect(migrated.shortcuts.length).toBeGreaterThan(0)
  })

  it('v5 -> v6 keeps wispUrl as the preferred endpoint and adds clean fallbacks', async () => {
    const { migrateSettings, wispOptions } = await import('@/stores/settingsStore')
    const migrated = migrateSettings({ settings: { wispUrl: 'wss://mine.test/wisp/' } }, 5).settings!
    expect(migrated.wispUrl).toBe('wss://mine.test/wisp/')
    expect(migrated.wispUrls).toEqual([])
    expect(migrateSettings({ settings: { wispUrls: ['wss://b.test/wisp/', 7, ''] } }, 5).settings!.wispUrls).toEqual(['wss://b.test/wisp/'])
    expect(migrateSettings({ settings: { wispUrls: 'nope' } }, 5).settings!.wispUrls).toEqual([])
    // the build's defaults (this host) always follow the person's own endpoints
    expect(wispOptions({ ...migrated, wispUrls: ['wss://b.test/wisp/'] }).wispUrls).toEqual(['wss://b.test/wisp/', 'ws://localhost:8080/wisp/'])
  })

  it('survives garbage', async () => {
    const { migrateSettings } = await import('@/stores/settingsStore')
    expect(migrateSettings(null, 0).settings!.accent).toBe('sky')
    expect(migrateSettings('nope', 0).settings!.density).toBe('comfortable')
  })
})

describe('settings merge', () => {
  it('fills fields missing from older saved settings (e.g. pageAccess) instead of crashing', async () => {
    const { mergeSettings, defaultSettings } = await import('@/stores/settingsStore')
    const current = { settings: defaultSettings(), update: () => undefined, reset: () => undefined }
    const old = { settings: { theme: 'dark', accent: 'rose' } } // saved before pageAccess existed
    const merged = mergeSettings(old, current).settings
    expect(merged.theme).toBe('dark')
    expect(merged.pageAccess.camera).toBe(false)
    expect(merged.resourceGuard).toBe(true)
    expect(mergeSettings({ settings: { pageAccess: { camera: true } } }, current).settings.pageAccess).toMatchObject({ camera: true, microphone: false })
    expect(mergeSettings(null, current).settings.theme).toBe('system')
  })
})
