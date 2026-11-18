// A shelf of Store games and apps (a profile's showcase, or a library list). Public catalogue data only: name and
// icon, never playtime. Inside a ProfileView it takes the profile's colours (--p-*), elsewhere Shasta's.
import { Gamepad2, LayoutGrid } from 'lucide-react'
import type { ShowcaseApp } from '@/social/types'
import { cn } from '@/lib/utils'

export interface ShowcaseShelfProps {
  apps: ShowcaseApp[]
  onOpen?(app: ShowcaseApp): void
  /** shown when there are none */
  emptyText?: string
  className?: string
}

export function AppIcon({ app, size = 56 }: { app: ShowcaseApp; size?: number }) {
  const Icon = app.scheme === 'game' ? Gamepad2 : LayoutGrid
  return app.iconUrl ? (
    <img src={app.iconUrl} alt="" width={size} height={size} className="rounded-xl object-cover" style={{ width: size, height: size }} loading="lazy" draggable={false} />
  ) : (
    <span className="grid place-items-center rounded-xl bg-[var(--p-line,var(--sh-field))]" style={{ width: size, height: size }} aria-hidden>
      <Icon className="size-1/2 opacity-70" />
    </span>
  )
}

export function ShowcaseShelf({ apps, onOpen, emptyText = 'Nothing here yet.', className }: ShowcaseShelfProps) {
  if (!apps.length) return <p className={cn('text-sm text-[var(--p-muted,var(--sh-muted))]', className)}>{emptyText}</p>
  return (
    <ul className={cn('grid grid-cols-3 gap-3 sm:grid-cols-4', className)}>
      {apps.map((app) => {
        const inner = (
          <>
            <AppIcon app={app} />
            <span className="mt-1.5 line-clamp-2 text-center text-xs leading-tight">{app.name}</span>
          </>
        )
        return (
          <li key={app.appId}>
            {onOpen ? (
              <button type="button" onClick={() => onOpen(app)} className="flex w-full flex-col items-center rounded-xl p-1.5 sh-press hover:bg-[var(--p-line,var(--sh-hover))]" aria-label={`${app.name} (${app.scheme === 'game' ? 'game' : 'app'})`}>
                {inner}
              </button>
            ) : (
              <div className="flex flex-col items-center p-1.5">{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
