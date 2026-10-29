import { useTabs } from '@/stores/tabsStore'

/** Whether the tab being looked at is a Private tab (no history, session, favicon or bookmark is saved for it). */
export const useIsPrivateTab = () => useTabs((s) => !!s.tabs.find((t) => t.id === s.activeId)?.private)

/** Same, outside React. */
export const isActivePrivate = () => {
  const s = useTabs.getState()
  return !!s.tabs.find((t) => t.id === s.activeId)?.private
}

export const NO_PRIVATE_BOOKMARKS = "Bookmarks aren't saved from private tabs."
