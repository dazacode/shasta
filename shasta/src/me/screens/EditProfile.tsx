// The profile editor: avatar, mood, status, about, the look (palette presets or your own four colours with a live
// contrast check, font, background), which blocks show and in what order, your crew (up to 8 friends, never a
// ranking), the showcase (up to 12 games from your library) and stickers. A live preview sits on top. Everything is
// the validated theme schema; the server checks it all again (themes.ts contrastOk is the same rule).
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCw, Trash2 } from 'lucide-react'
import type { Block, Mood, PlacedSticker, Profile, ProfileEdit, Theme } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialKeys, useProfile } from '@/social/queries'
import { useSocial } from '@/social/store'
import { MOODS, MOOD_IDS } from '@/social/format'
import { LIMITS } from '@/social/schemas'
import { BACKGROUNDS, FONTS, FONT_IDS, PALETTES, contrastOk, contrastRatio, themeProblems, DEFAULT_THEME } from '@/social/themes'
import { ProfileView } from '@/components/social/ProfileView'
import { StickerImg, StickerPicker } from '@/components/social/Stickers'
import { SocialAvatar } from '@/components/social/SocialAvatar'
import { cn } from '@/lib/utils'
import { usePhoneLibrary } from '../library'
import { useNav } from '../nav'
import { BigButton, Note, Screen, Spinner } from '../ui'
import { AvatarPicker } from './Onboarding'

const ALL_BLOCKS: { id: Block; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'playing', label: 'Playing now' },
  { id: 'crew', label: 'Crew' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'guestbook', label: 'Guestbook' },
  { id: 'posts', label: 'Posts' },
]
const MAX_CREW = 8
const MAX_SHOWCASE = 12
const MAX_STICKERS = 12

const toEdit = (p: Profile): ProfileEdit => ({
  avatar: p.avatar,
  mood: p.mood,
  status: p.status,
  about: p.about,
  theme: p.theme ?? DEFAULT_THEME,
  blocks: p.blocks,
  crew: p.crew.map((c) => c.id),
  showcase: p.showcase.map((a) => a.appId),
  stickers: p.stickers,
})

export function EditProfileScreen() {
  const me = useSocial((s) => s.me)
  const profile = useProfile(me?.handle ?? null)
  return (
    <Screen title="Edit profile">
      {profile.data ? <Editor profile={profile.data} /> : profile.isError ? <p className="text-shasta-danger">{errorText(profile.error)}</p> : <Spinner label="Loading…" />}
    </Screen>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-medium">{label}</h2>
      {children}
      {hint && <p className="mt-1.5 text-sm text-shasta-faint">{hint}</p>}
    </section>
  )
}

const chip = (on: boolean) => cn('min-h-11 rounded-xl px-3 text-sm', on ? 'sh-selected' : 'bg-shasta-field text-shasta-muted')

function Editor({ profile }: { profile: Profile }) {
  const friends = useSocial((s) => s.friends)
  const library = usePhoneLibrary()
  const back = useNav((s) => s.back)
  const qc = useQueryClient()
  const [edit, setEdit] = useState<ProfileEdit>(() => toEdit(profile))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const set = (patch: Partial<ProfileEdit>) => setEdit((e) => ({ ...e, ...patch }))
  const setTheme = (patch: Partial<Theme>) => setEdit((e) => ({ ...e, theme: { ...e.theme, ...patch } }))

  const problems = themeProblems(edit.theme)
  const blocking = !contrastOk(edit.theme.text, edit.theme.bg) || !contrastOk(edit.theme.text, edit.theme.surface)
  const apps = useMemo(() => library.data ?? [], [library.data])

  // the preview: the profile as it will look (crew and showcase looked up locally)
  const preview: Profile = useMemo(
    () => ({
      ...profile,
      avatar: edit.avatar,
      mood: edit.mood,
      status: edit.status,
      about: edit.about,
      theme: edit.theme,
      blocks: edit.blocks,
      crew: friends.filter((f) => edit.crew.includes(f.id)),
      showcase: edit.showcase.map((id) => apps.find((a) => a.appId === id) ?? profile.showcase.find((a) => a.appId === id)).filter((a): a is NonNullable<typeof a> => !!a),
      stickers: edit.stickers,
    }),
    [profile, edit, friends, apps],
  )

  const moveBlock = (i: number, d: -1 | 1) => {
    const b = [...edit.blocks]
    const j = i + d
    if (j < 0 || j >= b.length) return
    ;[b[i], b[j]] = [b[j], b[i]]
    set({ blocks: b })
  }
  const toggleBlock = (id: Block) => set({ blocks: edit.blocks.includes(id) ? edit.blocks.filter((x) => x !== id) : [...edit.blocks, id] })
  const toggleIn = (key: 'crew' | 'showcase', id: string, max: number) => {
    const list = edit[key]
    set({ [key]: list.includes(id) ? list.filter((x) => x !== id) : list.length >= max ? list : [...list, id] } as Partial<ProfileEdit>)
  }
  const nudgeSticker = (i: number, dx: number, dy: number, dr = 0) =>
    set({
      stickers: edit.stickers.map((s, k) => (k === i ? { ...s, x: Math.min(1, Math.max(0, s.x + dx)), y: Math.min(1, Math.max(0, s.y + dy)), r: ((s.r + dr + 30 + 61) % 61) - 30 } : s)),
    })

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const saved = await social.saveProfile({ ...edit, status: edit.status?.trim() || null, about: edit.about.trim() })
      qc.setQueryData(socialKeys.profile(saved.handle), saved)
      back()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="-mx-4 mb-6 max-h-80 overflow-y-auto border-y border-shasta-line" aria-label="Preview">
        <ProfileView profile={preview} className="pointer-events-none" />
      </div>

      <Field label="Avatar">
        <AvatarPicker value={edit.avatar} onChange={(avatar) => set({ avatar })} />
      </Field>

      <Field label="Mood">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Mood">
          <button type="button" className={chip(edit.mood === null)} aria-pressed={edit.mood === null} onClick={() => set({ mood: null })}>
            None
          </button>
          {MOOD_IDS.map((m: Mood) => (
            <button key={m} type="button" className={chip(edit.mood === m)} aria-pressed={edit.mood === m} onClick={() => set({ mood: m })}>
              {MOODS[m]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Status" hint={`${LIMITS.status - (edit.status?.length ?? 0)} left. Don't put your school, address or phone number here.`}>
        <input value={edit.status ?? ''} onChange={(e) => set({ status: e.target.value.slice(0, LIMITS.status) })} placeholder="What's up?" className="h-12 w-full rounded-2xl bg-shasta-field px-4 text-base outline-none" aria-label="Status" />
      </Field>

      <Field label="About" hint={`${LIMITS.about - edit.about.length} left`}>
        <textarea value={edit.about} onChange={(e) => set({ about: e.target.value.slice(0, LIMITS.about) })} rows={3} className="w-full rounded-2xl bg-shasta-field p-4 text-base outline-none" aria-label="About" />
      </Field>

      <Field label="Colours">
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Colour presets">
          {PALETTES.map((p) => {
            const on = (['bg', 'surface', 'text', 'accent'] as const).every((k) => edit.theme[k].toLowerCase() === p.colors[k])
            return (
              <button key={p.id} type="button" onClick={() => setTheme(p.colors)} aria-pressed={on} aria-label={p.name} className={cn('grid gap-1 rounded-xl p-1.5 text-xs', on ? 'sh-selected' : 'bg-shasta-field')}>
                <span className="grid h-10 grid-cols-2 overflow-hidden rounded-lg ring-1 ring-black/10" aria-hidden>
                  <span style={{ background: p.colors.bg }} />
                  <span className="grid place-items-center text-[11px] font-semibold" style={{ background: p.colors.surface, color: p.colors.text }}>
                    Aa
                  </span>
                </span>
                {p.name}
              </button>
            )
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(
            [
              ['bg', 'Background'],
              ['surface', 'Cards'],
              ['text', 'Text'],
              ['accent', 'Accent'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex min-h-12 items-center gap-3 rounded-xl bg-shasta-field px-3">
              <input type="color" value={edit.theme[k]} onChange={(e) => setTheme({ [k]: e.target.value } as Partial<Theme>)} className="size-8 cursor-pointer rounded border-0 bg-transparent p-0" />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
        <p className={cn('mt-2 text-sm', blocking ? 'text-shasta-danger' : 'text-shasta-faint')} aria-live="polite">
          {problems.length ? problems.join(' ') : `Easy to read (contrast ${contrastRatio(edit.theme.text, edit.theme.bg).toFixed(1)} to 1).`}
        </p>
      </Field>

      <Field label="Font">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Font">
          {FONT_IDS.map((f) => (
            <button key={f} type="button" className={chip(edit.theme.font === f)} aria-pressed={edit.theme.font === f} onClick={() => setTheme({ font: f })} style={{ fontFamily: FONTS[f].stack, ...FONTS[f].style }}>
              {FONTS[f].label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Background">
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Background pattern">
          {BACKGROUNDS.map((b) => (
            <button key={b.id} type="button" onClick={() => setTheme({ background: b.id })} aria-pressed={edit.theme.background === b.id} className={cn('grid gap-1 rounded-xl p-1.5 text-xs', edit.theme.background === b.id ? 'sh-selected' : 'bg-shasta-field')}>
              <span className="h-10 rounded-lg ring-1 ring-black/10" style={{ background: b.css(edit.theme) }} aria-hidden />
              {b.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="What's on your page" hint="Tick what shows, and move it up or down.">
        <ul className="divide-y divide-shasta-line rounded-2xl bg-shasta-home ring-1 ring-shasta-line">
          {[...edit.blocks, ...ALL_BLOCKS.map((b) => b.id).filter((id) => !edit.blocks.includes(id))].map((id) => {
            const on = edit.blocks.includes(id)
            const i = edit.blocks.indexOf(id)
            const label = ALL_BLOCKS.find((b) => b.id === id)!.label
            return (
              <li key={id} className="flex min-h-14 items-center gap-2 px-3">
                <label className="flex min-h-11 flex-1 items-center gap-3">
                  <input type="checkbox" checked={on} onChange={() => toggleBlock(id)} className="size-5 accent-[var(--sh-accent)]" />
                  <span className={on ? '' : 'text-shasta-faint'}>{label}</span>
                </label>
                {on && (
                  <>
                    <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-shasta-hover disabled:opacity-30" disabled={i === 0} onClick={() => moveBlock(i, -1)} aria-label={`Move ${label} up`}>
                      <ArrowUp className="size-5" />
                    </button>
                    <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-shasta-hover disabled:opacity-30" disabled={i === edit.blocks.length - 1} onClick={() => moveBlock(i, 1)} aria-label={`Move ${label} down`}>
                      <ArrowDown className="size-5" />
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </Field>

      <Field label={`Crew (${edit.crew.length} of ${MAX_CREW})`} hint="A few friends you'd like on your page. It's not a ranking: they're shown in a new random order every time.">
        {friends.length ? (
          <div className="grid grid-cols-4 gap-2">
            {friends.map((f) => {
              const on = edit.crew.includes(f.id)
              return (
                <button key={f.id} type="button" onClick={() => toggleIn('crew', f.id, MAX_CREW)} aria-pressed={on} className={cn('grid justify-items-center gap-1 rounded-xl p-2 text-xs', on ? 'sh-selected' : 'bg-shasta-field', !on && edit.crew.length >= MAX_CREW && 'opacity-40')}>
                  <SocialAvatar avatar={f.avatar} size={44} />
                  <span className="w-full truncate">@{f.handle}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-shasta-muted">Add friends first; then you can pick some here.</p>
        )}
      </Field>

      <Field label={`Showcase (${edit.showcase.length} of ${MAX_SHOWCASE})`} hint="Games and apps from your library. Only their names and icons show, never how long you played.">
        {library.isPending ? (
          <Spinner label="Loading your library…" />
        ) : apps.length ? (
          <div className="grid grid-cols-3 gap-2">
            {apps.map((a) => {
              const on = edit.showcase.includes(a.appId)
              return (
                <button key={a.appId} type="button" onClick={() => toggleIn('showcase', a.appId, MAX_SHOWCASE)} aria-pressed={on} className={cn('grid justify-items-center gap-1 rounded-xl p-2 text-xs', on ? 'sh-selected' : 'bg-shasta-field', !on && edit.showcase.length >= MAX_SHOWCASE && 'opacity-40')}>
                  {a.iconUrl ? <img src={a.iconUrl} alt="" className="size-12 rounded-xl object-cover" /> : <span className="size-12 rounded-xl bg-shasta-hover" />}
                  <span className="line-clamp-2 text-center">{a.name}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-shasta-muted">Your library on this phone is empty. Games you install in Shasta on your Chromebook come over when you link it.</p>
        )}
      </Field>

      <Field label={`Stickers (${edit.stickers.length} of ${MAX_STICKERS})`} hint="Tap a sticker to add it, tap one on the board to move, turn or remove it.">
        <div className="relative mb-3 aspect-[16/9] w-full overflow-hidden rounded-xl ring-1 ring-shasta-line" style={{ background: edit.theme.bg }}>
          {edit.stickers.map((s: PlacedSticker, i) => (
            <button
              key={`${s.id}-${i}`}
              type="button"
              onClick={() => setSelected(selected === i ? null : i)}
              aria-label={`Sticker ${i + 1}`}
              aria-pressed={selected === i}
              className={cn('absolute rounded-lg', selected === i && 'ring-2 ring-shasta-accent')}
              style={{ left: `${s.x * 88}%`, top: `${s.y * 80}%`, transform: `rotate(${s.r}deg)` }}
            >
              <StickerImg id={s.id} size={40} />
            </button>
          ))}
        </div>
        {selected !== null && edit.stickers[selected] && (
          <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Move the selected sticker">
            {[
              [<ArrowLeft key="l" />, 'Left', -0.06, 0, 0],
              [<ArrowRight key="r" />, 'Right', 0.06, 0, 0],
              [<ArrowUp key="u" />, 'Up', 0, -0.08, 0],
              [<ArrowDown key="d" />, 'Down', 0, 0.08, 0],
              [<RotateCw key="t" />, 'Turn', 0, 0, 10],
            ].map(([icon, label, dx, dy, dr]) => (
              <button key={label as string} type="button" className="grid size-11 place-items-center rounded-xl bg-shasta-field [&_svg]:size-5" aria-label={label as string} onClick={() => nudgeSticker(selected, dx as number, dy as number, dr as number)}>
                {icon}
              </button>
            ))}
            <button
              type="button"
              className="grid size-11 place-items-center rounded-xl bg-shasta-field text-shasta-danger"
              aria-label="Remove"
              onClick={() => {
                set({ stickers: edit.stickers.filter((_, k) => k !== selected) })
                setSelected(null)
              }}
            >
              <Trash2 className="size-5" />
            </button>
          </div>
        )}
        {edit.stickers.length < MAX_STICKERS && (
          <StickerPicker
            onPick={(id) => {
              const n = edit.stickers.length
              set({ stickers: [...edit.stickers, { id, x: ((n * 0.37) % 1) * 0.9 + 0.05, y: ((n * 0.53) % 1) * 0.8 + 0.1, r: ((n * 13) % 41) - 20 }] })
              setSelected(n)
            }}
          />
        )}
      </Field>

      {blocking && <Note tone="warn" className="mb-3">Pick colours that are easier to read before saving.</Note>}
      {error && (
        <p className="mb-3 text-sm text-shasta-danger" role="alert">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 border-t border-shasta-line bg-shasta-bg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <BigButton onClick={() => void save()} disabled={busy || blocking}>
          {busy ? 'Saving…' : 'Save'}
        </BigButton>
      </div>
    </div>
  )
}
