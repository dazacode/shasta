// The phone app's navigation: four tabs, plus a stack of screens on top (a chat, a profile, a settings page). Each
// pushed screen is a history entry, so the phone's Back gesture and button close it the way people expect.
import { create } from 'zustand'
import type { Arrival } from './arrival'

export type Tab = 'home' | 'messages' | 'add' | 'me'
export type Route =
  | { r: 'thread'; friendId: string }
  | { r: 'person'; handle: string }
  | { r: 'edit' }
  | { r: 'library' }
  | { r: 'devices' }
  | { r: 'privacy' }
  | { r: 'backups' }
  | { r: 'delete' }
  | { r: 'parents' }
  | { r: 'keep' }
  | { r: 'scan'; mode: 'friend' | 'link' }
  | { r: 'arrival'; arrival: NonNullable<Arrival> }

interface NavState {
  tab: Tab
  stack: Route[]
  setTab(tab: Tab): void
  push(route: Route): void
  /** replaces the top screen (scanner -> what it scanned) */
  replace(route: Route): void
  back(): void
  /** closes every pushed screen */
  reset(tab?: Tab): void
}

export const useNav = create<NavState>((set, get) => ({
  tab: 'home',
  stack: [],
  setTab: (tab) => {
    if (get().stack.length) get().reset(tab)
    else set({ tab })
    scrollTo({ top: 0 })
  },
  push: (route) => {
    history.pushState({ me: get().stack.length + 1 }, '')
    set({ stack: [...get().stack, route] })
    scrollTo({ top: 0 })
  },
  replace: (route) => {
    const stack = get().stack
    if (!stack.length) return get().push(route)
    set({ stack: [...stack.slice(0, -1), route] })
  },
  back: () => {
    if (get().stack.length) history.back()
  },
  reset: (tab) => {
    const n = get().stack.length
    set({ stack: [], tab: tab ?? get().tab })
    if (n) history.go(-n)
  },
}))

/** Back gesture / button: pop one screen. Run once at start. */
export function watchHistory() {
  window.addEventListener('popstate', () => {
    const { stack } = useNav.getState()
    if (stack.length) useNav.setState({ stack: stack.slice(0, -1) })
  })
}
