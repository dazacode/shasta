// Holiday looks, drawn: the new tab's photo background, the banner that heads the Store and Watch sections, and the
// per-theme copy and shelves. WHEN comes from lib/events.ts (via lib/seasonal.ts); WHICH photo from
// lib/seasonalPhotos.ts. Photos are self-hosted under /seasonal/, nothing else is downloaded.
import { useState, type ReactNode } from 'react'
import { ChevronDown, Ghost, Leaf, PartyPopper, Snowflake, type LucideIcon } from 'lucide-react'
import { lastDay, type ActiveEvent, type ThemeId } from '@/lib/events'
import { SEASONAL_PHOTOS, photoPage } from '@/lib/seasonalPhotos'
import { seasonalPhotoUrl } from '@/lib/wallpaper'
import { cn } from '@/lib/utils'

export const EVENT_ICON: Record<string, LucideIcon> = { halloween: Ghost, thanksgiving: Leaf, winter: Snowflake, newyear: PartyPopper }

export interface Shelf {
  title: string
  subtitle: string
  /** a plain catalogue query, the same any search makes */
  query: string
  see: string
}

/** What each theme puts in the Store and on Watch. `{until}` = the event's last day ("Nov 29"). */
export const THEMES: Record<ThemeId, { hue: number; store: { title: string; subtitle: string; shelves: Shelf[] }; watch: { title: string; subtitle: string } }> = {
  halloween: {
    hue: 50,
    store: {
      title: 'Halloween in the Store',
      subtitle: 'Horror games, Halloween treats and cozy spooks. Here through {until}.',
      shelves: [
        { title: 'Fright night favourites', subtitle: 'The most installed horror games', query: 'genre=horror&sort=popular', see: '/search?genre=horror&sort=popular' },
        { title: 'Halloween treats', subtitle: 'Pumpkins, costumes and trick-or-treating', query: 'q=halloween', see: '/search?q=halloween' },
        { title: 'Spooky but cozy', subtitle: 'For the ones who scare easily', query: 'q=spooky', see: '/search?q=spooky' },
      ],
    },
    watch: { title: 'Halloween at Shasta Watch', subtitle: 'Horror films, Halloween specials and spooky anime. Here through {until}.' },
  },
  harvest: {
    hue: 60,
    store: {
      title: 'Thanksgiving break in the Store',
      subtitle: 'Games for the long weekend, and ones to play with family. Here through {until}.',
      shelves: [
        { title: 'Big adventures for the long weekend', subtitle: 'The most played adventure games', query: 'genre=adventure&sort=popular', see: '/search?genre=adventure&sort=popular' },
        { title: 'Play together', subtitle: 'Multiplayer and co-op for the whole table', query: 'genre=multiplayer&sort=popular', see: '/search?genre=multiplayer&sort=popular' },
        { title: 'Cozy farms and cooking', subtitle: 'Slow games for a full stomach', query: 'genre=simulation&sort=popular', see: '/search?genre=simulation&sort=popular' },
      ],
    },
    watch: { title: 'Thanksgiving break on Watch', subtitle: 'Thanksgiving films, family movie night and shows to binge. Here through {until}.' },
  },
  winter: {
    hue: 240,
    store: {
      title: 'Winter break in the Store',
      subtitle: 'Holiday games and big ones for the long break. Here through {until}.',
      shelves: [
        { title: 'Holiday treats', subtitle: 'Christmas, snow and presents', query: 'q=christmas', see: '/search?q=christmas' },
        { title: 'Snow days', subtitle: 'Winter games for a cold afternoon', query: 'q=snow', see: '/search?q=snow' },
        { title: 'Long-break RPGs', subtitle: 'Two weeks off? Start a big one', query: 'genre=rpg&sort=popular', see: '/search?genre=rpg&sort=popular' },
      ],
    },
    watch: { title: 'Winter break on Watch', subtitle: 'Holiday films, specials and series to binge. Here through {until}.' },
  },
}

export const until = (text: string, season: ActiveEvent) => text.replaceAll('{until}', lastDay(season.window))

const photoOf = (id: string) => SEASONAL_PHOTOS.find((p) => p.id === id)

/** The new tab's holiday photo, slowly drifting (still with reduced motion); snow falls on the winter one. */
export function SeasonPhoto({ id }: { id: string }) {
  const photo = photoOf(id)
  return (
    <div className="nt-wall ev-wall" aria-hidden>
      {/* the page can be taller than the tab: the photo stays put in view while it scrolls */}
      <div className="ev-view">
        <div className="ev-photo" style={{ backgroundImage: `url("${seasonalPhotoUrl(id)}")`, backgroundPosition: photo?.position }} />
        {id === 'winter' && <div className="ev-snow" />}
        {/* keep the middle readable behind the search bar; a light photo gets a little more */}
        <div className={cn('ev-shade', photo && !photo.dark && 'ev-shade-strong')} />
      </div>
    </div>
  )
}

/** "Photo: Yellowstone National Park, public domain": shown under the wallpapers in Customize. */
export function PhotoCredit({ id, className }: { id: string; className?: string }) {
  const photo = photoOf(id)
  if (!photo) return null
  return (
    <p className={cn('text-xs text-shasta-faint', className)}>
      Photo:{' '}
      <a href={photoPage(photo)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        {photo.author}
      </a>
      , {photo.license === 'CC0' ? 'CC0' : 'public domain'}, via Wikimedia Commons
    </p>
  )
}

/** The banner on top of a holiday section (Store, Watch): the event's photo, its icon, a title. With `onToggle` it is
 *  the button that folds the section open and shut. */
export function SeasonBanner({ id, title, subtitle, open, onToggle, controls }: { id: string; title: string; subtitle: string; open?: boolean; onToggle?: () => void; controls?: string }) {
  const Icon = EVENT_ICON[id] ?? Snowflake
  const body = (
    <>
      <span className="ev-banner-photo" style={{ backgroundImage: `url("${seasonalPhotoUrl(id, 'sm')}")`, backgroundPosition: photoOf(id)?.position }} aria-hidden />
      <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-white/12 ring-1 ring-white/20 backdrop-blur-sm">
        <Icon className="size-5 text-white" aria-hidden />
      </span>
      <span className="relative min-w-0 flex-1 text-left">
        <span className="ev-title block">{title}</span>
        <span className="mt-0.5 block text-sm text-white/75">{subtitle}</span>
      </span>
      {onToggle && (
        <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-black/35 text-white ring-1 ring-white/15">
          <ChevronDown className={cn('size-5 transition-transform duration-200 ease-shasta', open && 'rotate-180')} aria-hidden />
        </span>
      )}
    </>
  )
  return onToggle ? (
    <button type="button" className="ev-banner w-full cursor-pointer" aria-expanded={open} aria-controls={controls} onClick={onToggle} title={open ? 'Fold away' : 'Show'}>
      {body}
    </button>
  ) : (
    <div className="ev-banner">{body}</div>
  )
}

const foldKey = (id: string) => `shasta-season-folded-${id}`
const readFolded = (id: string) => {
  try {
    return localStorage.getItem(foldKey(id)) === '1'
  } catch {
    return false
  }
}

/** A holiday section: the banner, then its rows. Clicking the banner folds it away (remembered on this device per
 *  place AND event, so folding Halloween does not hide winter break); folded, the rows are not mounted (no fetches). */
export function SeasonSection({ place, season, title, subtitle, children, className }: { place: string; season: ActiveEvent; title: string; subtitle: string; children: ReactNode; className?: string }) {
  const key = `${place}-${season.event.id}-${season.window.start.getFullYear()}`
  const [open, setOpen] = useState(() => !readFolded(key))
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      if (next) localStorage.removeItem(foldKey(key))
      else localStorage.setItem(foldKey(key), '1')
    } catch {
      /* storage blocked: it just is not remembered */
    }
  }
  const body = `ev-${place}`
  return (
    <section aria-label={title} className={cn('ev-section', className)}>
      <SeasonBanner id={season.event.id} title={title} subtitle={until(subtitle, season)} open={open} onToggle={toggle} controls={body} />
      {open && (
        <div id={body} className="ev-section-body px-3 pb-4 sm:px-4">
          {children}
        </div>
      )}
    </section>
  )
}
