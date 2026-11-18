// Avatars (docs/social-protocol.md "Client modules"): DiceBear styles whose artwork is CC0 1.0 (checked in each style's
// package metadata: lorelei, notionists, open-peeps, thumbs, pixel-art; the code is MIT), drawn on this device and
// never fetched from an avatar service. `Avatar.preset` is "<style>:<seed>"; nobody uploads a picture of themselves.
// The art library loads lazily (avatarArt.ts), so a page showing avatars paints a plain coloured circle first.
import type { Avatar } from './types'

export const AVATAR_STYLES = ['lorelei', 'notionists', 'open-peeps', 'thumbs', 'pixel-art'] as const
export type AvatarStyle = (typeof AVATAR_STYLES)[number]

export const AVATAR_STYLE_LABELS: Record<AvatarStyle, string> = {
  lorelei: 'Drawn',
  notionists: 'Sketch',
  'open-peeps': 'Doodle',
  thumbs: 'Blob',
  'pixel-art': 'Pixel',
}

/** soft backgrounds that keep the drawings readable in light and dark */
export const AVATAR_BGS = ['#f6d6ad', '#fde2e4', '#d7e3fc', '#c9e4de', '#e2ece9', '#fff1c1', '#e8dff5', '#cfe8ff', '#ffd8be', '#dbe7c9'] as const

const SEED = /^[A-Za-z0-9_-]{1,32}$/
const HEX = /^#[0-9a-fA-F]{6}$/

export function parsePreset(preset: string): { style: AvatarStyle; seed: string } | null {
  const i = preset.indexOf(':')
  if (i < 0) return null
  const style = preset.slice(0, i) as AvatarStyle
  const seed = preset.slice(i + 1)
  return AVATAR_STYLES.includes(style) && SEED.test(seed) ? { style, seed } : null
}

export function validAvatar(a: unknown): a is Avatar {
  if (!a || typeof a !== 'object') return false
  const { preset, bg } = a as Record<string, unknown>
  return typeof preset === 'string' && !!parsePreset(preset) && typeof bg === 'string' && HEX.test(bg)
}

const randomSeed = (random: () => number) => {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 10; i++) s += abc[Math.floor(random() * abc.length)]
  return s
}

/** A fresh random avatar, optionally in a given style (the Shuffle button). */
export function randomAvatar(style?: AvatarStyle, random: () => number = Math.random): Avatar {
  const st = style ?? AVATAR_STYLES[Math.floor(random() * AVATAR_STYLES.length)]
  return { preset: `${st}:${randomSeed(random)}`, bg: AVATAR_BGS[Math.floor(random() * AVATAR_BGS.length)] }
}

// ---- rendering ---------------------------------------------------------------------------------------------------

const cache = new Map<string, string>()
const keyOf = (a: Avatar) => `${a.preset}|${a.bg}`
let art: Promise<typeof import('./avatarArt')> | null = null

/** The avatar as an SVG data URI, if it was drawn already (synchronous, for the first paint). */
export function cachedAvatarUri(a: Avatar): string | null {
  return cache.get(keyOf(a)) ?? null
}

/** The avatar as an SVG data URI (shown through <img>, so the SVG can never run anything). Null for a bad preset. */
export async function avatarUri(a: Avatar): Promise<string | null> {
  const k = keyOf(a)
  const hit = cache.get(k)
  if (hit) return hit
  const p = parsePreset(a.preset)
  if (!p || !HEX.test(a.bg)) return null
  art ??= import('./avatarArt')
  const uri = await (await art).drawAvatar(p.style, p.seed, a.bg)
  if (cache.size > 300) cache.clear()
  cache.set(k, uri)
  return uri
}
