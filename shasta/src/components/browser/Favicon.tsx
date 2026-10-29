import { useState } from 'react'
import { AlertTriangle, AppWindow, Bookmark, Download, Globe, HeartHandshake, History, Library as LibraryIcon, MessagesSquare, Settings, Sparkles, Store } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { internalPage, originOf } from '@/lib/url'
import { useLibrary } from '@/stores/libraryStore'
import { cn } from '@/lib/utils'

const INTERNAL_ICONS = { newtab: Logo, history: History, bookmarks: Bookmark, downloads: Download, settings: Settings, store: Store, library: LibraryIcon, app: AppWindow, support: HeartHandshake, 'get-app': Download, chat: MessagesSquare, discord: MessagesSquare, 'whats-new': Sparkles } as const

interface Props {
  url: string
  loading?: boolean
  error?: boolean
  className?: string
  /** an installed app's own icon, shown instead of the site's */
  appIcon?: string | null
}

/** Site icon from the favicon cache; a spinner while the page is really loading. */
export function Favicon({ url, loading, error, className, appIcon }: Props) {
  const page = internalPage(url)
  const origin = originOf(url)
  const src = useLibrary((s) => (origin ? s.favicons[origin] : undefined))
  const [failed, setFailed] = useState<string | null>(null)
  const size = cn('size-4 shrink-0', className)

  if (loading) {
    return (
      <svg viewBox="0 0 24 24" className={cn(size, 'sh-spin text-shasta-accent')} fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  if (appIcon && !error) return <img src={appIcon} alt="" className={cn(size, 'rounded-[4px] object-cover')} draggable={false} />
  if (error) return <AlertTriangle className={cn(size, 'text-shasta-warn')} aria-hidden />
  if (page) {
    const Icon = INTERNAL_ICONS[page]
    return <Icon className={cn(size, 'text-shasta-accent')} aria-hidden />
  }
  if (src && failed !== src) {
    return <img src={src} alt="" className={cn(size, 'rounded-[3px] object-contain')} onError={() => setFailed(src)} draggable={false} />
  }
  return <Globe className={cn(size, 'text-shasta-muted')} aria-hidden />
}
