import { useId } from 'react'

/**
 * The floating glass tile on the new tab page: a tilted rounded square with a dark mountain (Shasta with its
 * neighbour Shastina) set into it. Pure SVG gradients, no image asset.
 */
export function MountainTile({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const u = (n: string) => `${n}-${id}`
  return (
    <svg viewBox="0 0 180 160" className={className} aria-hidden>
      <defs>
        <linearGradient id={u('face')} x1="0.1" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#d6faff" />
          <stop offset="0.45" stopColor="#9bdcf7" />
          <stop offset="1" stopColor="#5b9ae8" />
        </linearGradient>
        <radialGradient id={u('shine')} cx="0.28" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={u('depth')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a62d6" />
          <stop offset="1" stopColor="#0c1a5e" />
        </linearGradient>
        <linearGradient id={u('rim')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8be9ff" />
          <stop offset="0.45" stopColor="#4c8dff" />
          <stop offset="0.75" stopColor="#a56bff" />
          <stop offset="1" stopColor="#ff9a5c" />
        </linearGradient>
        <linearGradient id={u('peak')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a5cc4" />
          <stop offset="1" stopColor="#1b2780" />
        </linearGradient>
        <filter id={u('glow')} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={u('soft')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
        <clipPath id={u('clip')}>
          <rect x="30" y="22" width="120" height="98" rx="34" />
        </clipPath>
      </defs>
      <g transform="rotate(-11 90 80)">
        <rect x="26" y="28" width="128" height="104" rx="38" fill="#5aa8ff" opacity="0.55" filter={`url(#${u('glow')})`} />
        {/* thickness: the same shape pushed down, darker */}
        <rect x="28" y="32" width="124" height="100" rx="36" fill={`url(#${u('depth')})`} />
        <rect x="28" y="30" width="124" height="100" rx="36" fill="none" stroke={`url(#${u('rim')})`} strokeWidth="3" opacity="0.9" />
        {/* front face */}
        <rect x="30" y="22" width="120" height="98" rx="34" fill={`url(#${u('face')})`} />
        <rect x="30" y="22" width="120" height="98" rx="34" fill={`url(#${u('shine')})`} />
        <rect x="31" y="23" width="118" height="96" rx="33" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.5" />
        <g clipPath={`url(#${u('clip')})`}>
          <ellipse cx="150" cy="112" rx="30" ry="22" fill="#ffb27a" opacity="0.28" filter={`url(#${u('soft')})`} />
          <ellipse cx="36" cy="118" rx="26" ry="14" fill="#7f6bff" opacity="0.25" filter={`url(#${u('soft')})`} />
        </g>
        {/* Mount Shasta and Shastina */}
        <g strokeLinejoin="round" strokeLinecap="round">
          <path
            d="M50 94 L67 66 L72 65 L82 77 L89 53 L92 47 L95 53 L120 94 Z"
            fill={`url(#${u('peak')})`}
            stroke={`url(#${u('peak')})`}
            strokeWidth="7"
          />
          <path d="M85.6 61 L92 47 L98.4 61 L94.6 58.2 L92 62.4 L89.4 58.2 Z" fill="#e4eeff" stroke="#e4eeff" strokeWidth="2" opacity="0.95" />
          <path d="M63.5 70.5 L68.5 64 L73.5 70.5 L70.2 68.8 L68.5 71.2 L66.8 68.8 Z" fill="#c9d9ff" stroke="#c9d9ff" strokeWidth="1.4" opacity="0.9" />
        </g>
      </g>
    </svg>
  )
}
