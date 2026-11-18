// A person's avatar (social/avatars.ts): a DiceBear drawing made on this device, shown through <img> so the SVG can
// never run anything. Paints the plain background colour until the art library has loaded.
import { useEffect, useState } from 'react'
import type { Avatar } from '@/social/types'
import { avatarUri, cachedAvatarUri } from '@/social/avatars'
import { cn } from '@/lib/utils'

export interface SocialAvatarProps {
  avatar: Avatar | null | undefined
  /** px */
  size?: number
  /** for screen readers, e.g. "@sam"; omit when a name is shown right next to it */
  label?: string
  className?: string
}

export function SocialAvatar({ avatar, size = 40, label, className }: SocialAvatarProps) {
  const [uri, setUri] = useState<string | null>(() => (avatar ? cachedAvatarUri(avatar) : null))
  const key = avatar ? `${avatar.preset}|${avatar.bg}` : ''
  useEffect(() => {
    let live = true
    if (!avatar) {
      setUri(null)
      return
    }
    setUri(cachedAvatarUri(avatar))
    void avatarUri(avatar).then((u) => live && setUri(u))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the avatar's identity
  }, [key])
  return (
    <span
      className={cn('inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-black/5', className)}
      style={{ width: size, height: size, background: avatar?.bg ?? 'var(--sh-field)' }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {uri && <img src={uri} alt="" width={size} height={size} className="block size-full" draggable={false} />}
    </span>
  )
}
