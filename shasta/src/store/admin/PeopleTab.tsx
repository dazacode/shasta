import { useState } from 'react'
import { KeyRound, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { useApi, useDebounced, formatDate, timeAgo } from '../hooks'
import { LoadError, Message } from '../components'
import type { AdminUser, Invite } from '../types'
import { Card, ConfirmDialog, CopyBox, Field, ListSkeleton, useAction } from './common'
import { cn } from '@/lib/utils'

const ROLE_LABEL = { owner: 'Owner', contributor: 'Contributor', user: 'Visitor' } as const

function InviteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [note, setNote] = useState('')
  const [canPublish, setCanPublish] = useState(false)
  const [days, setDays] = useState('7')
  const [code, setCode] = useState<string | null>(null)
  const { busy, run } = useAction()
  const close = () => {
    setCode(null)
    setNote('')
    setCanPublish(false)
    setDays('7')
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{code ? 'Invite code ready' : 'Invite a contributor'}</DialogTitle>
          <DialogDescription>{code ? 'Send this to the person. They open Store → Account → “I have a code” on their own device.' : 'Creates a single-use code. Whoever redeems it first becomes a contributor.'}</DialogDescription>
        </DialogHeader>
        {code ? (
          <div className="grid gap-3">
            <CopyBox value={code} />
            <p className="rounded-lg bg-shasta-warn/15 px-3 py-2 text-sm text-shasta-warn">This code is shown only once and works for a single person. If you lose it, revoke it and create another.</p>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              let created = ''
              const ok = await run('invite', async () => {
                created = (await api.post<{ code: string }>('/api/admin/invites', { note: note.trim(), canPublish, expiresInDays: Number(days) || 7 })).code
              })
              if (ok) (setCode(created), onCreated())
            }}
          >
            <Field label="Who is it for? (optional)" hint="A note only you see, e.g. a name or class.">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Expires after (days)" hint="1 to 30.">
              <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-lg bg-shasta-field px-3 py-2 text-sm">
              <span>
                May publish without review
                <span className="block text-xs text-shasta-muted">Otherwise every submission waits for your approval.</span>
              </span>
              <Switch checked={canPublish} onCheckedChange={setCanPublish} aria-label="May publish without review" />
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy === 'invite'}>
                <KeyRound /> Create code
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

const INVITE_STYLE: Record<Invite['status'], string> = { open: 'text-emerald-600 dark:text-emerald-400', used: 'text-shasta-muted', revoked: 'text-shasta-danger', expired: 'text-shasta-muted' }

export function PeopleTab() {
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 250)
  const users = useApi<{ users: AdminUser[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`, { live: false })
  const invites = useApi<{ invites: Invite[] }>('/api/admin/invites', { live: false })
  const { busy, run } = useAction()
  const [inviting, setInviting] = useState(false)
  const [revoking, setRevoking] = useState<AdminUser | null>(null)
  const [grantId, setGrantId] = useState('')
  const [grantPublish, setGrantPublish] = useState(false)

  const patch = async (u: AdminUser, body: Record<string, unknown>, ok: string) => {
    if (await run(`u-${u.id}`, () => api.patch(`/api/admin/users/${u.id}`, body), ok)) users.reload()
  }

  return (
    <div className="grid gap-8">
      <p className="rounded-2xl bg-shasta-home px-4 py-3 text-sm text-shasta-muted ring-1 ring-shasta-line">
        Shasta accounts are anonymous: nobody has a username or password. Visitors get an account automatically and are identified by a short <b className="text-shasta-fg">Account ID</b> (like K7QM-2XPD) shown on their Account page. You approve contributors with a{' '}
        <b className="text-shasta-fg">single-use invite code</b>, or by granting an Account ID someone sends you.
      </p>

      <section aria-label="Invite or grant" className="grid gap-4 md:grid-cols-2">
        <Card className="grid content-start gap-3">
          <h3 className="font-semibold">Invite code</h3>
          <p className="text-sm text-shasta-muted">Best when you can hand the person a code directly.</p>
          <div>
            <Button onClick={() => setInviting(true)}>
              <KeyRound /> Invite a contributor
            </Button>
          </div>
        </Card>
        <Card>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await run('grant', () => api.post('/api/admin/users/grant', { publicId: grantId.trim(), canPublish: grantPublish }), 'That account is now a contributor.')) {
                setGrantId('')
                users.reload()
              }
            }}
          >
            <h3 className="font-semibold">Grant by Account ID</h3>
            <Field label="Account ID" hint="The person copies it from Store → Account.">
              <Input value={grantId} onChange={(e) => setGrantId(e.target.value)} placeholder="K7QM-2XPD" spellCheck={false} autoComplete="off" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={grantPublish} onCheckedChange={setGrantPublish} aria-label="May publish without review" /> May publish without review
            </label>
            <div>
              <Button type="submit" disabled={!grantId.trim() || busy === 'grant'}>
                Make contributor
              </Button>
            </div>
          </form>
        </Card>
      </section>

      <section aria-label="Accounts">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Owners and contributors</h2>
          <Input className="max-w-64" aria-label="Search visitors by Account ID or name" placeholder="Find any account by ID or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {users.error && !users.data ? (
          <LoadError message={users.error} offline={users.offline} onRetry={users.reload} />
        ) : !users.data ? (
          <ListSkeleton />
        ) : !users.data.users.length ? (
          <Message icon={<Users className="size-5" />} title="No matching accounts" body="Search by the exact Account ID or part of the display name." />
        ) : (
          <div className="grid gap-2">
            {users.data.users.map((u) => (
              <Card key={u.id} className={cn('flex flex-wrap items-center gap-3 !p-3', u.disabled && 'opacity-60')}>
                <div className="min-w-0 flex-1 basis-52">
                  <p className="truncate font-medium">
                    {u.displayName} <span className="ml-1 rounded-full bg-shasta-field px-2 py-0.5 text-[11px] font-normal text-shasta-muted">{ROLE_LABEL[u.role]}</span>
                    {u.disabled && <span className="ml-1 rounded-full bg-shasta-danger/15 px-2 py-0.5 text-[11px] text-shasta-danger">Disabled</span>}
                  </p>
                  <p className="text-xs text-shasta-muted">
                    <code>{u.publicId}</code> · {u.apps} app{u.apps === 1 ? '' : 's'} · last seen {timeAgo(u.lastSeenAt)} · joined {formatDate(u.createdAt)}
                  </p>
                </div>
                {u.role === 'contributor' && (
                  <label className="flex items-center gap-2 text-xs text-shasta-muted">
                    <Switch size="sm" checked={u.canPublishFlag} disabled={busy === `u-${u.id}`} onCheckedChange={(v) => void patch(u, { canPublish: v }, v ? 'Can now publish without review.' : 'Submissions now need review.')} aria-label={`${u.displayName} may publish without review`} />
                    Publish without review
                  </label>
                )}
                <div className="flex gap-2">
                  {u.role !== 'user' && (
                    <Button size="sm" variant="secondary" onClick={() => setRevoking(u)} disabled={busy === `u-${u.id}`}>
                      Revoke access
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === `u-${u.id}`} onClick={() => void patch(u, { disabled: !u.disabled }, u.disabled ? 'Account enabled.' : 'Account disabled and signed out everywhere.')}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </Button>
                  {u.role === 'user' && (
                    <Button size="sm" variant="secondary" onClick={() => void patch(u, { role: 'contributor' }, `${u.displayName} is now a contributor.`)}>
                      Make contributor
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Invites">
        <h2 className="mb-3 text-lg font-semibold">Invite codes</h2>
        {invites.error && !invites.data ? (
          <LoadError message={invites.error} offline={invites.offline} onRetry={invites.reload} />
        ) : !invites.data ? (
          <ListSkeleton rows={1} />
        ) : !invites.data.invites.length ? (
          <p className="text-sm text-shasta-muted">No invite codes yet. Codes themselves are never stored or shown again after creation.</p>
        ) : (
          <ul className="grid gap-2">
            {invites.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-shasta-home px-4 py-2.5 text-sm ring-1 ring-shasta-line">
                <span className={cn('w-16 font-medium capitalize', INVITE_STYLE[i.status])}>{i.status}</span>
                <span className="min-w-0 flex-1 basis-40">
                  {i.role === 'owner' ? 'Owner setup' : i.canPublish ? 'Contributor (may publish)' : 'Contributor'}
                  {i.note ? ` · ${i.note}` : ''}
                  <span className="block text-xs text-shasta-muted">
                    created {formatDate(i.createdAt)} · {i.status === 'used' && i.usedBy ? `redeemed by ${i.usedBy.name ?? 'someone'} (${i.usedBy.publicId})` : `expires ${formatDate(i.expiresAt)}`}
                  </span>
                </span>
                {i.status === 'open' && (
                  <Button size="sm" variant="ghost" disabled={busy === `i-${i.id}`} onClick={async () => (await run(`i-${i.id}`, () => api.del(`/api/admin/invites/${i.id}`), 'Invite revoked.')) && invites.reload()}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} onCreated={invites.reload} />
      <ConfirmDialog
        open={!!revoking}
        title={`Revoke access for ${revoking?.displayName ?? ''}?`}
        body={revoking?.role === 'owner' ? 'They become an ordinary visitor. The server refuses if they are the last active owner.' : 'They become an ordinary visitor and lose the Develop area at once. Apps they published stay in the Store unless you take them down.'}
        confirmLabel="Revoke access"
        destructive
        busy={busy === `u-${revoking?.id}`}
        onCancel={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return
          const ok = await run(`u-${revoking.id}`, () => api.patch(`/api/admin/users/${revoking.id}`, { role: 'user' }), 'Access revoked.')
          if (ok) (setRevoking(null), users.reload())
          else setRevoking(null)
        }}
      />
    </div>
  )
}
