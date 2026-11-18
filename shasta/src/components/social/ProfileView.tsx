// A profile as friends see it: the person's own look (social/themes.ts: four checked colours, one of six fonts, a
// curated CSS background) and their blocks in the order they chose. It renders the validated schema only, never
// custom CSS or HTML. Friends and self only (the server answers 404 to anyone else).
import { useState, type ReactNode } from 'react'
import type { GuestbookNote, Person, Post, Profile, ShowcaseApp } from '@/social/types'
import { MOODS } from '@/social/format'
import { themeStyle, onAccent } from '@/social/themes'
import { LIMITS } from '@/social/schemas'
import { cn } from '@/lib/utils'
import { SocialAvatar } from './SocialAvatar'
import { PresenceLine } from './FriendRow'
import { ShowcaseShelf } from './ShowcaseShelf'
import { GuestbookList } from './GuestbookList'
import { StickerImg, StickerPicker } from './Stickers'
import { PostCard, type PostActions } from './PostCard'

export interface ProfileViewProps extends PostActions {
  profile: Profile
  meId?: string | null
  guestbook?: GuestbookNote[]
  posts?: Post[]
  onOpenPerson?(p: Person): void
  onOpenApp?(app: ShowcaseApp): void
  /** leave a note (friends viewing, when the owner allows it) */
  onSignGuestbook?(note: { text?: string; sticker?: string }): Promise<void>
  onApproveNote?(n: GuestbookNote): void
  onDeleteNote?(n: GuestbookNote): void
  /** buttons under the name (Message, Edit, ...) */
  actions?: ReactNode
  className?: string
}

const card = 'rounded-2xl bg-[var(--p-surface)] p-4 ring-1 ring-[var(--p-line)]'

export function ProfileView(props: ProfileViewProps) {
  const { profile: p, meId, guestbook, posts, onOpenPerson, onOpenApp, onSignGuestbook, onApproveNote, onDeleteNote, actions, className } = props
  const self = p.friend === 'self'
  const blocks = p.blocks.filter((b, i) => p.blocks.indexOf(b) === i)

  const render = (b: (typeof blocks)[number]): ReactNode => {
    switch (b) {
      case 'about':
        return p.about ? (
          <Section key={b} title="About">
            <p className="whitespace-pre-wrap break-words">{p.about}</p>
          </Section>
        ) : null
      case 'playing':
        return p.playing ? (
          <Section key={b} title="Playing now">
            <PresenceLine presence={p.playing} className="text-[var(--p-accent)]" />
          </Section>
        ) : null
      case 'crew':
        return p.crew.length ? (
          <Section key={b} title="Crew">
            <ul className="grid grid-cols-4 gap-2">
              {p.crew.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full flex-col items-center gap-1 rounded-xl p-1 text-xs hover:bg-[var(--p-line)]" onClick={() => onOpenPerson?.(c)} disabled={!onOpenPerson}>
                    <SocialAvatar avatar={c.avatar} size={48} />
                    <span className="w-full truncate text-center">@{c.handle}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null
      case 'showcase':
        return (
          <Section key={b} title="Showcase">
            <ShowcaseShelf apps={p.showcase} onOpen={onOpenApp} emptyText={self ? 'Pick games from your library to show here.' : 'Nothing on the shelf yet.'} />
          </Section>
        )
      case 'stickers':
        return p.stickers.length ? (
          <Section key={b} title="Stickers">
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-[var(--p-bg)]" role="img" aria-label={`${p.stickers.length} stickers`}>
              {p.stickers.map((s, i) => (
                <span key={`${s.id}-${i}`} className="absolute" style={{ left: `${Math.min(1, Math.max(0, s.x)) * 88}%`, top: `${Math.min(1, Math.max(0, s.y)) * 80}%`, transform: `rotate(${Math.max(-30, Math.min(30, s.r))}deg)` }}>
                  <StickerImg id={s.id} size={44} />
                </span>
              ))}
            </div>
          </Section>
        ) : null
      case 'guestbook':
        return guestbook ? (
          <Section key={b} title="Guestbook">
            {onSignGuestbook && !self && <SignGuestbook onSign={onSignGuestbook} accent={p.theme.accent} />}
            <GuestbookList notes={guestbook} ownerView={self} meId={meId} onApprove={onApproveNote} onDelete={onDeleteNote} className={onSignGuestbook && !self ? 'mt-3' : ''} />
          </Section>
        ) : null
      case 'posts':
        return posts?.length ? (
          <Section key={b} title="Posts">
            <div className="grid gap-2 text-shasta-fg">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} meId={meId} onReact={props.onReact} onUnreact={props.onUnreact} onDelete={props.onDelete} onReport={props.onReport} onOpenApp={onOpenApp} onOpenPerson={onOpenPerson} />
              ))}
            </div>
          </Section>
        ) : null
    }
  }

  return (
    <div className={cn('min-h-full px-4 pb-8 pt-6', className)} style={themeStyle(p.theme)}>
      <header className="flex flex-col items-center text-center">
        <SocialAvatar avatar={p.avatar} size={104} className="ring-4 ring-[var(--p-surface)]" />
        <h1 className="mt-3 text-2xl font-semibold">@{p.handle}</h1>
        {p.mood && <p className="text-sm text-[var(--p-muted)]">Feeling {MOODS[p.mood].toLowerCase()}</p>}
        {p.status && <p className="mt-1 max-w-sm break-words">{p.status}</p>}
        {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
      </header>
      <div className="mx-auto mt-6 grid max-w-xl gap-3">{blocks.map(render)}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={card} aria-label={title}>
      <h2 className="mb-2 text-sm font-medium text-[var(--p-muted)]">{title}</h2>
      {children}
    </section>
  )
}

function SignGuestbook({ onSign, accent }: { onSign(note: { text?: string; sticker?: string }): Promise<void>; accent: string }) {
  const [text, setText] = useState('')
  const [sticker, setSticker] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await onSign({ text: text.trim() || undefined, sticker: sticker ?? undefined })
      setText('')
      setSticker(null)
      setMsg('Sent. It shows up once they approve it.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not leave the note.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="grid gap-2"
    >
      <label className="sr-only" htmlFor="gb-text">Leave a note</label>
      <div className="flex items-center gap-2">
        <input id="gb-text" value={text} onChange={(e) => setText(e.target.value.slice(0, LIMITS.note))} placeholder="Leave a note" className="h-11 min-w-0 flex-1 rounded-xl bg-[var(--p-bg)] px-3 text-base text-[var(--p-text)] outline-none ring-1 ring-[var(--p-line)]" />
        <button type="button" className="grid size-11 place-items-center rounded-xl ring-1 ring-[var(--p-line)]" onClick={() => setPicking((v) => !v)} aria-expanded={picking} aria-label={sticker ? 'Change sticker' : 'Add a sticker'}>
          {sticker ? <StickerImg id={sticker} size={26} /> : <span aria-hidden className="text-lg leading-none">+</span>}
        </button>
        <button type="submit" disabled={busy || (!text.trim() && !sticker)} className="h-11 rounded-xl px-4 font-medium disabled:opacity-50" style={{ background: accent, color: onAccent(accent) }}>
          Sign
        </button>
      </div>
      {picking && (
        <StickerPicker
          className="rounded-xl bg-[var(--p-bg)] p-1 text-[var(--p-text)]"
          selected={sticker}
          onPick={(id) => {
            setSticker(id === sticker ? null : id)
            setPicking(false)
          }}
        />
      )}
      {msg && <p className="text-sm text-[var(--p-muted)]" role="status">{msg}</p>}
    </form>
  )
}
