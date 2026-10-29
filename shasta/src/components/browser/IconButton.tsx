import type { ComponentProps, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface Props extends Omit<ComponentProps<'button'>, 'children'> {
  label: string
  /** keyboard shortcut shown in the tooltip */
  shortcut?: string
  children: ReactNode
}

export function IconButton({ label, shortcut, children, className, ...props }: Props) {
  return (
    <Tooltip>
      {/* a real <button>, so `disabled` is the native attribute (the trigger alone only sets a data flag) */}
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              'relative grid size-8 shrink-0 place-items-center rounded-full text-shasta-muted transition-colors',
              'hover:bg-shasta-hover hover:text-shasta-fg active:bg-shasta-line disabled:pointer-events-none disabled:opacity-40',
              className,
            )}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
