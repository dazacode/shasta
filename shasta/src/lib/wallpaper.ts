// New-tab wallpapers: plain CSS gradients tinted over the page colour, so text stays readable in light and dark themes
// and nothing is downloaded or stored beyond the preset's name. Presets marked `supporter` are a cosmetic perk; a saved
// one that is locked again (pass ended) is shown as the default without touching the saved choice.
export type WallpaperName = 'none' | 'alpine' | 'dawn' | 'forest' | 'dusk' | 'ember' | 'ribbon' | 'aurora' | 'sunset' | 'lagoon' | 'prism' | 'nebula' | 'halloween'

export interface WallpaperPreset {
  label: string
  /** tint hue for the simple two-glow presets */
  hue: number | null
  /** a full CSS background instead of the hue tint */
  css?: string
  /** an opaque dark picture: the page switches to light text on it */
  dark?: boolean
  /** a supporter perk */
  supporter?: true
  /** a seasonal wallpaper: shown for everyone during its season, kept afterwards only by people who claimed it */
  claim?: true
}

const glow = (l: number, c: number, h: number, a: number) => `oklch(${l} ${c} ${h} / ${a})`

export const WALLPAPERS: Record<WallpaperName, WallpaperPreset> = {
  none: { label: 'None', hue: null },
  alpine: { label: 'Alpine', hue: 230 },
  dawn: { label: 'Dawn', hue: 50 },
  forest: { label: 'Forest', hue: 160 },
  dusk: { label: 'Dusk', hue: 295 },
  ember: { label: 'Ember', hue: 12 },
  ribbon: { label: 'Ribbons', hue: null, dark: true },
  aurora: {
    label: 'Aurora',
    hue: null,
    supporter: true,
    css: `radial-gradient(70% 45% at 72% 8%, ${glow(0.72, 0.16, 300, 0.38)}, transparent 62%), linear-gradient(165deg, ${glow(0.78, 0.15, 160, 0.4)}, transparent 42%), radial-gradient(60% 60% at 8% 92%, ${glow(0.7, 0.13, 200, 0.32)}, transparent 62%)`,
  },
  sunset: {
    label: 'Sunset',
    hue: null,
    supporter: true,
    css: `radial-gradient(40% 30% at 50% 100%, ${glow(0.85, 0.15, 85, 0.5)}, transparent 70%), linear-gradient(0deg, ${glow(0.72, 0.17, 35, 0.42)}, ${glow(0.68, 0.15, 350, 0.26)} 45%, transparent 80%)`,
  },
  lagoon: {
    label: 'Lagoon',
    hue: null,
    supporter: true,
    css: `conic-gradient(from 200deg at 85% 0%, ${glow(0.78, 0.13, 200, 0.4)}, ${glow(0.8, 0.13, 170, 0.3)} 25%, transparent 45%), radial-gradient(70% 50% at 0% 100%, ${glow(0.75, 0.12, 185, 0.32)}, transparent 65%)`,
  },
  prism: {
    label: 'Prism',
    hue: null,
    supporter: true,
    css: `radial-gradient(50% 50% at 0% 0%, ${glow(0.75, 0.16, 20, 0.35)}, transparent 70%), radial-gradient(50% 50% at 100% 0%, ${glow(0.8, 0.15, 95, 0.32)}, transparent 70%), radial-gradient(50% 50% at 100% 100%, ${glow(0.75, 0.14, 210, 0.35)}, transparent 70%), radial-gradient(50% 50% at 0% 100%, ${glow(0.72, 0.16, 300, 0.35)}, transparent 70%)`,
  },
  nebula: {
    label: 'Nebula',
    hue: null,
    supporter: true,
    dark: true,
    css: 'radial-gradient(1.5px 1.5px at 18% 28%, #fff, transparent), radial-gradient(1px 1px at 62% 18%, #fff, transparent), radial-gradient(1.5px 1.5px at 82% 58%, #fff, transparent), radial-gradient(1px 1px at 34% 76%, #fff, transparent), radial-gradient(1px 1px at 90% 88%, #fff, transparent), radial-gradient(55% 45% at 28% 32%, #7c3aed99, transparent 65%), radial-gradient(45% 40% at 76% 66%, #db277788, transparent 65%), radial-gradient(60% 50% at 60% 10%, #2563eb66, transparent 70%), #0b0820',
  },
  // Halloween 2026: drawn by components/seasonal/Halloween.tsx; claimable until Nov 1 (lib/seasonal.ts)
  halloween: { label: 'Halloween night', hue: null, dark: true, claim: true },
}

export const isWallpaper = (v: unknown): v is WallpaperName => typeof v === 'string' && Object.hasOwn(WALLPAPERS, v)

export const isLockedWallpaper = (name: WallpaperName, perks: boolean) => !!WALLPAPERS[name]?.supporter && !perks

/** A seasonal wallpaper this person never claimed. */
export const isUnclaimedWallpaper = (name: WallpaperName, claimed: readonly string[]) => !!WALLPAPERS[name]?.claim && !claimed.includes(name)

/** The wallpaper to draw: a saved supporter preset falls back to the default while perks are off (the saved choice stays),
 *  and so does a seasonal one that was never claimed. */
export function effectiveWallpaper(name: WallpaperName, perks: boolean, claimed: readonly string[] = []): WallpaperName {
  return !isWallpaper(name) || isLockedWallpaper(name, perks) || isUnclaimedWallpaper(name, claimed) ? 'none' : name
}

/** The small swatch for the glossy ribbon wallpaper; the page draws the full version (components/RibbonWallpaper.tsx). */
const RIBBON_PREVIEW = 'linear-gradient(120deg, transparent 20%, #8b5cf6 38%, #d9c2ff 46%, transparent 56%), linear-gradient(60deg, transparent 55%, #5b7bf0 68%, #cfe0ff 74%, transparent 84%), #0a0a22'

/** The small swatch for the Halloween night; the page draws the full scene. */
const HALLOWEEN_PREVIEW = 'radial-gradient(22% 22% at 72% 28%, #ffd98f 90%, transparent 100%), radial-gradient(60% 30% at 50% 100%, #08040c 60%, transparent 62%), radial-gradient(14% 12% at 28% 84%, #f07f24 80%, transparent 90%), linear-gradient(180deg, #07040f, #2a1036 80%, #5a1f22)'

/** Background for the new tab page, or undefined for the plain page colour. */
export function wallpaperBackground(name: WallpaperName): string | undefined {
  if (name === 'ribbon') return RIBBON_PREVIEW
  if (name === 'halloween') return HALLOWEEN_PREVIEW
  const preset = WALLPAPERS[name]
  if (preset?.css) return preset.css
  const hue = preset?.hue
  if (hue == null) return undefined
  const tint = (l: number, a: number, h = hue) => `oklch(${l} 0.14 ${h} / ${a})`
  return `radial-gradient(120% 80% at 15% 0%, ${tint(0.72, 0.4)}, transparent 60%), radial-gradient(90% 70% at 100% 100%, ${tint(0.6, 0.3, hue + 40)}, transparent 55%)`
}
