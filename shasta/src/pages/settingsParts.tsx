import type { ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function Row({ title, desc, children, htmlFor }: { title: string; desc?: string; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-shasta-line py-4 last:border-0">
      <div className="min-w-0 flex-1 basis-64">
        <label htmlFor={htmlFor} className="text-sm font-medium">{title}</label>
        {desc && <p className="mt-0.5 text-sm text-shasta-muted">{desc}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export function Toggle({ id, checked, onChange, label, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} className="data-checked:bg-shasta-accent" />
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-shasta-field p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-full px-3.5 py-1 text-sm transition-colors', value === o.value ? 'bg-shasta-accent text-shasta-accent-fg' : 'text-shasta-muted hover:text-shasta-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const selectCls = 'h-9 rounded-lg border border-shasta-line bg-shasta-field px-2.5 text-sm text-shasta-fg'

