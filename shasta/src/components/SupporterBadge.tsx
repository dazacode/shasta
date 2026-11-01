import { Heart } from 'lucide-react'
import { useSupporter } from '@/stores/supporterStore'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'

/** A small "Supporter" (or "Trial") pill. Renders nothing unless perks are on; opens the Supporter settings. */
export function SupporterBadge({ className }: { className?: string }) {
  const { perks, kind, daysLeft } = useSupporter()
  if (!perks) return null
  const label = kind === 'trial' ? 'Trial' : 'Supporter'
  return (
    <button
      type="button"
      onClick={() => useTabs.getState().openInternal('settings', 'supporter')}
      title={`${label} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left. Thank you for helping keep Shasta running.`}
      className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-shasta-muted ring-1 ring-shasta-line transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg', className)}
    >
      <Heart className="size-3 fill-current" aria-hidden /> {label}
    </button>
  )
}
