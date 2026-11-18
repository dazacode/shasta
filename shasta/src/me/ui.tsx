// Small building blocks for the phone screens: a screen with a header and Back, a grouped list, a settings row and a
// toggle row. 44 px touch targets, safe-area aware, Shasta's tokens.
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useNav } from './nav'

export function Screen({ title, children, back = true, actions, className, bodyClass }: { title: ReactNode; children: ReactNode; back?: boolean; actions?: ReactNode; className?: string; bodyClass?: string }) {
  const goBack = useNav((s) => s.back)
  return (
    <div className={cn('flex min-h-dvh flex-col', className)}>
      <header className="me-safe-top sticky top-0 z-20 border-b border-shasta-line bg-shasta-bg">
        <div className="me-safe-x flex h-14 items-center gap-1">
          {back && (
            <button type="button" onClick={goBack} className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-shasta-hover" aria-label="Back">
              <ChevronLeft className="size-6" />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-medium">{title}</h1>
          {actions}
        </div>
      </header>
      <main className={cn('me-safe-x me-safe-bottom flex-1 py-4', bodyClass)}>{children}</main>
    </div>
  )
}

export function Group({ title, children, footer, className }: { title?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-5', className)}>
      {title && <h2 className="mb-1.5 px-1 text-sm font-medium text-shasta-muted">{title}</h2>}
      <div className="divide-y divide-shasta-line overflow-hidden rounded-2xl bg-shasta-home ring-1 ring-shasta-line">{children}</div>
      {footer && <p className="mt-1.5 px-1 text-sm text-shasta-faint">{footer}</p>}
    </section>
  )
}

export function Row({ icon, label, detail, onClick, danger, children }: { icon?: ReactNode; label: ReactNode; detail?: ReactNode; onClick?(): void; danger?: boolean; children?: ReactNode }) {
  const body = (
    <>
      {icon && <span className={cn('grid size-8 shrink-0 place-items-center text-shasta-muted [&_svg]:size-5', danger && 'text-shasta-danger')}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn('block', danger && 'text-shasta-danger')}>{label}</span>
        {detail && <span className="block text-sm text-shasta-muted">{detail}</span>}
      </span>
      {children}
      {onClick && !children && <ChevronRight className="size-5 shrink-0 text-shasta-faint" aria-hidden />}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-shasta-hover">
      {body}
    </button>
  ) : (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">{body}</div>
  )
}

export function ToggleRow({ label, detail, checked, onChange, disabled }: { label: ReactNode; detail?: ReactNode; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2">
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {detail && <span className="block text-sm text-shasta-muted">{detail}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} className="scale-125" />
    </label>
  )
}

/** A full-width primary/secondary button with a 44 px target. */
export function BigButton({ children, onClick, variant = 'primary', disabled, type = 'button', className }: { children: ReactNode; onClick?(): void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-medium sh-press disabled:opacity-50 [&_svg]:size-5',
        variant === 'primary' && 'bg-shasta-accent text-shasta-accent-fg',
        variant === 'secondary' && 'bg-shasta-home text-shasta-fg ring-1 ring-shasta-line',
        variant === 'ghost' && 'text-shasta-accent',
        variant === 'danger' && 'bg-shasta-danger text-white',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Note({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'warn'; className?: string }) {
  return (
    <div className={cn('rounded-2xl p-4 text-sm', tone === 'warn' ? 'bg-shasta-field ring-1 ring-shasta-warn' : 'bg-shasta-field', className)} role={tone === 'warn' ? 'alert' : undefined}>
      {children}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-10 text-shasta-muted" role="status">
      <span className="size-5 rounded-full border-2 border-shasta-line border-t-shasta-accent sh-spin" aria-hidden /> {label}
    </p>
  )
}
