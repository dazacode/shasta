// A thin advert strip pinned along the very bottom of the window, below the page. Always on screen, so it earns on
// every tab, game and site — the most intrusive placement, so it gets its own setting and hides with the toolbar in
// game mode (a bottom strip would otherwise shrink the play area or the page).
import { HAS_DISPLAY_ADS } from '@/lib/ads'
import { useSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { AdSlot } from './AdSlot'

export function AdBar() {
  const on = useSettings((s) => s.settings.ads && s.settings.adsBar)
  const chromeHidden = useUi((s) => s.chromeHidden)
  if (!HAS_DISPLAY_ADS || !on || chromeHidden) return null

  return (
    <div className="shrink-0 border-t border-shasta-line bg-shasta-chrome" data-ad-bar>
      <AdSlot format="horizontal" minHeight={56} className="mx-auto w-full max-w-6xl px-3 py-1" />
    </div>
  )
}
