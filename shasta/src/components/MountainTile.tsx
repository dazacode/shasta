/**
 * The logo tile on the new tab page: Mount Shasta with its neighbour Shastina, moonlit, on a flat ink tile.
 * One neutral in two tones (rock and snow), a hairline edge, no gloss or glow: the night scene around it carries the colour.
 */
export function MountainTile({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 160" className={className} aria-hidden>
      <rect x="30" y="20" width="120" height="120" rx="32" fill="#141823" />
      <rect x="30.5" y="20.5" width="119" height="119" rx="31.5" fill="none" stroke="#eef0f5" strokeOpacity="0.12" />
      <g strokeLinejoin="round" strokeLinecap="round">
        <path d="M50 110 L67 82 L72 81 L82 93 L89 69 L92 63 L95 69 L130 110 Z" fill="#8f99b0" stroke="#8f99b0" strokeWidth="6" />
        <path d="M85.6 77 L92 63 L98.4 77 L94.6 74.2 L92 78.4 L89.4 74.2 Z" fill="#eef0f5" stroke="#eef0f5" strokeWidth="2" />
        <path d="M63.5 86.5 L68.5 80 L73.5 86.5 L70.2 84.8 L68.5 87.2 L66.8 84.8 Z" fill="#eef0f5" stroke="#eef0f5" strokeWidth="1.4" />
      </g>
    </svg>
  )
}
