import { useEffect } from 'react'
import { describeContext } from '@/lib/contextTarget'
import { installDevtoolsGuard } from '@/lib/devtoolsGuard'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'

/**
 * Shasta's own chrome and pages: the browser's right-click menu is replaced with Shasta's, and (production builds
 * only) the devtools shortcuts are blocked. Proxied pages get the same treatment from the proxy plugin.
 */
export function useBrowserGuards() {
  useEffect(() => {
    installDevtoolsGuard(window)
    const onContext = (e: MouseEvent) => {
      // a Shasta component that has its own menu (tabs, bookmarks) already handled this one
      if (e.defaultPrevented) return
      if (e.shiftKey && !import.meta.env.PROD) return // development: Shift + right-click for the browser's menu
      e.preventDefault()
      const target = e.target as Element | null
      const inView = !!target?.closest?.('#browser-view')
      useUi.getState().openContextMenu(useTabs.getState().activeId, describeContext(window, e, inView))
    }
    document.addEventListener('contextmenu', onContext)
    return () => document.removeEventListener('contextmenu', onContext)
  }, [])
}
