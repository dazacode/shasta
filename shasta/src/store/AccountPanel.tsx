import { useState, type ReactNode } from 'react'
import { HardDrive, KeyRound, LogOut, Send, ShieldCheck, Ticket, UserRound, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUi } from '@/stores/uiStore'
import { useTabs } from '@/stores/tabsStore'
import { api, errorMessage } from './api'
import { useStore } from './storeStore'
import { useStoreNav } from './nav'
import type { StoreUser } from './types'

const ROLE_TEXT = { owner: 'Store owner', contributor: 'Approved contributor', user: 'No Store access yet' } as const

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-shasta-home p-5 ring-1 ring-shasta-line">
      <h2 className="mb-1 flex items-center gap-2 font-medium [&>svg]:size-4 [&>svg]:text-shasta-faint">{icon} {title}</h2>
      {children}
    </section>
  )
}

function Field({ label, onSubmit, action, placeholder, busy, error, mono }: { label: string; onSubmit: (v: string) => void | Promise<void>; action: string; placeholder: string; busy?: boolean; error?: string; mono?: boolean }) {
  const [v, setV] = useState('')
  return (
    <form onSubmit={(e) => (e.preventDefault(), void onSubmit(v))} className="mt-3 grid gap-2">
      <div className="flex gap-2">
        <Input aria-label={label} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} spellCheck={false} autoComplete="off" className={mono ? 'font-mono' : ''} />
        <Button type="submit" disabled={busy || !v.trim()}>{action}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
    </form>
  )
}

export default function AccountPanel() {
  const { go } = useStoreNav()
  const user = useStore((s) => s.user)
  const local = useStore((s) => s.local)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const toast = useUi.getState().toast
  const fail = (k: string, e: unknown) => setErrors((x) => ({ ...x, [k]: errorMessage(e) }))
  const clear = (k: string) => setErrors((x) => ({ ...x, [k]: '' }))

  const restore = async (key: string) => {
    setBusy('restore'); clear('restore')
    try {
      const r = await api.post<{ user: StoreUser }>('/api/auth/restore', { key })
      useStore.getState().setUser(r.user)
      toast('Welcome back. Staff access is restored on this device.', { tone: 'success' })
    } catch (e) { fail('restore', e) } finally { setBusy('') }
  }
  // redeeming a code is what creates a staff account; a visitor has none and a wrong code creates nothing
  const redeem = async (code: string) => {
    setBusy('redeem'); clear('redeem')
    try {
      const r = await api.post<{ user: StoreUser; recoveryKey: string | null }>('/api/auth/redeem', { code })
      useStore.getState().setUser(r.user)
      if (r.recoveryKey) useStore.setState({ pendingRecoveryKey: r.recoveryKey })
      toast(r.user.role === 'owner' ? 'You are now the Store owner.' : 'You are now an approved contributor.', { tone: 'success', action: { label: 'Open', run: () => go(r.user.role === 'owner' ? '/admin' : '/develop') } })
    } catch (e) { fail('redeem', e) } finally { setBusy('') }
  }
  const getId = async () => {
    setBusy('start'); clear('start')
    try {
      const r = await api.post<{ user: StoreUser; recoveryKey: string | null }>('/api/auth/start')
      useStore.getState().setUser(r.user)
      if (r.recoveryKey) useStore.setState({ pendingRecoveryKey: r.recoveryKey })
    } catch (e) { fail('start', e) } finally { setBusy('') }
  }
  const saveName = async () => {
    try {
      await api.patch('/api/auth/me', { displayName: name })
      useStore.setState((s) => ({ user: s.user && { ...s.user, displayName: name.trim() } }))
      setEditing(false)
    } catch (e) { fail('name', e) }
  }
  const newKey = async () => {
    if (!confirm('Create a new recovery key? The old key stops working and your other devices are signed out.')) return
    setBusy('key')
    try {
      const r = await api.post<{ recoveryKey: string }>('/api/auth/rotate-key')
      useStore.setState({ pendingRecoveryKey: r.recoveryKey })
    } catch (e) { toast(errorMessage(e), { tone: 'error' }) } finally { setBusy('') }
  }
  const signOut = async () => {
    if (!confirm('Sign out of Store staff access on this device? You can only get back in with your recovery key. Your installed apps are not affected.')) return
    await useStore.getState().signOut()
  }

  const apps = local?.installs.length ?? 0
  return (
    <div className="mx-auto grid max-w-2xl gap-4 pt-2">
      <div>
        <h1 className="sh-title">Account</h1>
        <p className="text-sm text-shasta-muted">Shasta has no user accounts. You never need to register, give an email address or choose a password to browse, install apps or customise Shasta.</p>
      </div>

      <Card icon={<HardDrive />} title="This device">
        <p className="mt-1 text-sm text-shasta-muted" data-testid="device-library">
          Your library ({apps} installed app{apps === 1 ? '' : 's'}, {local?.favorites.length ?? 0} favorite{local?.favorites.length === 1 ? '' : 's'}, {local?.following.length ?? 0} followed storefront{local?.following.length === 1 ? '' : 's'}), bookmarks, history and settings are saved in this browser. The Store server is not told what you have installed.
        </p>
        <p className="mt-2 text-sm text-shasta-muted">Clearing this browser's site data, or switching to another browser or device, erases them. To keep or move them, export your profile under Settings → Profile &amp; data.</p>
        <div className="mt-3"><Button variant="secondary" onClick={() => useTabs.getState().openInternal('settings', 'profile')}>Profile &amp; data</Button></div>
      </Card>

      <Card icon={<UserRound />} title="Store staff">
        <p className="text-sm text-shasta-muted">Only the Store owner and approved contributors sign in, so that nobody else can upload, replace or delete games. This is separate from using Shasta, and from any website you log in to.</p>
        {user ? (
          <div className="mt-3 grid gap-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {editing ? (
                <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void saveName())}>
                  <Input aria-label="Display name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="w-52" />
                  <Button type="submit" disabled={!name.trim()}>Save</Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </form>
              ) : (
                <p><span className="text-shasta-muted">Name: </span><strong>{user.displayName}</strong> <button className="ml-1 text-shasta-accent hover:underline" onClick={() => (setName(user.displayName), setEditing(true))}>Change</button></p>
              )}
              <span className="rounded-full bg-shasta-field px-2.5 py-0.5 text-xs">{ROLE_TEXT[user.role]}{user.role === 'contributor' && (user.canPublish ? ' · can publish' : ' · submits for review')}</span>
            </div>
            {errors.name && <p role="alert" className="text-shasta-danger">{errors.name}</p>}
            <p><span className="text-shasta-muted">Account ID: </span><code className="rounded bg-shasta-field px-1.5 py-0.5 select-all" data-testid="public-id">{user.publicId}</code></p>
            {user.role === 'user' && <p className="text-xs text-shasta-muted">Share the Account ID (not your recovery key) with the Store owner if you'd like to become a contributor, or enter an invite code below.</p>}
            <div className="flex flex-wrap gap-2">
              {(user.role === 'contributor' || user.role === 'owner') && <Button variant="secondary" onClick={() => go('/develop')}><Wrench /> Open Develop</Button>}
              {user.role === 'owner' && <Button variant="secondary" onClick={() => go('/admin')}><ShieldCheck /> Open Manage</Button>}
              <Button variant="secondary" disabled={busy === 'key'} onClick={newKey}><KeyRound /> New recovery key</Button>
              <Button variant="ghost" onClick={signOut}><LogOut /> Sign out of this device</Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <Button variant="secondary" disabled={busy === 'start'} onClick={getId}>Get an Account ID</Button>
            <span className="text-xs text-shasta-muted">Only if the owner asked for one, to grant you contributor access. It stores nothing but a random ID.</span>
            {errors.start && <p role="alert" className="w-full text-shasta-danger">{errors.start}</p>}
          </div>
        )}
      </Card>

      {user?.role !== 'contributor' && user?.role !== 'owner' && (
        <Card icon={<Send />} title="Want to publish in the Store?">
          <p className="text-sm text-shasta-muted">Anyone can apply. The Store owner reads every application; once approved you get your own storefront.</p>
          <div className="mt-3"><Button variant="secondary" onClick={() => go('/apply')}>Apply to publish</Button></div>
        </Card>
      )}

      <Card icon={<Ticket />} title="I have a code">
        <p className="text-sm text-shasta-muted">The Store owner gives approved contributors a single-use invite code. The first person to set up a new Store gets a setup code from the server's console.</p>
        <Field label="Invite code" placeholder="XXXXX-XXXXX-XXXXX" action="Use code" mono busy={busy === 'redeem'} error={errors.redeem} onSubmit={redeem} />
      </Card>

      {!user && (
        <Card icon={<KeyRound />} title="Restore staff access">
          <p className="text-sm text-shasta-muted">Signing in on a new device or after clearing browser data? Enter the recovery key you saved when staff access was created. We only keep a scrambled copy of it.</p>
          <Field label="Recovery key" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" action="Restore" mono busy={busy === 'restore'} error={errors.restore} onSubmit={restore} />
        </Card>
      )}
    </div>
  )
}
