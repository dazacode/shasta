import { Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'
import { useStoreBoot } from './hooks'
import { NavProvider } from './nav'
import MyApps from './MyApps'
import { SupporterBadge } from '@/components/SupporterBadge'

/** shasta://library: the user's installed apps and games, favorites and followed storefronts. Separate from the Store. */
export function LibraryPage({ tabId }: { tabId: string }) {
  useStoreBoot()
  return (
    <NavProvider tabId={tabId} url="shasta://library" external>
      <div className="mx-auto w-full max-w-6xl px-6 pb-16 text-shasta-fg">
        <div className="flex items-center justify-end gap-3 pt-5">
          <SupporterBadge />
          <Button variant="secondary" onClick={() => useTabs.getState().openInternal('store')}><Store /> Open the Store</Button>
        </div>
        <MyApps />
      </div>
    </NavProvider>
  )
}
