export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 19 9 5l3.5 6L15 8l6 11Z" />
      <path d="M5.5 15c2-1.5 3.5-1.5 5 0s3 1.5 4.5 0 2.5-1.2 4-.2" />
    </svg>
  )
}
