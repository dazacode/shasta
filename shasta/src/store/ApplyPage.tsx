import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Send, Wrench, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PublishDemo } from '@/components/demos/PublishDemo'
import { useUi } from '@/stores/uiStore'
import { api, errorMessage } from './api'
import { Message } from './components'
import { Field, textareaClass } from './dev/shared'
import { formatDate } from './hooks'
import { useStoreNav } from './nav'
import { useStore } from './storeStore'
import type { MyApplication, StoreUser } from './types'

// The applicant has no account: this random ticket (from the server) is the only way to read the answer. Losing it
// (clearing site data) only means the owner sends the invite code by hand.
const KEY = 'shasta-store-application'
const readTicket = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
const writeTicket = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t)
    else localStorage.removeItem(KEY)
  } catch {}
}

// the same rules as PUBLISHING_RULES in server/src/services/packageCheck.ts (the CLI and the Discord bot show those)
export const PUBLISHING_RULES = [
  'Only things you made, or have the right to share (open-source, free homebrew, or with the maker’s permission).',
  'No commercial games or their files, no ROMs or BIOS files.',
  'Nothing that asks for passwords or payment details for another service.',
  'Nothing hateful, sexual or violent that would not be fine in a school.',
  'Credit the people who made it.',
]

function ApplyForm({ onSent }: { onSent: (ticket: string) => void }) {
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [about, setAbout] = useState('')
  const [links, setLinks] = useState('')
  const [rules, setRules] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ ticket: string }>('/api/apply', { name, contact, about, links, rules })
      onSent(r.ticket)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-4 rounded-2xl bg-shasta-home p-5 ring-1 ring-shasta-line" onSubmit={(e) => (e.preventDefault(), void send())}>
      <Field label="Your name or the name you publish under">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
      </Field>
      <Field label="What do you want to publish?" hint="Games or apps, what they are built with, whether you made them." counter={`${about.length}/2000`}>
        <textarea className={textareaClass} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={2000} required />
      </Field>
      <Field label="Links (optional)" hint="Where it can be seen now: itch.io, GitHub, a website.">
        <Input value={links} onChange={(e) => setLinks(e.target.value)} maxLength={500} />
      </Field>
      <Field label="A way to reach you (optional)" hint="A Discord name or anything else, in case the owner has a question. Only the Store owner sees it.">
        <Input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
      </Field>
      <fieldset className="grid gap-2 rounded-xl bg-shasta-field px-4 py-3 text-sm">
        <legend className="sr-only">Publishing rules</legend>
        <p className="font-medium">Publishing rules</p>
        <ul className="list-disc space-y-1 pl-5 text-shasta-muted">
          {PUBLISHING_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <label className="mt-1 flex items-center gap-2">
          <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} className="size-4 accent-[var(--color-shasta-accent)]" />I have read the rules and will follow them
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-shasta-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy || !rules || !name.trim() || about.trim().length < 20}>
          <Send /> {busy ? 'Sending…' : 'Send application'}
        </Button>
      </div>
      <p className="text-xs text-shasta-muted">No account is created. This browser keeps a private ticket to see the answer. Answered applications are deleted after 30 days, unanswered ones after 90.</p>
    </form>
  )
}

function Status({ app, onReset }: { app: MyApplication; onReset: () => void }) {
  const { go } = useStoreNav()
  const [busy, setBusy] = useState(false)
  const toast = useUi.getState().toast

  // the same redeem as Account → "I have a code": this is what creates the contributor account on this device
  const accept = async () => {
    if (!app.code) return
    setBusy(true)
    try {
      const r = await api.post<{ user: StoreUser; recoveryKey: string | null }>('/api/auth/redeem', { code: app.code })
      useStore.getState().setUser(r.user)
      if (r.recoveryKey) useStore.setState({ pendingRecoveryKey: r.recoveryKey })
      writeTicket(null)
      toast('You are now an approved contributor.', { tone: 'success' })
      go('/develop')
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const withdraw = async () => {
    if (!confirm('Withdraw your application? It is deleted at once.')) return
    try {
      await api.post('/api/apply/withdraw', { ticket: readTicket() })
      onReset()
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' })
    }
  }

  if (app.status === 'pending')
    return (
      <Message
        icon={<Clock className="size-5" />}
        title="Your application is waiting for the owner"
        body={`Sent ${formatDate(app.createdAt)} as ${app.name}. Come back to this page to see the answer.`}
        action={
          <Button variant="ghost" onClick={withdraw}>
            Withdraw
          </Button>
        }
      />
    )
  if (app.status === 'declined')
    return (
      <Message
        icon={<XCircle className="size-5" />}
        title="Your application was not accepted"
        body={app.message ? `The owner wrote: “${app.message}”` : 'The owner did not leave a message.'}
        action={
          <Button variant="secondary" onClick={onReset}>
            Apply again
          </Button>
        }
      />
    )
  return (
    <Message
      icon={<CheckCircle2 className="size-5" />}
      title="You’re approved"
      body={`${app.message ? `The owner wrote: “${app.message}” ` : ''}${app.code ? `Accept to set up contributor access on this device. ${app.canPublish ? 'You may publish without review.' : 'Your first submissions are reviewed by the owner before they go live.'}` : 'The invite has been used or has expired. Ask the owner for a new code and enter it under Account → “I have a code”.'}`}
      action={
        app.code ? (
          <Button onClick={accept} disabled={busy}>
            <Wrench /> {busy ? 'Setting up…' : 'Become a contributor'}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => go('/account')}>
            Go to Account
          </Button>
        )
      }
    />
  )
}

export default function ApplyPage() {
  const { go } = useStoreNav()
  const user = useStore((s) => s.user)
  const [ticket, setTicket] = useState<string | null>(readTicket)
  const [app, setApp] = useState<MyApplication | null>(null)
  const [open, setOpen] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.get<{ open: boolean }>('/api/apply').then(
      (r) => live && setOpen(r.open),
      (e) => live && setError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (!ticket) {
      setApp(null)
      return
    }
    let live = true
    api.post<MyApplication>('/api/apply/status', { ticket }).then(
      (r) => live && setApp(r),
      (e) => {
        if (!live) return
        // a 404 means the application is gone (withdrawn, or answered over 30 days ago): start over
        if ((e as { status?: number }).status === 404) (writeTicket(null), setTicket(null))
        else setError(errorMessage(e))
      },
    )
    return () => {
      live = false
    }
  }, [ticket])

  const reset = () => (writeTicket(null), setTicket(null))
  const staff = user?.role === 'contributor' || user?.role === 'owner'

  return (
    <div className="mx-auto grid max-w-2xl gap-4 pt-2">
      <div>
        <h1 className="sh-title">Publish in the Store</h1>
        <p className="text-sm text-shasta-muted">Anyone can apply to publish games and apps in the Shasta Store; the Store owner reads every application and answers it. Once approved you get your own storefront, and your first submissions are reviewed before they go live.</p>
        <p className="mt-2 text-sm text-shasta-muted">
          Publishing mostly happens in the terminal: the <code className="rounded bg-shasta-field px-1">shasta</code> command (the publishing tool, which is open source) checks a game the way the Store will, previews it in the Store's sandbox and publishes it in one step. You can apply there too with <code className="rounded bg-shasta-field px-1">shasta apply</code>.
        </p>
      </div>
      {/* what publishing looks like, start to listing (components/demos/PublishDemo.tsx) */}
      <PublishDemo />
      {staff ? (
        <Message icon={<Wrench className="size-5" />} title="You are already a contributor" action={<Button onClick={() => go('/develop')}>Open Develop</Button>} />
      ) : error ? (
        <Message title="Could not reach the Store" body={error} />
      ) : ticket ? (
        app ? <Status app={app} onReset={reset} /> : <p className="py-10 text-center text-sm text-shasta-muted">Loading…</p>
      ) : open === false ? (
        <Message title="Applications are closed right now" body="The Store owner is not taking new contributors at the moment. If you already have an invite code, enter it under Account." action={<Button variant="secondary" onClick={() => go('/account')}>Go to Account</Button>} />
      ) : open === null ? (
        <p className="py-10 text-center text-sm text-shasta-muted">Loading…</p>
      ) : (
        <ApplyForm onSent={(t) => (writeTicket(t), setTicket(t))} />
      )}
    </div>
  )
}
