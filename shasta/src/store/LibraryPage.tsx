import { Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'
import { useStoreBoot } from './hooks'
import { NavProvider } from './nav'
import MyApps from './MyApps'
import { SupporterBadge } from '@/components/SupporterBadge'
import { useSocialBadge } from '@/lib/socialBadge'
import { SOCIAL_AVAILABLE } from '@/social/origin'

/** A quiet pointer to shasta://social for a computer that isn't linked yet: the phone can carry this Library. */
function ContinueOnPhoneLink() {
  const signedIn = useSocialBadge((s) => s.signedIn)
  if (!SOCIAL_AVAILABLE || signedIn) return null
  return (
    <p className="mt-10 text-sm text-shasta-muted">
      Want this Library on your phone too?{' '}
      <button type="button" className="text-shasta-accent hover:underline" onClick={() => useTabs.getState().openInternal('social')}>
        Continue on your phone
      </button>
    </p>
  )
}

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
        <ContinueOnPhoneLink />
      </div>
    </NavProvider>
  )
}
