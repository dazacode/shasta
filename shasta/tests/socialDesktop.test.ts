// "Play on Chromebook" on the desktop (src/lib/socialDesktop.ts receiveLaunch): opens through the Store's own launch,
// says where it came from, ignores junk and double taps.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const launch = vi.fn<(id: string) => Promise<void>>()
const toast = vi.fn()
const tabs = { tabs: [] as { id: string; app: { id: string } | null }[], activeId: '' }

vi.mock('@/store/storeStore', () => ({ useStore: { getState: () => ({ launch }) } }))
vi.mock('@/stores/tabsStore', () => ({ useTabs: { getState: () => tabs } }))
vi.mock('@/stores/uiStore', () => ({ useUi: { getState: () => ({ toast }) } }))
vi.mock('@/social/store', () => ({ useSocial: { getState: () => ({}), subscribe: () => () => {} }, onLaunch: () => () => {} }))
vi.mock('@/social/origin', () => ({ SOCIAL_AVAILABLE: true }))
vi.mock('@/social/presenceReporter', () => ({ startPresenceReporter: async () => () => {} }))

const { receiveLaunch } = await import('@/lib/socialDesktop')
const app = (appId: string, name = 'Hextris') => ({ appId, name, slug: 'hextris', scheme: 'game' as const, iconUrl: null })

describe('receiveLaunch', () => {
  beforeEach(() => {
    launch.mockReset()
    toast.mockReset()
    // the Store's launch opens a tab in front with that app
    launch.mockImplementation(async (id) => {
      tabs.tabs = [{ id: 't1', app: { id } }]
      tabs.activeId = 't1'
    })
  })

  it('opens the game through the Store and tells you it came from the phone', async () => {
    await receiveLaunch(app('app_hex1'), 1_000_000)
    expect(launch).toHaveBeenCalledWith('app_hex1')
    expect(toast).toHaveBeenCalledWith('Opened from your phone: Hextris', { tone: 'success' })
  })

  it('stays quiet when the launch did not open it (the Store shows its own error)', async () => {
    launch.mockImplementation(async () => {
      tabs.tabs = []
      tabs.activeId = ''
    })
    await receiveLaunch(app('app_gone'), 2_000_000)
    expect(launch).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })

  it('ignores anything that is not an app id, and a double tap', async () => {
    await receiveLaunch(app('https://evil.example/'), 3_000_000)
    await receiveLaunch({ appId: 5 } as never, 3_000_000)
    expect(launch).not.toHaveBeenCalled()
    await receiveLaunch(app('app_x'), 4_000_000)
    await receiveLaunch(app('app_x'), 4_001_000)
    expect(launch).toHaveBeenCalledOnce()
    await receiveLaunch(app('app_x'), 4_010_000)
    expect(launch).toHaveBeenCalledTimes(2)
  })
})
