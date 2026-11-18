// One post in the friends-only feed: text, maybe a Store game, and sticker reactions. No counts anywhere: only the
// author privately sees who reacted with what. No reshares or quotes.
import { useState } from 'react'
import { Flag, Gamepad2, SmilePlus, Trash2 } from 'lucide-react'
import type { Person, Post, ShowcaseApp } from '@/social/types'
import { QUICK_REACTIONS } from '@/social/stickers'
import { ago } from '@/social/format'
import { cn } from '@/lib/utils'
import { SocialAvatar } from './SocialAvatar'
import { StickerImg, StickerPicker } from './Stickers'

export interface PostActions {
  onReact?(post: Post, sticker: string): void
  onUnreact?(post: Post): void
  onDelete?(post: Post): void
  onReport?(post: Post): void
  onOpenApp?(app: ShowcaseApp): void
  onOpenPerson?(person: Person): void
}

export interface PostCardProps extends PostActions {
  post: Post
  meId: string | null | undefined
  className?: string
}

const iconBtn = 'grid size-11 place-items-center rounded-full text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg'

export function PostCard({ post, meId, onReact, onUnreact, onDelete, onReport, onOpenApp, onOpenPerson, className }: PostCardProps) {
  const [picking, setPicking] = useState(false)
  const [more, setMore] = useState(false)
  const mine = post.author.id === meId
  const react = (id: string) => {
    setPicking(false)
    setMore(false)
    if (post.myReaction === id) onUnreact?.(post)
    else onReact?.(post, id)
  }
  return (
    <article className={cn('rounded-2xl bg-shasta-home p-4 ring-1 ring-shasta-line', className)} aria-label={`Post by @${post.author.handle}`}>
      <header className="flex items-center gap-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpenPerson?.(post.author)} disabled={!onOpenPerson}>
          <SocialAvatar avatar={post.author.avatar} size={36} />
          <span className="min-w-0">
            <span className="block truncate font-medium">@{post.author.handle}</span>
            <span className="sh-meta">{ago(post.createdAt)}</span>
          </span>
        </button>
        {mine && onDelete && (
          <button type="button" className={iconBtn} onClick={() => onDelete(post)} aria-label="Delete this post">
            <Trash2 className="size-4" />
          </button>
        )}
        {!mine && onReport && (
          <button type="button" className={iconBtn} onClick={() => onReport(post)} aria-label="Report this post">
            <Flag className="size-4" />
          </button>
        )}
      </header>
      <p className="mt-2 whitespace-pre-wrap break-words">{post.text}</p>
      {post.app && (
        <button type="button" onClick={() => onOpenApp?.(post.app!)} className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-shasta-field px-3 text-sm sh-press">
          <Gamepad2 className="size-4 text-shasta-accent" aria-hidden />
          <span className="font-medium">{post.app.name}</span>
        </button>
      )}
      {mine && post.reactions && post.reactions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-shasta-muted" aria-label="Who reacted (only you see this)">
          {post.reactions.map((r) => (
            <span key={r.by.id} className="inline-flex items-center gap-1 rounded-full bg-shasta-field py-0.5 pl-0.5 pr-2">
              <SocialAvatar avatar={r.by.avatar} size={22} />
              <StickerImg id={r.sticker} size={18} />
              <span className="sr-only">@{r.by.handle}</span>
            </span>
          ))}
        </div>
      )}
      {!mine && onReact && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {post.myReaction && (
            <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm sh-selected" onClick={() => react(post.myReaction!)} aria-label="Remove your reaction">
              <StickerImg id={post.myReaction} size={22} /> You reacted
            </button>
          )}
          <button type="button" className={iconBtn} onClick={() => setPicking((v) => !v)} aria-expanded={picking} aria-label="React with a sticker">
            <SmilePlus className="size-5" />
          </button>
        </div>
      )}
      {picking && (
        <div className="mt-2 rounded-xl bg-shasta-field p-2">
          <StickerPicker onPick={react} selected={post.myReaction} only={more ? undefined : QUICK_REACTIONS} />
          {!more && (
            <button type="button" className="mt-1 min-h-11 px-2 text-sm text-shasta-accent" onClick={() => setMore(true)}>
              More stickers
            </button>
          )}
        </div>
      )}
    </article>
  )
}
