// Social's You: your profile as friends see it, and this computer's side of the account: the "what I'm playing"
// switch, the devices on the account and signing this computer out. The phone stays the account: profile edits,
// adding devices and backups happen there.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Laptop, LogOut, Smartphone } from 'lucide-react'
import type { Device, GuestbookNote } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialKeys, useDevices, useGuestbook, useProfile } from '@/social/queries'
import { useSocial } from '@/social/store'
import { ago } from '@/social/format'
import { ProfileView, Sheet, useNow } from '@/components/social'
import { Button } from '@/components/ui/button'
import { PresenceToggle } from './parts'
import { PRESENCE_COPY, openStoreApp } from './social'

export function YouSection() {
  const me = useSocial((s) => s.me)
  const qc = useQueryClient()
  const profile = useProfile(me?.handle ?? null)
  const guestbook = useGuestbook(me?.handle ?? null)
  const devices = useDevices()
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!me) return null
  const refreshBook = () => qc.invalidateQueries({ queryKey: socialKeys.guestbook(me.handle) })
  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-10 px-8 pt-8 pb-16 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        {profile.data ? (
          <ProfileView
            className="overflow-hidden rounded-3xl ring-1 ring-shasta-line"
            profile={profile.data}
            meId={me.id}
            guestbook={guestbook.data}
            onOpenApp={openStoreApp}
            onApproveNote={async (n: GuestbookNote) => {
              await social.approveNote(n.id).catch(() => {})
              await refreshBook()
            }}
            onDeleteNote={async (n: GuestbookNote) => {
              await social.deleteNote(n.id).catch(() => {})
              await refreshBook()
            }}
            actions={<p className="text-sm text-[var(--p-muted)]">This is how your friends see you. Edit it on your phone: Me, then Edit profile.</p>}
          />
        ) : profile.isError ? (
          <p className="text-sm text-shasta-danger">{errorText(profile.error)}</p>
        ) : (
          <div className="h-[420px] rounded-3xl bg-shasta-home ring-1 ring-shasta-line" aria-label="Loading your profile" />
        )}
      </div>

      <aside className="grid content-start gap-6" aria-label="This computer">
        {me.temporary && (
          <p className="rounded-2xl bg-shasta-field p-4 text-sm">
            <span className="font-medium">Your account has no backup yet.</span> It lives on your phone only. On your phone, open Me, then Backups, and add a passkey or save a recovery code so you can't lose it.
          </p>
        )}

        <section aria-labelledby="you-presence" className="rounded-2xl bg-shasta-home p-4 ring-1 ring-shasta-line">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <label id="you-presence" htmlFor="you-presence-toggle" className="font-medium">
                Show friends what I'm playing
              </label>
              <p className="mt-1 text-sm text-shasta-muted">{PRESENCE_COPY}</p>
            </div>
            <PresenceToggle id="you-presence-toggle" />
          </div>
        </section>

        <section aria-labelledby="you-devices">
          <h2 id="you-devices" className="mb-2 text-sm font-medium">Devices on your account</h2>
          <ul className="divide-y divide-shasta-line rounded-2xl bg-shasta-home ring-1 ring-shasta-line">
            {devices.isPending && <li className="p-4 text-sm text-shasta-muted">Loading…</li>}
            {devices.isError && <li className="p-4 text-sm text-shasta-danger">{errorText(devices.error)}</li>}
            {devices.data?.map((d) => <DeviceRow key={d.id} d={d} current={d.id === me.device.id || !!d.current} />)}
          </ul>
          <p className="mt-2 text-xs text-shasta-faint">Devices are added and removed from your phone (Me, then Devices). A newly linked computer can't change devices or backups for its first 3 days.</p>
        </section>

        <section aria-label="Sign out" className="grid gap-2">
          <Button variant="outline" className="h-10 justify-self-start px-4" onClick={() => setLeaving(true)}>
            <LogOut /> Sign out this computer
          </Button>
          <p className="text-sm text-shasta-muted">Your account, friends and messages stay on your phone.</p>
        </section>
      </aside>

      <Sheet open={leaving} onOpenChange={setLeaving} title="Sign out this computer?" description="This computer stops getting your messages and posts, and it disappears from your devices. Your account stays on your phone, and you can link this computer again any time by scanning a new code.">
        <div className="grid gap-2">
          <Button
            className="h-11"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await useSocial.getState().signOut(true)
              setBusy(false)
              setLeaving(false)
            }}
          >
            Sign out
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setLeaving(false)}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

function DeviceRow({ d, current }: { d: Device; current: boolean }) {
  const now = useNow(60_000)
  const limited = !!d.limitedUntil && d.limitedUntil > now
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-8 place-items-center text-shasta-muted">{d.kind === 'phone' ? <Smartphone className="size-[18px]" aria-hidden /> : <Laptop className="size-[18px]" aria-hidden />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {d.name}
          {current && <span className="font-normal text-shasta-muted"> · this computer</span>}
        </p>
        <p className="text-sm text-shasta-muted">
          {d.role === 'owner' ? 'Manages the account' : 'Linked'} · seen {ago(d.seenAt, now)}
          {limited && ` · settling in until ${new Date(d.limitedUntil!).toLocaleDateString()}`}
        </p>
      </div>
    </li>
  )
}
