// Sticker image + picker (social/stickers.ts: self-hosted Noto Emoji SVGs). Used for post reactions, guestbook notes
// and profile stickers.
import { STICKERS, stickerById } from '@/social/stickers'
import { cn } from '@/lib/utils'

export function StickerImg({ id, size = 28, className }: { id: string; size?: number; className?: string }) {
  const s = stickerById(id)
  if (!s) return null
  return <img src={s.src} alt={s.label} width={size} height={size} className={cn('inline-block select-none', className)} draggable={false} loading="lazy" />
}

export interface StickerPickerProps {
  onPick(id: string): void
  /** highlighted (e.g. my current reaction) */
  selected?: string | null
  /** limit to these ids */
  only?: readonly string[]
  className?: string
}

export function StickerPicker({ onPick, selected, only, className }: StickerPickerProps) {
  const list = only ? STICKERS.filter((s) => only.includes(s.id)) : STICKERS
  return (
    <div className={cn('grid grid-cols-6 gap-1 sm:grid-cols-8', className)} role="group" aria-label="Stickers">
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.id)}
          aria-label={s.label}
          aria-pressed={selected === s.id}
          className={cn('grid size-11 place-items-center rounded-xl sh-press hover:bg-shasta-hover', selected === s.id && 'sh-selected')}
        >
          <img src={s.src} alt="" width={30} height={30} draggable={false} loading="lazy" />
        </button>
      ))}
    </div>
  )
}
