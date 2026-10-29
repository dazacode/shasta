import { create } from 'zustand'
import * as offline from '@/lib/offline'
import { useSettings } from './settingsStore'
import { useUi } from './uiStore'
import { useLog } from './logStore'

type Phase = 'idle' | 'checking' | 'downloading' | 'error'

interface OfflineState {
  status: offline.ShellStatus | null
  phase: Phase
  progress: offline.DownloadProgress | null
  error: { code: string; message: string } | null
  storage: offline.StorageInfo | null
  updateReady: boolean
  /** the site's access gate wants a new sign-in (the offline copy still works) */
  signInExpired: boolean
  /** the last update check: what this device runs, what the server has, and how installing it went */
  update: (offline.UpdateCheck & { checking: boolean; checkedAt: number | null }) | null
  /** looks for a newer Shasta and installs it; `fromUser` reports every outcome, otherwise only problems */
  checkUpdate: (opts?: { fromUser?: boolean }) => Promise<offline.UpdateCheck | null>
  /** refreshes what is cached and how much space is used */
  refresh: () => Promise<void>
  /** downloads the shell (and the AI runtime when that setting is on); `fromUser` shows the outcome as a toast */
  download: (opts?: { fromUser?: boolean }) => Promise<void>
  clear: () => Promise<void>
  /** applies the two settings: on starts a download (that is the consent), AI runtime off removes it */
  setKeep: (patch: { offlineShell?: boolean; offlineAiRuntime?: boolean }) => Promise<void>
  persist: () => Promise<boolean | null>
  applyUpdate: () => Promise<void>
  boot: () => void
}

const groups = (): offline.OfflineGroup[] => (useSettings.getState().settings.offlineAiRuntime ? ['core', 'ai'] : ['core'])

let booted = false
let running: Promise<void> | null = null

export const useOffline = create<OfflineState>()((set, get) => ({
  status: null,
  phase: 'idle',
  progress: null,
  error: null,
  storage: null,
  updateReady: false,
  signInExpired: false,
  update: null,

  checkUpdate: async ({ fromUser = false } = {}) => {
    if (get().update?.checking) return null
    set((s) => ({ update: { ...(s.update ?? { state: 'current', version: null, latest: null, error: null, checkedAt: null }), checking: true } }))
    let r: offline.UpdateCheck
    try {
      r = await offline.checkUpdate()
    } catch {
      r = { state: 'offline', version: get().update?.version ?? null, latest: null, error: null }
    }
    const before = get().update
    set({ update: { ...r, checking: false, checkedAt: Date.now() } })
    const toast = useUi.getState().toast
    if (r.state === 'failed') {
      useLog.getState().add('warn', `Update to ${r.latest} failed: ${r.error?.message ?? 'unknown'}`)
      // a background check tells about a given version once; asking again always answers
      if (fromUser || before?.state !== 'failed' || before.latest !== r.latest) {
        toast(fromUser ? "Shasta still couldn't update. Reloading from the server gets the newest version right away." : "Shasta couldn't update to the newest version.", {
          tone: 'error',
          ms: 20_000,
          action: fromUser ? { label: 'Reload from server', run: offline.reloadFromServer } : { label: 'Try again', run: () => void get().checkUpdate({ fromUser: true }) },
        })
      }
    } else if (r.state === 'signin') {
      set({ signInExpired: true })
      if (fromUser) toast('Sign in to this Shasta site again to get updates.', { action: { label: 'Sign in', run: offline.reloadFromServer } })
    } else if (fromUser && r.state === 'current') toast("You're on the newest version of Shasta.", { tone: 'success' })
    else if (fromUser && r.state === 'offline') toast("You're offline, so Shasta can't check for updates right now.")
    // 'updated' is announced by watchUpdates (the new version took over; this window restarts into it)
    return r
  },

  refresh: async () => {
    if (get().phase === 'idle') set({ phase: 'checking' })
    const [status, storage] = await Promise.all([offline.getStatus().catch(() => null), offline.storageInfo()])
    set((s) => ({ status: status ?? s.status, storage, phase: s.phase === 'checking' ? 'idle' : s.phase }))
  },

  download: async ({ fromUser = false } = {}) => {
    // one job at a time; a queued one only fetches what the previous left missing (e.g. the AI runtime turned on mid-download)
    while (running) await running
    const job = (async () => {
      set({ phase: 'downloading', error: null, progress: null })
      try {
        const status = await offline.download(groups(), (progress) => set({ progress }))
        set({ status, phase: 'idle', progress: null })
        if (fromUser) useUi.getState().toast('Shasta is ready to use offline.', { tone: 'success' })
      } catch (e) {
        const error = e instanceof offline.OfflineError ? { code: e.code, message: e.message } : { code: 'unknown', message: String(e) }
        set({ phase: 'error', error })
        useLog.getState().add('warn', `Offline download: ${error.message}`)
        if (fromUser || error.code === 'quota') useUi.getState().toast(error.message, { tone: 'error', ms: 8000 })
      } finally {
        running = null
        void get().refresh()
      }
    })()
    running = job
    return job
  },

  clear: async () => {
    await offline.clearShell()
    set({ error: null, phase: 'idle', progress: null })
    await get().refresh()
  },

  setKeep: async (patch) => {
    useSettings.getState().update(patch)
    if (patch.offlineAiRuntime === false) {
      await offline.dropGroup('ai').catch(() => undefined)
      await get().refresh()
    }
    if (patch.offlineShell || patch.offlineAiRuntime) await get().download({ fromUser: true })
  },

  persist: async () => {
    const granted = await offline.requestPersistence()
    await get().refresh()
    return granted
  },

  applyUpdate: () => offline.applyUpdate(),

  boot: () => {
    if (booted || !('serviceWorker' in navigator)) return
    booted = true
    offline.clearSignInMarker()
    const checkSignIn = async () => {
      const expired = await offline.signInExpired()
      if (expired && !get().signInExpired) {
        useUi.getState().toast('Your sign-in to this Shasta site has expired. Shasta keeps working, but updates, the Store and browsing need you to sign in again.', { action: { label: 'Sign in', run: () => location.assign(offline.SIGN_IN_URL) }, ms: 20_000 })
      }
      set({ signInExpired: expired })
    }
    offline.watchUpdates(() => {
      if (get().updateReady) return
      set((s) => ({ updateReady: true, update: s.update ? { ...s.update, state: 'updated', error: null } : s.update }))
      useUi.getState().toast('A new version of Shasta is ready. Restart to use it; your tabs come back.', { action: { label: 'Restart', run: () => void get().applyUpdate() }, ms: 20_000 })
    })
    const auto = async () => {
      const s = useSettings.getState().settings
      await checkSignIn()
      if (get().signInExpired) return
      await get().refresh()
      const status = get().status
      if (!s.offlineShell || !status?.enabled || !navigator.onLine) return
      // a data-saver connection waits for the person to press "Download for offline use"
      if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
      const missing = groups().some((g) => !offline.summarize(status.files, g).complete)
      if (missing) await get().download()
    }
    // after the browser has booted and the proxy engine has its service worker
    void navigator.serviceWorker.ready.then(() => setTimeout(() => void auto().then(() => get().checkUpdate()), 4000))
    // an open window keeps looking for new versions (the browser itself only checks on navigation)
    setInterval(() => {
      if (navigator.onLine && !get().updateReady) void get().checkUpdate()
    }, 60 * 60_000)
    // an interrupted download continues once the connection is back
    window.addEventListener('online', () => {
      void checkSignIn()
      const { phase, error } = get()
      if (phase === 'error' && error && ['network', 'stalled', 'http'].includes(error.code)) void get().download()
    })
  },
}))
