import type { CSSProperties, ReactNode } from 'react'
import type { CursorKind } from '../cursor'
import './Segmented.css'

/**
 * A segmented control: equal segments, one raised thumb that slides to the
 * chosen one. `targets` names each segment for the cursor; `cursor` is the
 * pointer it shows over them (hand, pointer).
 */
export function Segmented({ items, value, targets, cursor, className, style, ...rest }: { items: ReactNode[]; value: number; targets?: (string | undefined)[]; cursor?: CursorKind; className?: string; style?: CSSProperties } & Record<`data-${string}`, unknown>) {
  return (
    <div {...rest} className={`sk-seg${className ? ` ${className}` : ''}`} style={{ ['--n' as string]: items.length, ...style }}>
      <span className="sk-seg__thumb" style={{ transform: `translateX(${value * 100}%)` }} />
      {items.map((o, i) => (
        <span key={i} className="sk-seg__option" data-on={i === value || undefined} data-target={targets?.[i]} data-cursor={cursor}>
          {o}
        </span>
      ))}
    </div>
  )
}
