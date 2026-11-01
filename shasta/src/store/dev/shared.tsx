import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/uiStore'
import { errorMessage } from '../api'

export const ok = (m: string) => useUi.getState().toast(m, { tone: 'success' })
export const fail = (e: unknown) => useUi.getState().toast(errorMessage(e), { tone: 'error' })

export function Card({ title, subtitle, children, className, id }: { title?: string; subtitle?: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('rounded-2xl bg-shasta-home p-5 ring-1 ring-shasta-line', className)} aria-label={title}>
      {title && (
        <header className="mb-4">
          <h2 className="text-base font-medium">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-shasta-muted">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, children, counter }: { label: string; hint?: string; children: ReactNode; counter?: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        {counter && <span className="text-xs text-shasta-muted tabular-nums">{counter}</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-shasta-muted">{hint}</span>}
    </label>
  )
}

export const textareaClass =
  'min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'
export const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:text-black'

export function ProblemList({ title, items, tone = 'error' }: { title: string; items: string[]; tone?: 'error' | 'warn' }) {
  if (!items.length) return null
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-xl p-3 text-sm', tone === 'error' ? 'bg-shasta-danger/10 text-shasta-danger' : 'bg-shasta-warn/10 text-shasta-warn')}>
      <p className="mb-1 font-medium">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {items.map((p, i) => (
          <li key={i} className="break-words">{p}</li>
        ))}
      </ul>
    </div>
  )
}
