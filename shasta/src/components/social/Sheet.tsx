// A sheet: slides up from the bottom on a phone, a centred card on a wider screen. Built on Base UI's Dialog (focus
// trap, Escape, scroll lock, labelled by its title), the same primitive as components/ui/dialog.tsx.
import type { ReactNode } from 'react'
import { Dialog as D } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
  /** hide the close button (a sheet that must be answered) */
  noClose?: boolean
}

export function Sheet({ open, onOpenChange, title, description, children, className, noClose }: SheetProps) {
  return (
    <D.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <D.Popup
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-shasta-home p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-shasta-fg shadow-xl ring-1 ring-shasta-line outline-none',
            'transition-transform duration-300 ease-shasta data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:data-[ending-style]:translate-y-[-45%] sm:data-[ending-style]:opacity-0 sm:data-[starting-style]:translate-y-[-45%] sm:data-[starting-style]:opacity-0',
            className,
          )}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-shasta-line sm:hidden" aria-hidden />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <D.Title className="text-lg font-medium">{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-shasta-muted">{description}</D.Description>}
            </div>
            {!noClose && (
              <D.Close className="-mr-2 -mt-1 grid size-11 place-items-center rounded-full text-shasta-muted hover:bg-shasta-hover" aria-label="Close">
                <X className="size-5" />
              </D.Close>
            )}
          </div>
          <div className="mt-4">{children}</div>
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}
