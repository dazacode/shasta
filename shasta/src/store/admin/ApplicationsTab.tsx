import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { useApi, timeAgo } from '../hooks'
import { Chip, LoadError, Message } from '../components'
import type { StoreApplication } from '../types'
import { Card, CopyBox, Field, ListSkeleton, textarea, useAction } from './common'

const STATES = ['pending', 'approved', 'declined'] as const
const INVITE: Record<NonNullable<StoreApplication['invite']>, string> = { open: 'invite not used yet', used: 'joined', revoked: 'invite revoked', expired: 'invite expired', gone: 'invite gone' }

function AnswerDialog({ app, as, onClose, onDone }: { app: StoreApplication | null; as: 'approve' | 'decline'; onClose: () => void; onDone: () => void }) {
  const [message, setMessage] = useState('')
  const [canPublish, setCanPublish] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const { busy, run } = useAction()
  const close = () => {
    setMessage('')
    setCanPublish(false)
    setCode(null)
    onClose()
  }
  return (
    <Dialog open={!!app} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{code ? `${app?.name} is approved` : as === 'approve' ? `Approve ${app?.name}?` : `Decline ${app?.name}?`}</DialogTitle>
          <DialogDescription>
            {code
              ? app?.via === 'discord'
                ? 'The Discord bot DMs them this single-use code. If their DMs are closed, send it to them yourself.'
                : 'Their browser picks the invite up by itself the next time they open Store → Publish. If they cleared it or use another device, send them this single-use code.'
              : as === 'approve'
                ? `Creates a single-use contributor invite (valid 14 days). ${app?.via === 'discord' ? 'The Discord bot DMs it to them with your message.' : 'They see your message on the Publish page.'}`
                : `${app?.via === 'discord' ? 'The Discord bot DMs them your message.' : 'They see your message on the Publish page.'} They can apply again later.`}
          </DialogDescription>
        </DialogHeader>
        {code ? (
          <div className="grid gap-3">
            <CopyBox value={code} />
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!app) return
              let created = ''
              const ok = await run('answer', async () => {
                if (as === 'approve') created = (await api.post<{ code: string }>(`/api/admin/applications/${app.id}/approve`, { message: message.trim(), canPublish })).code
                else await api.post(`/api/admin/applications/${app.id}/decline`, { message: message.trim() })
              })
              if (!ok) return
              onDone()
              if (created) setCode(created)
              else close()
            }}
          >
            <Field label="Message to them (optional)">
              <textarea className={textarea} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
            </Field>
            {as === 'approve' && (
              <label className="flex items-center justify-between gap-3 rounded-lg bg-shasta-field px-3 py-2 text-sm">
                <span>
                  May publish without review
                  <span className="block text-xs text-shasta-muted">Leave off for new people: you can turn it on later under Contributors.</span>
                </span>
                <Switch checked={canPublish} onCheckedChange={setCanPublish} aria-label="May publish without review" />
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant={as === 'decline' ? 'destructive' : 'default'} disabled={busy === 'answer'}>
                {as === 'approve' ? 'Approve' : 'Decline'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ApplicationsTab() {
  const [status, setStatus] = useState<(typeof STATES)[number]>('pending')
  const q = useApi<{ applications: StoreApplication[] }>(`/api/admin/applications?status=${status}`, { live: false })
  const { busy, run } = useAction()
  const [answering, setAnswering] = useState<{ app: StoreApplication; as: 'approve' | 'decline' } | null>(null)

  return (
    <div>
      <p className="mb-4 rounded-2xl bg-shasta-home px-4 py-3 text-sm text-shasta-muted ring-1 ring-shasta-line">
        People who want to publish apply from Store → Publish without an account, or with /apply in the Discord server (the bot posts every application to the channel set with /setup applications, with Approve / Decline buttons; either place can answer). Approving gives them a single-use invite; they start without “publish without review”, so their apps still come through your review queue. Answered applications are deleted after 30 days, unanswered ones after 90.
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Application status">
        {STATES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)} className="capitalize">
            {s}
          </Chip>
        ))}
      </div>
      {q.error && !q.data ? (
        <LoadError message={q.error} offline={q.offline} onRetry={q.reload} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : !q.data.applications.length ? (
        <Message icon={<Inbox className="size-5" />} title={status === 'pending' ? 'No applications waiting' : `No ${status} applications`} body={status === 'pending' ? 'When someone applies to publish, it shows up here.' : undefined} />
      ) : (
        <div className="grid gap-3">
          {q.data.applications.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="font-medium">
                    {a.name}
                    {a.contact && <span className="ml-2 text-sm font-normal text-shasta-muted">{a.contact}</span>}
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{a.about}</p>
                  {a.links && <p className="mt-1 text-sm break-all whitespace-pre-wrap text-shasta-muted">{a.links}</p>}
                  <p className="mt-1 text-xs text-shasta-muted">
                    Applied {timeAgo(a.createdAt)} {a.via === 'discord' ? 'on Discord' : 'in Shasta'}
                    {a.decidedAt && ` · answered ${timeAgo(a.decidedAt)}`}
                    {a.invite && ` · ${INVITE[a.invite]}`}
                    {a.status === 'approved' && a.canPublish && ' · may publish without review'}
                  </p>
                  {a.message && <p className="mt-1 text-xs text-shasta-muted">Your message: {a.message}</p>}
                </div>
                <div className="flex gap-2">
                  {a.status === 'pending' ? (
                    <>
                      <Button size="sm" onClick={() => setAnswering({ app: a, as: 'approve' })}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setAnswering({ app: a, as: 'decline' })}>
                        Decline
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={async () => (await run(a.id, () => api.del(`/api/admin/applications/${a.id}`), 'Application deleted.')) && q.reload()}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <AnswerDialog app={answering?.app ?? null} as={answering?.as ?? 'approve'} onClose={() => setAnswering(null)} onDone={q.reload} />
    </div>
  )
}
