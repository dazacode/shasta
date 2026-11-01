import type { ReactNode } from 'react'

export function PageShell({ title, subtitle, actions, wide, children }: { title: string; subtitle?: string; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`mx-auto w-full px-8 pt-10 pb-16 text-shasta-fg ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="sh-title">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-shasta-muted tabular-nums">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-shasta-line bg-shasta-home/40 px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-shasta-field text-shasta-faint [&_svg]:size-5">{icon}</div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-shasta-muted">{body}</p>
    </div>
  )
}
