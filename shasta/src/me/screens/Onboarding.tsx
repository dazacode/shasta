// Making an account on this phone: a neutral age question, then a handle and an avatar. No email, phone number,
// password or real name. Under 13 gets a kind "13 and up" screen, remembered on this device so it never asks again
// (Shasta itself still works). Only the age band is ever stored, by the server; the number is not kept here either.
import { useMemo, useState } from 'react'
import { Shuffle } from 'lucide-react'
import type { Avatar, Me } from '@/social/types'
import { ApiError, errorText, social } from '@/social/api'
import { authClient, defaultDeviceName } from '@/social/auth'
import { AVATAR_BGS, AVATAR_STYLES, AVATAR_STYLE_LABELS, parsePreset, randomAvatar, type AvatarStyle } from '@/social/avatars'
import { ageSchema, firstError, handleProblem } from '@/social/schemas'
import { useSocial } from '@/social/store'
import { SocialAvatar } from '@/components/social/SocialAvatar'
import { cn } from '@/lib/utils'
import { BigButton, Note, Spinner } from '../ui'

export const YOUNG_KEY = 'shasta-social-young'
export function readYoung(): boolean {
  try {
    return localStorage.getItem(YOUNG_KEY) === '1'
  } catch {
    return false
  }
}
function rememberYoung() {
  try {
    localStorage.setItem(YOUNG_KEY, '1')
  } catch {
    /* storage blocked: the server refuses anyway */
  }
}

function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('me-safe-top me-safe-bottom me-safe-x mx-auto flex min-h-dvh max-w-md flex-col justify-center py-8', className)}>{children}</div>
}

export function Splash() {
  return (
    <Page>
      <Spinner label="Opening Shasta…" />
    </Page>
  )
}

export function Young() {
  return (
    <Page>
      <h1 className="text-2xl font-semibold">Shasta's social features are for 13 and up</h1>
      <p className="mt-3 text-shasta-muted">That's the rule for accounts, friends and messages. Everything else in Shasta works the same, on any computer, with no account at all.</p>
      <a href="/" className="mt-8 inline-flex min-h-12 items-center justify-center rounded-2xl bg-shasta-accent px-5 font-medium text-shasta-accent-fg">
        Go to Shasta
      </a>
    </Page>
  )
}

export function Unavailable() {
  return (
    <Page>
      <h1 className="text-2xl font-semibold">This needs the full Shasta site</h1>
      <p className="mt-3 text-shasta-muted">Accounts, friends and messages only work on Shasta's own address, not on a copy hosted somewhere else.</p>
    </Page>
  )
}

export function Suspended() {
  const until = useSocial((s) => s.suspendedUntil)
  return (
    <Page>
      <h1 className="text-2xl font-semibold">Your account is paused</h1>
      <p className="mt-3 text-shasta-muted">
        Shasta's staff paused it because something broke the rules{until ? `, until ${new Date(until).toLocaleString()}` : ''}. Friends and messages come back after that. Shasta itself still works.
      </p>
    </Page>
  )
}

/** Signed out, no scanned code: make an account, or come back with a passkey / recovery code. */
export function Welcome({ notice, onCreated, onYoung }: { notice?: string; onCreated(me: Me): void; onYoung(): void }) {
  const [mode, setMode] = useState<'start' | 'make' | 'recover'>('start')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (mode === 'make') return <Onboarding onCreated={onCreated} onYoung={onYoung} onBack={() => setMode('start')} />
  if (mode === 'recover') return <Recover onBack={() => setMode('start')} />
  const passkey = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await authClient.signIn.passkey()
      if (r?.error) throw new Error(r.error.message || 'That passkey did not work.')
      await useSocial.getState().start()
      // a passkey sign-in makes a device called "Phone": give it this phone's kind of name
      const me = useSocial.getState().me
      const name = defaultDeviceName('phone')
      if (me && me.device.name !== name) await social.renameDevice(me.device.id, name).catch(() => {})
    } catch (e) {
      setError(e instanceof Error && e.name !== 'NotAllowedError' ? e.message : 'Sign-in was cancelled.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page>
      <h1 className="text-3xl font-semibold tracking-tight">Shasta, on your phone</h1>
      <p className="mt-3 text-shasta-muted">Your phone becomes your Shasta account: friends you add in person, messages, and your games. No password, email or phone number.</p>
      {notice && <Note className="mt-5">{notice}</Note>}
      <div className="mt-8 grid gap-3">
        <BigButton onClick={() => setMode('make')}>Make my account</BigButton>
        <BigButton variant="secondary" onClick={() => void passkey()} disabled={busy || typeof PublicKeyCredential === 'undefined'}>
          Sign in with a passkey
        </BigButton>
        <BigButton variant="ghost" onClick={() => setMode('recover')}>
          I have a recovery code
        </BigButton>
      </div>
      {error && <p className="mt-3 text-sm text-shasta-danger" role="alert">{error}</p>}
      <p className="mt-8 text-sm text-shasta-faint">
        Using a Chromebook? Open Shasta there and choose “Continue on your phone” to bring your games over.
      </p>
      <ParentsLink />
    </Page>
  )
}

/** The parent page is reachable before any account exists. */
function ParentsLink() {
  const [open, setOpen] = useState(false)
  if (open) return <ParentsInfo className="mt-6" />
  return (
    <button type="button" className="mt-4 min-h-11 self-start text-sm text-shasta-accent" onClick={() => setOpen(true)}>
      For parents and guardians
    </button>
  )
}

export function ParentsInfo({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-3 text-sm', className)}>
      <h2 className="text-lg font-medium">For parents and guardians</h2>
      <p>This page is Shasta's social part: a young person's own profile, friends, a small friends-only feed and messages. Shasta is an education-friendly web browser; this part is optional and needs an account made on a phone.</p>
      <p>How it's set up:</p>
      <ul className="grid list-disc gap-1 pl-5">
        <li>Accounts are for ages 13 and up. Only an age group is stored, never a birthday.</li>
        <li>Friends can only be added in person, by scanning a code on the other person's phone. There is no search and no “people you may know”.</li>
        <li>13–15 year olds can't be friends with adults.</li>
        <li>Messages are text only, between friends only. Links are limited to games in Shasta's own Store. A message asking for a phone number, address, school, age, pictures or to meet up gets a “double-check” prompt first.</li>
        <li>Messages are encrypted on Shasta's server and deleted after 30 days. Shasta's staff can read a conversation only when someone in it reports it.</li>
        <li>“What I'm playing” is off until it's turned on, and then only friends see it. Quiet hours (10 pm to 7 am) are on by default under 18.</li>
        <li>Deleting the account removes everything at once.</li>
      </ul>
      <p>To block it, block only this address; the rest of Shasta keeps working:</p>
      <ul className="grid list-disc gap-1 pl-5">
        <li>iPhone or iPad: Settings → Screen Time → Content &amp; Privacy Restrictions → App Store, Media, Web &amp; Games → Web Content → Limit Adult Websites, then add <span className="font-mono">{typeof location !== 'undefined' ? location.host : ''}</span> under “Never Allow”.</li>
        <li>Android: in the Family Link app, choose your child → Controls → Content restrictions → Google Chrome → Manage sites → Blocked, and add the same address.</li>
      </ul>
      <p>These settings can change between system versions; if a step looks different, the system's own help explains the current one. The account holder can delete it any time (Me → Delete account). To ask Shasta to delete an account, contact Shasta through its Discord.</p>
    </div>
  )
}

function Recover({ onBack }: { onBack(): void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await social.recover(code.trim().toUpperCase(), { kind: 'phone', name: defaultDeviceName('phone') })
      await useSocial.getState().start()
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 403) ? "That code doesn't match an account." : errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page>
      <h1 className="text-2xl font-semibold">Use a recovery code</h1>
      <p className="mt-2 text-shasta-muted">The code you saved looks like XXXXX-XXXXX-XXXXX-XXXXX-XXXXX. Your other devices get a note that this phone signed in.</p>
      <form
        className="mt-6 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="text-sm text-shasta-muted" htmlFor="rc">Recovery code</label>
        <input id="rc" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} className="h-12 rounded-2xl bg-shasta-field px-4 font-mono text-base tracking-wider outline-none" />
        {error && <p className="text-sm text-shasta-danger" role="alert">{error}</p>}
        <BigButton type="submit" disabled={busy || code.trim().length < 20}>
          {busy ? 'Checking…' : 'Sign in'}
        </BigButton>
        <BigButton variant="ghost" onClick={onBack}>
          Back
        </BigButton>
      </form>
    </Page>
  )
}

/** Age, then handle + avatar, then create. `intro` explains why (e.g. "A Chromebook named X wants to link"). */
export function Onboarding({ onCreated, onYoung, onBack, intro }: { onCreated(me: Me): void; onYoung(): void; onBack?(): void; intro?: React.ReactNode }) {
  const [step, setStep] = useState<'age' | 'profile'>('age')
  const [ageText, setAgeText] = useState('')
  const [age, setAge] = useState(0)
  const [ageError, setAgeError] = useState<string | null>(null)

  if (step === 'age')
    return (
      <Page>
        {intro}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const r = ageSchema.safeParse(ageText)
            const problem = firstError(r)
            if (problem) return setAgeError(problem)
            if (r.data! < 13) {
              rememberYoung()
              return onYoung()
            }
            setAge(r.data!)
            setStep('profile')
          }}
        >
          <label htmlFor="age" className="block text-2xl font-semibold">How old are you?</label>
          <input
            id="age"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={ageText}
            onChange={(e) => {
              setAgeText(e.target.value.replace(/\D/g, '').slice(0, 3))
              setAgeError(null)
            }}
            className="mt-4 h-14 w-32 rounded-2xl bg-shasta-field px-4 text-2xl outline-none"
            aria-describedby="age-why"
          />
          <p id="age-why" className="mt-3 text-sm text-shasta-muted">So friends are people around your age. Only the age group is kept, never the number or a birthday.</p>
          {ageError && <p className="mt-2 text-sm text-shasta-danger" role="alert">{ageError}</p>}
          <div className="mt-8 grid gap-2">
            <BigButton type="submit" disabled={!ageText}>
              Next
            </BigButton>
            {onBack && (
              <BigButton variant="ghost" onClick={onBack}>
                Back
              </BigButton>
            )}
          </div>
        </form>
      </Page>
    )
  return <PickProfile age={age} onCreated={onCreated} onYoung={onYoung} onBack={() => setStep('age')} />
}

function PickProfile({ age, onCreated, onYoung, onBack }: { age: number; onCreated(me: Me): void; onYoung(): void; onBack(): void }) {
  const [handle, setHandle] = useState('')
  const [touched, setTouched] = useState(false)
  const [avatar, setAvatar] = useState<Avatar>(() => randomAvatar('lorelei'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = handleProblem(handle)

  const create = async () => {
    setTouched(true)
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      const { me } = await social.createAccount({ handle: handle.trim().toLowerCase(), age, avatar, device: { kind: 'phone', name: defaultDeviceName('phone') } })
      await useSocial.getState().start()
      onCreated(me)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'too_young') {
        rememberYoung()
        return onYoung()
      }
      setError(e instanceof ApiError && (e.status === 409 || e.code === 'conflict') ? 'Someone already has that handle. Try another.' : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page className="justify-start">
      <h1 className="text-2xl font-semibold">Pick a handle and a look</h1>
      <p className="mt-2 text-shasta-muted">Friends see these. Don't use your full name.</p>
      <AvatarPicker value={avatar} onChange={setAvatar} className="mt-6" />
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <label htmlFor="handle" className="text-sm text-shasta-muted">Handle</label>
        <div className="mt-1 flex h-12 items-center rounded-2xl bg-shasta-field px-4">
          <span className="text-shasta-faint">@</span>
          <input
            id="handle"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value.toLowerCase().replace(/\s/g, '_').slice(0, 24))
              setError(null)
            }}
            onBlur={() => setTouched(true)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={touched && !!problem}
            aria-describedby="handle-help"
            className="h-full min-w-0 flex-1 bg-transparent pl-0.5 text-base outline-none"
          />
        </div>
        <p id="handle-help" className={cn('mt-1.5 text-sm', touched && problem ? 'text-shasta-danger' : 'text-shasta-faint')} aria-live="polite">
          {handle && problem ? problem : touched && problem ? problem : '3 to 20 letters, numbers or _'}
        </p>
        {error && <p className="mt-2 text-sm text-shasta-danger" role="alert">{error}</p>}
        <div className="mt-6 grid gap-2">
          <BigButton type="submit" disabled={busy}>
            {busy ? 'Making your account…' : 'Make my account'}
          </BigButton>
          <BigButton variant="ghost" onClick={onBack}>
            Back
          </BigButton>
        </div>
      </form>
    </Page>
  )
}

/** Style chips, a shuffle button and background colours. Exported for the profile editor. */
export function AvatarPicker({ value, onChange, className }: { value: Avatar; onChange(a: Avatar): void; className?: string }) {
  const style = useMemo(() => parsePreset(value.preset)?.style ?? 'lorelei', [value.preset])
  const setStyle = (s: AvatarStyle) => onChange({ ...randomAvatar(s), bg: value.bg })
  return (
    <div className={cn('grid justify-items-center gap-4', className)}>
      <SocialAvatar avatar={value} size={120} label="Your avatar" />
      <button type="button" onClick={() => onChange({ ...randomAvatar(style), bg: value.bg })} className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 ring-1 ring-shasta-line sh-press">
        <Shuffle className="size-4" /> Shuffle
      </button>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Avatar style">
        {AVATAR_STYLES.map((s) => (
          <button key={s} type="button" onClick={() => setStyle(s)} aria-pressed={s === style} className={cn('min-h-11 rounded-xl px-3 text-sm', s === style ? 'sh-selected' : 'text-shasta-muted hover:bg-shasta-hover')}>
            {AVATAR_STYLE_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Background colour">
        {AVATAR_BGS.map((bg) => (
          <button key={bg} type="button" onClick={() => onChange({ ...value, bg })} aria-label={`Background ${bg}`} aria-pressed={bg === value.bg} className={cn('size-11 rounded-full ring-1 ring-black/10', bg === value.bg && 'ring-3 ring-shasta-accent')} style={{ background: bg }} />
        ))}
      </div>
    </div>
  )
}
