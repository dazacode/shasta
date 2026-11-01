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
      <div className="mx-auto w-full max-w-6xl px-6 pt-8 pb-16 text-shasta-fg md:px-8">
        <MyApps
          actions={
            <>
              <Button variant="secondary" className="h-9 px-3" onClick={() => useTabs.getState().openInternal('store')}><Store /> Open the Store</Button>
              <SupporterBadge />
            </>
          }
        />
      </div>
    </NavProvider>
  )
}
