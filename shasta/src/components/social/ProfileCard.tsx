// A person as a small card: a band painted in THEIR profile look (social/themes.ts: the validated colours and curated
// background they picked, never custom CSS), their face overlapping it, the handle in their font, and a line about
// them (status, mood, or what they're playing). Used for friends lists and "you" cards. Without their theme loaded yet
// (or for someone whose profile isn't visible), the band takes their avatar's own background colour.
import type { CSSProperties, ReactNode } from 'react'
import type { Person, Presence, Theme } from '@/social/types'
import { MOODS } from '@/social/format'
import { FONTS, backgroundById, validTheme } from '@/social/themes'
import { cn } from '@/lib/utils'
import { SocialAvatar } from './SocialAvatar'
import { PresenceLine } from './FriendRow'

export interface ProfileCardProps {
  person: Person
  /** their profile look; omit until it has loaded */
  theme?: Theme | null
  presence?: Presence | null
  /** instead of status / mood */
  note?: ReactNode
  /** buttons along the bottom */
  actions?: ReactNode
  /** the whole card opens their profile (actions stay separate buttons) */
  onOpen?(person: Person): void
  /** "lg" for your own card on the side of a page */
  size?: 'md' | 'lg'
  className?: string
}

/** The band: their curated background in their colours, or a calm wash of their avatar colour. */
export function bandStyle(person: Pick<Person, 'avatar'>, theme?: Theme | null): CSSProperties {
  if (theme && validTheme(theme)) return { background: backgroundById(theme.background).css(theme) }
  const c = person.avatar?.bg ?? '#8892a6'
  return { background: `linear-gradient(160deg, ${c}, color-mix(in oklab, ${c} 70%, #000))` }
}

export function ProfileCard({ person, theme, presence, note, actions, onOpen, size = 'md', className }: ProfileCardProps) {
  const lg = size === 'lg'
  const avatar = lg ? 76 : 60
  const font = theme && validTheme(theme) ? FONTS[theme.font] : null
  const sub = note ?? (person.status ? person.status : person.mood ? `Feeling ${MOODS[person.mood].toLowerCase()}` : null)
  return (
    <article className={cn('group relative flex flex-col overflow-hidden rounded-2xl bg-shasta-home ring-1 ring-shasta-line', onOpen && 'transition-shadow duration-200 ease-shasta hover:shadow-[0_6px_20px_-8px_rgb(0_0_0/0.35)]', className)} aria-label={`@${person.handle}`}>
      <div className={cn('shrink-0', lg ? 'h-24' : 'h-16')} style={bandStyle(person, theme)} aria-hidden />
      <div className={cn('flex min-w-0 flex-1 flex-col px-4 pb-4', lg ? '-mt-10' : '-mt-8')}>
        <SocialAvatar avatar={person.avatar} size={avatar} className="ring-4 ring-shasta-home" />
        {onOpen ? (
          <button type="button" onClick={() => onOpen(person)} className="mt-2 min-w-0 text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-shasta-accent" aria-label={`Open @${person.handle}'s profile`}>
            <Name handle={person.handle} lg={lg} font={font} />
          </button>
        ) : (
          <div className="mt-2 min-w-0">
            <Name handle={person.handle} lg={lg} font={font} />
          </div>
        )}
        {sub && <p className="mt-0.5 line-clamp-2 text-sm text-shasta-muted">{sub}</p>}
        <PresenceLine presence={presence} className="mt-1.5 text-shasta-fg [&_svg]:text-shasta-accent" />
        {actions && <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-3">{actions}</div>}
      </div>
    </article>
  )
}

function Name({ handle, lg, font }: { handle: string; lg: boolean; font: (typeof FONTS)[keyof typeof FONTS] | null }) {
  return (
    <span className={cn('block truncate font-medium', lg ? 'text-xl' : 'text-base')} style={font ? { fontFamily: font.stack, ...font.style } : undefined}>
      @{handle}
    </span>
  )
}
