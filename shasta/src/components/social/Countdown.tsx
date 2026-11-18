// A small ring that empties until a code runs out (friend codes, link codes), with the seconds left for screen readers.
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** Re-renders every `ms` and returns Date.now(). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function CountdownRing({ expiresAt, total, size = 28, className }: { expiresAt: number; total: number; size?: number; className?: string }) {
  const now = useNow(250)
  const left = Math.max(0, expiresAt - now)
  const f = total > 0 ? left / total : 0
  const r = 10
  const c = 2 * Math.PI * r
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-shasta-muted', className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="-rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--sh-line)" strokeWidth="3" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--sh-accent)" strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - f)} strokeLinecap="round" />
      </svg>
      <span aria-live="off">{Math.ceil(left / 1000)} s</span>
    </span>
  )
}
