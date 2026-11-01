import type { ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** `stack`: the control goes under the words at full width (pickers, swatches, text fields) instead of beside them. */
export function Row({ title, desc, children, htmlFor, stack = false }: { title: string; desc?: string; children?: ReactNode; htmlFor?: string; stack?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-shasta-line py-4 last:border-0">
      <div className="min-w-0 flex-1 basis-64">
        <label htmlFor={htmlFor} className="text-sm font-medium">{title}</label>
        {desc && <p className="mt-0.5 text-sm text-shasta-muted">{desc}</p>}
      </div>
      {children && <div className={cn('flex min-w-0 max-w-full items-center gap-2', stack ? 'basis-full' : 'shrink-0')}>{children}</div>}
    </div>
  )
}

export function Toggle({ id, checked, onChange, label, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} className="data-checked:bg-shasta-accent" />
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit max-w-full rounded-[10px] bg-shasta-field p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-lg px-3 text-sm transition-[color,background-color,box-shadow] duration-150 ease-shasta', value === o.value ? 'sh-selected' : 'text-shasta-muted hover:text-shasta-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const selectCls = 'h-9 rounded-lg border border-shasta-line bg-shasta-field px-2.5 text-sm text-shasta-fg'

