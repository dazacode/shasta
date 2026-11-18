// The friends-only feed: newest first, a button for older posts (never infinite scroll), and a clear end:
// "You're all caught up". Plus the composer that sits on top of it.
import { useState, type ReactNode } from 'react'
import type { Post } from '@/social/types'
import { LIMITS, postSchema, firstError } from '@/social/schemas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PostCard, type PostActions } from './PostCard'

export interface FeedProps extends PostActions {
  posts: Post[]
  meId: string | null | undefined
  caughtUp: boolean
  loading?: boolean
  loadingMore?: boolean
  error?: string | null
  onLoadMore?(): void
  /** above the posts (the composer) */
  header?: ReactNode
  className?: string
}

export function Feed({ posts, meId, caughtUp, loading, loadingMore, error, onLoadMore, header, className, ...actions }: FeedProps) {
  return (
    <section className={cn('grid gap-3', className)} aria-label="Posts from you and your friends">
      {header}
      {loading && !posts.length && <p className="py-6 text-center text-sm text-shasta-muted">Loading posts…</p>}
      {error && <p className="rounded-xl bg-shasta-field p-3 text-sm" role="alert">{error}</p>}
      {!loading && !posts.length && !error && <p className="py-6 text-center text-sm text-shasta-muted">No posts yet. When you or your friends post, it shows up here.</p>}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} meId={meId} {...actions} />
      ))}
      {posts.length > 0 &&
        (caughtUp || !onLoadMore ? (
          <p className="py-6 text-center text-sm text-shasta-muted">You're all caught up</p>
        ) : (
          <Button busy={loadingMore} variant="outline" className="h-11 justify-self-center px-5" onClick={onLoadMore} disabled={loadingMore}>
            Show older posts
          </Button>
        ))}
    </section>
  )
}

export interface PostComposerProps {
  /** resolves when posted; throws (with a readable message) when not */
  onPost(text: string): Promise<void>
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function PostComposer({ onPost, disabled, placeholder = 'Share something with your friends', className }: PostComposerProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const left = LIMITS.post - text.length
  const submit = async () => {
    const r = postSchema.safeParse(text)
    const problem = firstError(r)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await onPost(r.data!)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className={cn('rounded-2xl bg-shasta-home p-3 ring-1 ring-shasta-line', className)}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="sr-only" htmlFor="post-text">New post</label>
      <textarea
        id="post-text"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, LIMITS.post + 20))}
        placeholder={placeholder}
        rows={2}
        disabled={disabled || busy}
        className="w-full resize-none bg-transparent p-1 text-base outline-none placeholder:text-shasta-faint"
      />
      <div className="mt-1 flex items-center gap-2">
        <span className={cn('sh-meta', left < 0 && 'text-shasta-danger')} aria-live="polite">{left < 40 ? `${left} left` : ''}</span>
        <span className="flex-1 text-sm text-shasta-danger" role="alert">{error}</span>
        <Button busy={busy} type="submit" className="h-11 px-5" disabled={disabled || busy || !text.trim() || left < 0}>
          Post
        </Button>
      </div>
      <p className="mt-1 text-xs text-shasta-faint">Only your friends see posts. Links work only for Shasta Store games.</p>
    </form>
  )
}
