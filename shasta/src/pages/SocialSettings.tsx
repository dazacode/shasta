// Settings rows for Shasta social: "Friends & phone account" in Profile & data (who this computer is linked to, its
// devices, signing it out) and the "what I'm playing" switch in Privacy (PATCH me/settings, the same setting the phone
// has). Both lean on pages/social/parts.tsx; the account itself lives on the phone.
import { useState } from 'react'
import { Laptop, LogOut, Smartphone } from 'lucide-react'
import { useDevices } from '@/social/queries'
import { useSocial } from '@/social/store'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'
import { Row } from './settingsParts'
import { PresenceToggle, SocialQueries } from './social/parts'
import { PRESENCE_COPY } from './social/social'

export function SocialAccountRow() {
  return (
    <SocialQueries>
      <AccountRow />
    </SocialQueries>
  )
}

function AccountRow() {
  const status = useSocial((s) => s.status)
  const me = useSocial((s) => s.me)
  const open = useTabs.getState().openInternal
  if (status === 'off') return <Row title="Friends & phone account" desc="Friends and messages need the full Shasta site; they're off on this shared address." />
  if (status !== 'ready' || !me)
    return (
      <Row title="Friends & phone account" desc="Optional. Scan a code with your phone and it becomes your Shasta account (no password or email), with friends, messages and your Library on the phone too. Nothing about your browsing is sent.">
        <Button variant="outline" onClick={() => open('social')}>
          <Smartphone /> Continue on your phone
        </Button>
      </Row>
    )
  return (
    <>
      <Row title="Friends & phone account" desc={`This computer is linked to @${me.handle}'s phone. The account lives on the phone: profile, devices and backups are changed there.`}>
        <Button variant="outline" onClick={() => open('social', 'you')}>
          Open Social
        </Button>
      </Row>
      <DevicesRow />
    </>
  )
}

function DevicesRow() {
  const me = useSocial((s) => s.me)
  const devices = useDevices()
  const [busy, setBusy] = useState(false)
  const list = devices.data ?? []
  return (
    <div className="border-b border-shasta-line py-4 last:border-0">
      <p className="text-sm font-medium">Devices on your account</p>
      {devices.isPending ? (
        <p className="mt-1 text-sm text-shasta-muted">Loading…</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {list.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              {d.kind === 'phone' ? <Smartphone className="size-4 text-shasta-muted" aria-hidden /> : <Laptop className="size-4 text-shasta-muted" aria-hidden />}
              <span>{d.name}</span>
              {(d.id === me?.device.id || d.current) && <span className="text-shasta-muted">· this computer</span>}
              <span className="text-shasta-faint">· {d.role === 'owner' ? 'manages the account' : 'linked'}</span>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        className="mt-3"
        disabled={busy}
        onClick={async () => {
          if (!confirm('Sign out this computer? It stops getting your messages and posts. Your account stays on your phone.')) return
          setBusy(true)
          await useSocial.getState().signOut(true)
          setBusy(false)
        }}
      >
        <LogOut /> Sign out this computer
      </Button>
    </div>
  )
}

/** Settings -> Privacy: shown only while this computer is linked. */
export function SocialPrivacyRow() {
  const ready = useSocial((s) => s.status === 'ready')
  if (!ready) return null
  return (
    <Row title="Show friends what I'm playing" desc={`${PRESENCE_COPY} The same switch is on your phone.`} htmlFor="settings-presence">
      <PresenceToggle id="settings-presence" />
    </Row>
  )
}
