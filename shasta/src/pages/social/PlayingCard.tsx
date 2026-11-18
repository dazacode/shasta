// "Playing now" on Social's Home: a friend's game as a wide card in the game's own art (its Store banner, else its icon
// over a blur of itself, the Store's AppCover), their face on the corner and a Play button that opens the same game
// here through the Store's own launch. Presence is only ever a published Store app the friend chose to share.
import { motion, useReducedMotion } from 'motion/react'
import { Gamepad2, LayoutGrid } from 'lucide-react'
import type { Friend, Presence } from '@/social/types'
import type { AppDetail } from '@/store/types'
import { playingFor } from '@/social/format'
import { SocialAvatar } from '@/components/social'
import { AppCover } from '@/store/components'
import { useApi } from '@/store/hooks'
import { Button } from '@/components/ui/button'
import { openStoreApp } from './social'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function PlayingCard({ friend, presence, index, onOpenFriend }: { friend: Friend; presence: Presence; index: number; onOpenFriend(): void }) {
  const calm = useReducedMotion()
  const app = presence.app
  // the banner comes from the public catalogue (cached by the Store's own loader); until then, the icon look
  const detail = useApi<AppDetail>(`/api/catalog/apps/${encodeURIComponent(app.slug)}`, { live: false })
  const game = app.scheme === 'game'
  const Kind = game ? Gamepad2 : LayoutGrid
  return (
    <motion.article
      initial={calm ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: calm ? 0 : index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-2xl bg-shasta-home ring-1 ring-shasta-line"
      aria-label={`@${friend.handle} is playing ${app.name}`}
    >
      <div className="relative overflow-hidden">
        <AppCover app={{ name: app.name, bannerUrl: detail.data?.bannerUrl ?? null, iconUrl: app.iconUrl }} className="transition-transform duration-500 ease-shasta group-hover:scale-[1.03]" />
      </div>
      <div className="flex items-center gap-3 p-3.5">
        <button type="button" onClick={onOpenFriend} className="relative z-10 -mt-9 shrink-0 rounded-full outline-offset-2" aria-label={`Open @${friend.handle}'s profile`}>
          <SocialAvatar avatar={friend.avatar} size={52} className="ring-4 ring-shasta-home" />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-medium">{app.name}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-shasta-muted">
            <Kind className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              @{friend.handle} · {cap(playingFor(presence.since))}
              {presence.device === 'phone' ? ' · on their phone' : ''}
            </span>
          </p>
        </div>
        <Button className="h-9 shrink-0 px-4" onClick={() => openStoreApp(app)} aria-label={`${game ? 'Play' : 'Open'} ${app.name}`}>
          {game ? 'Play' : 'Open'}
        </Button>
      </div>
    </motion.article>
  )
}
