// Seasonal looks (Halloween 2026). Everything seasonal asks this file, so it switches itself off on the end date
// without a release: the Watch shelves, the Store's theme and section, and the new tab's night scene.
import { useEffect, useState } from 'react'
import { getSettings, useSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'

/** Halloween 2026: from Oct 24 until local midnight on Nov 1. */
const HALLOWEEN = { start: new Date(2026, 9, 24).getTime(), end: new Date(2026, 10, 1).getTime() }

export function isHalloween(now = Date.now()) {
  return now >= HALLOWEEN.start && now < HALLOWEEN.end
}

/** True while it is Halloween; re-renders when midnight on Nov 1 passes on a page left open. */
export function useHalloween() {
  const [on, setOn] = useState(isHalloween)
  useEffect(() => {
    const left = HALLOWEEN.end - Date.now()
    if (!on || left <= 0 || left > 2 ** 31 - 1) return
    const t = setTimeout(() => setOn(false), left + 1000)
    return () => {
      clearTimeout(t)
    }
  }, [on])
  return on
}

/** Halloween AND the person has not turned holiday looks off (Settings: `seasonalLooks`). What the Store, Watch and
 *  the new tab use; the date alone (useHalloween) only decides whether the wallpaper can still be claimed. */
export function useHalloweenLook() {
  const season = useHalloween()
  const on = useSettings((s) => s.settings.seasonalLooks)
  return season && on
}

/** Keep the Halloween night as this browser's wallpaper, also after the season. */
export function claimHalloween() {
  const s = getSettings()
  const claimed = s.claimedWallpapers.includes('halloween') ? s.claimedWallpapers : [...s.claimedWallpapers, 'halloween' as const]
  useSettings.getState().update({ claimedWallpapers: claimed, wallpaper: 'halloween', newTabBg: 'preset', seasonalLooks: true })
  useUi.getState().toast('The Halloween night is yours. It stays after Halloween; change it any time in Customize.')
}

/** Back to normal everywhere (new tab, Store, Watch). A claim is kept, but the Halloween wallpaper is unpicked. */
export function turnOffHalloween() {
  const s = getSettings()
  useSettings.getState().update({ seasonalLooks: false, ...(s.wallpaper === 'halloween' ? { wallpaper: 'none' as const } : {}) })
  useUi.getState().toast('Halloween look turned off. Customize on the new tab turns it back on.')
}
