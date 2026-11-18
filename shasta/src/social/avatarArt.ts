// The DiceBear drawing code, loaded on first use by avatars.ts. Only the CC0 styles, each from its own package (the
// same ones @dicebear/collection re-exports) and each in its own chunk: together they are ~1.2 MB, and a screen
// usually needs one or two of them.
import { createAvatar } from '@dicebear/core'
import type { AvatarStyle } from './avatars'

type Style = Parameters<typeof createAvatar>[0]

const LOAD: Record<AvatarStyle, () => Promise<Style>> = {
  lorelei: () => import('@dicebear/lorelei') as Promise<Style>,
  notionists: () => import('@dicebear/notionists') as Promise<Style>,
  'open-peeps': () => import('@dicebear/open-peeps') as Promise<Style>,
  thumbs: () => import('@dicebear/thumbs') as Promise<Style>,
  'pixel-art': () => import('@dicebear/pixel-art') as Promise<Style>,
}
const loaded = new Map<AvatarStyle, Promise<Style>>()

export async function drawAvatar(style: AvatarStyle, seed: string, bg: string): Promise<string> {
  let p = loaded.get(style)
  if (!p) {
    p = LOAD[style]()
    p.catch(() => loaded.delete(style))
    loaded.set(style, p)
  }
  // seed and backgroundColor are options every style has
  return createAvatar(await p, { seed, backgroundColor: [bg.slice(1)] }).toDataUri()
}
