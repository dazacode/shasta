// "Keep your account": the account lives on this phone and nowhere else, so it says so plainly and offers the three
// ways to keep it: Add to Home Screen (a Home Screen app keeps its storage; a Safari tab loses it after 7 days without
// a visit), a passkey (synced by iCloud Keychain or Google Password Manager) and a recovery code (shown once).
// The account counts as temporary until it has a passkey or a recovery code.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Download, KeyRound, Smartphone, Trash2 } from 'lucide-react'
import { errorText, social } from '@/social/api'
import { authClient } from '@/social/auth'
import { useSocial } from '@/social/store'
import { cn } from '@/lib/utils'
import { isAndroid, isIos, persistStorage, promptInstall, useInstall } from '../install'
import { BigButton, Group, Note, Row, Screen } from '../ui'
import { useNav } from '../nav'

function Step({ done, title, children, icon }: { done: boolean; title: string; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <section className={cn('rounded-2xl bg-shasta-home p-4 ring-1 ring-shasta-line', done && 'opacity-80')}>
      <h2 className="flex items-center gap-2 font-medium">
        <span className={cn('grid size-8 place-items-center rounded-full [&_svg]:size-4', done ? 'bg-shasta-accent text-shasta-accent-fg' : 'bg-shasta-field')}>{done ? <Check /> : icon}</span>
        {title}
      </h2>
      <div className="mt-2 text-sm text-shasta-muted">{children}</div>
    </section>
  )
}

export function HomeScreenStep() {
  const { prompt, installed } = useInstall()
  return (
    <Step done={installed} title="Add Shasta to your Home Screen" icon={<Smartphone />}>
      {installed ? (
        <p>Done. Open Shasta from your Home Screen from now on.</p>
      ) : isIos() ? (
        <>
          <ol className="grid list-decimal gap-1 pl-5">
            <li>Tap the Share button at the bottom of Safari (a square with an arrow).</li>
            <li>Scroll down and tap “Add to Home Screen”, then “Add”.</li>
          </ol>
          <p className="mt-2">On iPhone the Home Screen app may start signed out: add a passkey or save a recovery code first, then sign in there with it.</p>
        </>
      ) : prompt ? (
        <BigButton className="mt-2" onClick={() => void promptInstall()}>
          Add to Home Screen
        </BigButton>
      ) : (
        <p>{isAndroid() ? 'Open your browser’s ⋮ menu and choose “Add to Home screen” or “Install app”.' : 'Use your browser’s menu to add this page to your Home Screen.'}</p>
      )}
    </Step>
  )
}

export function PasskeyStep({ onDone }: { onDone?(): void }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['me', 'passkeys'], queryFn: listPasskeys })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = typeof PublicKeyCredential !== 'undefined'
  const has = (list.data?.length ?? 0) > 0
  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      const me = useSocial.getState().me
      const r = await authClient.passkey.addPasskey({ name: `Shasta (${me?.device.name ?? 'phone'})` })
      if (r && 'error' in r && r.error) throw new Error(r.error.message || 'The passkey was not saved.')
      await qc.invalidateQueries({ queryKey: ['me', 'passkeys'] })
      await useSocial.getState().refresh()
      onDone?.()
    } catch (e) {
      setError(e instanceof Error && e.name !== 'NotAllowedError' ? e.message : 'Cancelled. You can add one any time.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step done={has} title="Add a passkey" icon={<KeyRound />}>
      <p>Your phone saves a passkey with Face ID, Touch ID or your screen lock and keeps it in iCloud Keychain or Google Password Manager. With it you can sign in again on a new phone.</p>
      {supported ? (
        <BigButton className="mt-3" variant={has ? 'secondary' : 'primary'} disabled={busy} onClick={() => void add()}>
          {busy ? 'Waiting for your phone…' : has ? 'Add another passkey' : 'Add a passkey'}
        </BigButton>
      ) : (
        <p className="mt-2">This browser can't make passkeys. Save a recovery code instead.</p>
      )}
      {error && <p className="mt-2 text-shasta-danger" role="alert">{error}</p>}
    </Step>
  )
}

export function RecoveryStep({ onDone }: { onDone?(): void }) {
  const [code, setCode] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const temporary = useSocial((s) => s.me?.temporary ?? true)
  const make = async () => {
    setBusy(true)
    setError(null)
    try {
      setCode((await social.newRecoveryCode()).code)
      setSaved(false)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const download = () => {
    if (!code) return
    const blob = new Blob([`Shasta recovery code\n\n${code}\n\nKeep it somewhere safe. Anyone with this code can sign in to your Shasta account.\nMaking a new code stops this one from working.\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'shasta-recovery-code.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setSaved(true)
  }
  return (
    <Step done={saved || (!code && !temporary)} title="Save a recovery code" icon={<Download />}>
      <p>A one-time code that gets your account back if you lose this phone. It's shown once; making a new one stops the old one working. Keep it private, like a password.</p>
      {code ? (
        <>
          <p className="my-3 select-all break-all rounded-xl bg-shasta-field p-3 text-center font-mono text-base text-shasta-fg">{code}</p>
          <div className="grid grid-cols-2 gap-2">
            <BigButton
              variant="secondary"
              onClick={() =>
                void navigator.clipboard?.writeText(code).then(
                  () => setSaved(true),
                  () => setError("Couldn't copy. Write it down instead."),
                )
              }
            >
              <Copy /> Copy
            </BigButton>
            <BigButton variant="secondary" onClick={download}>
              <Download /> Download
            </BigButton>
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-3 text-shasta-fg">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-5 accent-[var(--sh-accent)]" /> I saved it somewhere safe
          </label>
          {saved && (
            <BigButton
              className="mt-2"
              onClick={() => {
                setCode(null)
                void useSocial.getState().refresh()
                onDone?.()
              }}
            >
              Done
            </BigButton>
          )}
        </>
      ) : (
        <BigButton className="mt-3" variant={temporary ? 'primary' : 'secondary'} disabled={busy} onClick={() => void make()}>
          {busy ? 'Making a code…' : temporary ? 'Make a recovery code' : 'Make a new recovery code'}
        </BigButton>
      )}
      {error && <p className="mt-2 text-shasta-danger" role="alert">{error}</p>}
    </Step>
  )
}

async function listPasskeys(): Promise<{ id: string; name?: string | null; createdAt?: string }[]> {
  const r = await authClient.$fetch<{ id: string; name?: string | null; createdAt?: string }[]>('/passkey/list-user-passkeys', { method: 'GET' })
  return Array.isArray(r.data) ? r.data : []
}

/** Shown right after the account is made (and from Me -> Backups while it is still temporary). */
export function KeepAccount() {
  const reset = useNav((s) => s.reset)
  const temporary = useSocial((s) => s.me?.temporary ?? true)
  useEffect(() => {
    void persistStorage()
  }, [])
  return (
    <Screen title="Keep your account" back={false}>
      <p>Your account lives on this phone. There's no password or email, so if this phone's storage is cleared or the phone is lost, the account goes with it, unless you add a backup.</p>
      {temporary && <Note className="mt-3">Until you add a passkey or a recovery code, your account is temporary.</Note>}
      <div className="mt-5 grid gap-3">
        {isIos() ? (
          <>
            <PasskeyStep />
            <RecoveryStep />
            <HomeScreenStep />
          </>
        ) : (
          <>
            <HomeScreenStep />
            <PasskeyStep />
            <RecoveryStep />
          </>
        )}
      </div>
      <BigButton className="mt-6" variant={temporary ? 'secondary' : 'primary'} onClick={() => reset('home')}>
        {temporary ? 'Later' : 'Done'}
      </BigButton>
    </Screen>
  )
}

/** Me -> Backups */
export function BackupsScreen() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['me', 'passkeys'], queryFn: listPasskeys })
  const me = useSocial((s) => s.me)
  const limited = !!me?.device.limitedUntil && me.device.limitedUntil > Date.now()
  const remove = async (id: string) => {
    if (!confirm('Remove this passkey? You can add it again later.')) return
    await authClient.$fetch('/passkey/delete-passkey', { method: 'POST', body: { id } })
    await qc.invalidateQueries({ queryKey: ['me', 'passkeys'] })
    await useSocial.getState().refresh()
  }
  return (
    <Screen title="Backups">
      {me?.temporary && <Note className="mb-4">Your account is temporary: add a passkey or save a recovery code so you can't lose it.</Note>}
      {limited || me?.device.role !== 'owner' ? (
        <Note>Only your first phone can change backups{limited ? ', and not in a newly linked device’s first 3 days' : ''}.</Note>
      ) : (
        <div className="grid gap-3">
          <PasskeyStep />
          {!!list.data?.length && (
            <Group title="Your passkeys">
              {list.data.map((p) => (
                <Row key={p.id} icon={<KeyRound />} label={p.name || 'Passkey'} detail={p.createdAt ? `Added ${new Date(p.createdAt).toLocaleDateString()}` : undefined}>
                  <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-shasta-hover" onClick={() => void remove(p.id)} aria-label="Remove this passkey">
                    <Trash2 className="size-5" />
                  </button>
                </Row>
              ))}
            </Group>
          )}
          <RecoveryStep />
          <HomeScreenStep />
        </div>
      )}
    </Screen>
  )
}
