// Holiday looks. Everything seasonal (the new tab's scene and greeting, the Store's colours and shelves, Watch's
// section) asks this file which event is on; the dates come from the recurring calendar in lib/events.ts, so nothing
// here names a year and a look switches itself on and off without a release.
import { useEffect, useState } from 'react'
import { getSettings, useSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { activeEvent, msUntilChange, type ActiveEvent } from '@/lib/events'
import type { WallpaperName } from '@/lib/wallpaper'

/** The event on right now (or null); re-renders when it starts, ends or changes greeting on a page left open. */
export function useSeason(): ActiveEvent | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), msUntilChange(now) + 1000)
    return () => {
      clearTimeout(t)
    }
  }, [now])
  return activeEvent(now)
}

/** The event on right now AND the person has not turned holiday looks off (Settings: `seasonalLooks`). What the
 *  Store, Watch and the new tab use; the date alone (useSeason) only decides whether a wallpaper can be claimed. */
export function useSeasonLook(): ActiveEvent | null {
  const season = useSeason()
  const on = useSettings((s) => s.settings.seasonalLooks)
  return on ? season : null
}

/** Each event's photo is also a wallpaper (lib/wallpaper.ts, `claim: true`): shown for everyone while the event is on,
 *  kept afterwards by people who claim it. */
export const eventWallpaper = (season: ActiveEvent) => season.event.id as WallpaperName
export const SEASONAL_WALLPAPERS: WallpaperName[] = ['halloween', 'thanksgiving', 'winter', 'newyear']

/** Keep this event's photo as this browser's wallpaper, also after the event. */
export function claimSeasonWallpaper(season: ActiveEvent) {
  const name = eventWallpaper(season)
  const s = getSettings()
  const claimed = s.claimedWallpapers.includes(name) ? s.claimedWallpapers : [...s.claimedWallpapers, name]
  useSettings.getState().update({ claimedWallpapers: claimed, wallpaper: name, newTabBg: 'preset', seasonalLooks: true })
  useUi.getState().toast(`It's yours. It stays after ${season.event.name}; change it any time in Customize.`)
}

/** Back to normal everywhere (new tab, Store, Watch). Claims are kept, but a holiday wallpaper is unpicked. */
export function turnOffSeason(season: ActiveEvent) {
  const s = getSettings()
  useSettings.getState().update({ seasonalLooks: false, ...(SEASONAL_WALLPAPERS.includes(s.wallpaper) ? { wallpaper: 'none' as const } : {}) })
  const name = season.event.name
  useUi.getState().toast(`${name[0].toUpperCase()}${name.slice(1)} look turned off. Customize on the new tab turns holiday looks back on.`)
}
