// The account's pages under Me: games (play on a linked Chromebook, or open here), devices, privacy, deleting the
// account, and the page for parents.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Gamepad2, Laptop, MonitorPlay, Pencil, Smartphone, Trash2 } from 'lucide-react'
import type { Device, SocialSettings } from '@/social/types'
import { errorText, social } from '@/social/api'
import { socialKeys, useBlocks, useDevices } from '@/social/queries'
import { useSocial } from '@/social/store'
import { ago } from '@/social/format'
import { LIMITS } from '@/social/schemas'
import { AppIcon } from '@/components/social/ShowcaseShelf'
import { FriendRow } from '@/components/social/FriendRow'
import { Sheet } from '@/components/social/Sheet'
import { Button } from '@/components/ui/button'
import { openOnPhoneUrl, usePhoneLibrary, type PhoneApp } from '../library'
import { useNav } from '../nav'
import { BigButton, Group, Note, Row, Screen, Spinner, ToggleRow } from '../ui'
import { ParentsInfo } from './Onboarding'

const desktopsOf = (list: Device[] | undefined) => (list ?? []).filter((d) => d.kind === 'desktop')

/** Sends a game to a linked computer; picks the computer when there are several. */
function usePlayOn() {
  const devices = useDevices()
  const [status, setStatus] = useState<string | null>(null)
  const desktops = desktopsOf(devices.data)
  const play = async (device: Device, app: PhoneApp) => {
    setStatus(null)
    try {
      const r = await social.launchOn(device.id, app.appId)
      setStatus(r.ok ? `${app.name} is opening on ${device.name}.` : `${device.name} isn't online right now. Open Shasta on it, then try again.`)
    } catch (e) {
      setStatus(errorText(e))
    }
  }
  return { desktops, play, status }
}

export function LibraryScreen() {
  const library = usePhoneLibrary()
  const { desktops, play, status } = usePlayOn()
  const [choose, setChoose] = useState<PhoneApp | null>(null)
  return (
    <Screen title="My games">
      {library.isPending && <Spinner label="Loading your library…" />}
      {library.isError && <p className="text-shasta-danger">{errorText(library.error)}</p>}
      {library.data && !library.data.length && <Note>Nothing here yet. Games you install in Shasta on your Chromebook come over when you link it to this phone.</Note>}
      {status && (
        <Note className="mb-3">
          <p role="status">{status}</p>
        </Note>
      )}
      <ul className="grid gap-2">
        {library.data?.map((app) => (
          <li key={app.appId} className="flex items-center gap-3 rounded-2xl bg-shasta-home p-3 ring-1 ring-shasta-line">
            <AppIcon app={app} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{app.name}</p>
              {!app.available && <p className="text-sm text-shasta-muted">Not available right now</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {desktops.length > 0 && (
                  <Button className="h-11 px-3" disabled={!app.available} onClick={() => (desktops.length === 1 ? void play(desktops[0], app) : setChoose(app))}>
                    <MonitorPlay /> Play on {desktops.length === 1 ? desktops[0].name : 'computer'}
                  </Button>
                )}
                <a href={openOnPhoneUrl(app)} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm ring-1 ring-shasta-line">
                  <ExternalLink className="size-4" /> Open on this phone
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={!!choose} onOpenChange={(o) => !o && setChoose(null)} title={`Play ${choose?.name ?? ''} on…`}>
        <div className="grid gap-2">
          {desktops.map((d) => (
            <BigButton
              key={d.id}
              variant="secondary"
              onClick={() => {
                if (choose) void play(d, choose)
                setChoose(null)
              }}
            >
              <Laptop /> {d.name}
            </BigButton>
          ))}
        </div>
      </Sheet>
    </Screen>
  )
}

export function DevicesScreen() {
  const me = useSocial((s) => s.me)
  const devices = useDevices()
  const library = usePhoneLibrary()
  const { play, status } = usePlayOn()
  const qc = useQueryClient()
  const [renaming, setRenaming] = useState<Device | null>(null)
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Device | null>(null)
  const [playOn, setPlayOn] = useState<Device | null>(null)
  const [error, setError] = useState<string | null>(null)
  const owner = me?.device.role === 'owner' && !(me.device.limitedUntil && me.device.limitedUntil > Date.now())
  const refresh = () => qc.invalidateQueries({ queryKey: socialKeys.devices })

  const remove = async (d: Device) => {
    setError(null)
    try {
      if (d.id === me?.device.id) return void (await useSocial.getState().signOut(true))
      await social.removeDevice(d.id)
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Screen title="Devices">
      {devices.isPending && <Spinner label="Loading…" />}
      {error && (
        <p className="mb-3 text-sm text-shasta-danger" role="alert">
          {error}
        </p>
      )}
      {status && <Note className="mb-3">{status}</Note>}
      <Group footer="A newly linked computer can't add or remove devices or change backups for its first 3 days.">
        {devices.data?.map((d) => {
          const current = d.id === me?.device.id || d.current
          const limited = !!d.limitedUntil && d.limitedUntil > Date.now()
          return (
            <div key={d.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center text-shasta-muted">{d.kind === 'phone' ? <Smartphone className="size-5" /> : <Laptop className="size-5" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {d.name}
                    {current && <span className="font-normal text-shasta-muted"> · this phone</span>}
                  </p>
                  <p className="text-sm text-shasta-muted">
                    {d.role === 'owner' ? 'Can manage the account' : 'Linked'} · seen {ago(d.seenAt)}
                    {limited && ` · settling in until ${new Date(d.limitedUntil!).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 pl-11">
                {d.kind === 'desktop' && (
                  <Button className="h-11 px-3" onClick={() => setPlayOn(d)}>
                    <Gamepad2 /> Play a game on it
                  </Button>
                )}
                {(current || owner) && (
                  <Button
                    variant="outline"
                    className="h-11 px-3"
                    onClick={() => {
                      setName(d.name)
                      setRenaming(d)
                    }}
                    aria-label={`Rename ${d.name}`}
                  >
                    <Pencil />
                  </Button>
                )}
                {(current || owner) && (
                  <Button variant="outline" className="h-11 px-3" onClick={() => setRemoving(d)} aria-label={current ? 'Sign this phone out' : `Remove ${d.name}`}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </Group>
      <Sheet open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} title="Rename">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!renaming || !name.trim()) return
            try {
              await social.renameDevice(renaming.id, name.trim())
              await refresh()
              setRenaming(null)
            } catch (err) {
              setError(errorText(err))
              setRenaming(null)
            }
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, LIMITS.deviceName))} className="h-12 rounded-2xl bg-shasta-field px-4 text-base outline-none" aria-label="Device name" />
          <BigButton type="submit" disabled={!name.trim()}>
            Save
          </BigButton>
        </form>
      </Sheet>
      <Sheet
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.id === me?.device.id ? 'Sign this phone out?' : `Remove ${removing?.name ?? ''}?`}
        description={
          removing?.id === me?.device.id
            ? me?.temporary
              ? 'Your account has no backup. If this is your only phone, signing out loses the account for good.'
              : 'You can sign in again with your passkey or recovery code.'
            : 'It is signed out at once and gets nothing more from your account.'
        }
      >
        <div className="grid gap-2">
          <BigButton variant="danger" onClick={() => removing && void remove(removing)}>
            {removing?.id === me?.device.id ? 'Sign out' : 'Remove'}
          </BigButton>
          <BigButton variant="ghost" onClick={() => setRemoving(null)}>
            Cancel
          </BigButton>
        </div>
      </Sheet>
      <Sheet open={!!playOn} onOpenChange={(o) => !o && setPlayOn(null)} title={`Play on ${playOn?.name ?? ''}`} description="It opens there right away.">
        {library.data?.length ? (
          <ul className="grid gap-1">
            {library.data.map((app) => (
              <li key={app.appId}>
                <button
                  type="button"
                  disabled={!app.available}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-shasta-hover disabled:opacity-50"
                  onClick={() => {
                    if (playOn) void play(playOn, app)
                    setPlayOn(null)
                  }}
                >
                  <AppIcon app={app} size={40} /> {app.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-shasta-muted">No games on this phone yet.</p>
        )}
      </Sheet>
    </Screen>
  )
}

export function PrivacyScreen() {
  const me = useSocial((s) => s.me)
  const blocks = useBlocks()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const settings = me?.settings
  const update = async (patch: Partial<SocialSettings>) => {
    if (!me) return
    setError(null)
    const before = me.settings
    useSocial.getState().setMe({ ...me, settings: { ...me.settings, ...patch } })
    try {
      const saved = await social.settings(patch)
      const cur = useSocial.getState().me
      if (cur) useSocial.getState().setMe({ ...cur, settings: saved })
    } catch (e) {
      const cur = useSocial.getState().me
      if (cur) useSocial.getState().setMe({ ...cur, settings: before })
      setError(errorText(e))
    }
  }
  const blocked = useMemo(() => blocks.data ?? [], [blocks.data])
  if (!settings) return null
  return (
    <Screen title="Privacy">
      {error && (
        <p className="mb-3 text-sm text-shasta-danger" role="alert">
          {error}
        </p>
      )}
      <Group footer="Only your friends ever see any of this. Your profile is never public.">
        <ToggleRow label="Show what I'm playing" detail="Friends see the name of the Store game you have open on a linked computer. Never the websites you visit. Off until you turn it on." checked={settings.presence} onChange={(v) => void update({ presence: v })} />
        <ToggleRow label="Quiet hours" detail="From 10 pm to 7 am, new messages wait quietly until you open Shasta." checked={settings.quietHours} onChange={(v) => void update({ quietHours: v })} />
        <ToggleRow label="Friends see my posts" checked={settings.feedVisible} onChange={(v) => void update({ feedVisible: v })} />
        <ToggleRow label="Guestbook" detail="Friends can leave you notes. Nothing shows until you approve it." checked={settings.guestbook} onChange={(v) => void update({ guestbook: v })} />
      </Group>
      <Group title="Blocked" footer="A blocked person can't see you, message you or add you again, and isn't told.">
        {blocks.isPending ? (
          <Spinner label="Loading…" />
        ) : blocked.length ? (
          blocked.map((p) => (
            <div key={p.id} className="px-3">
              <FriendRow
                person={p}
                actions={
                  <Button
                    variant="outline"
                    className="h-11 px-3"
                    onClick={async () => {
                      await social.unblock(p.id).catch(() => {})
                      await qc.invalidateQueries({ queryKey: socialKeys.blocks })
                    }}
                  >
                    Unblock
                  </Button>
                }
              />
            </div>
          ))
        ) : (
          <Row label="Nobody" detail="You haven't blocked anyone." />
        )}
      </Group>
    </Screen>
  )
}

export function DeleteScreen() {
  const me = useSocial((s) => s.me)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = useNav((s) => s.reset)
  if (!me) return null
  const del = async () => {
    setBusy(true)
    setError(null)
    try {
      await social.deleteAccount(me.handle)
      reset('home')
      await useSocial.getState().signOut()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Screen title="Delete account">
      <p>This deletes your account right now: your profile, friends, posts, guestbook, messages and every linked device. It can't be undone.</p>
      <p className="mt-2 text-shasta-muted">Your games stay in Shasta on each device; they never needed an account.</p>
      <label className="mt-6 block text-sm text-shasta-muted" htmlFor="confirm-handle">
        Type your handle, <span className="font-mono text-shasta-fg">{me.handle}</span>, to confirm
      </label>
      <input id="confirm-handle" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="mt-1 h-12 w-full rounded-2xl bg-shasta-field px-4 text-base outline-none" />
      {error && (
        <p className="mt-2 text-sm text-shasta-danger" role="alert">
          {error}
        </p>
      )}
      <BigButton className="mt-6" variant="danger" disabled={busy || typed.trim().toLowerCase() !== me.handle.toLowerCase()} onClick={() => void del()}>
        {busy ? 'Deleting…' : 'Delete my account'}
      </BigButton>
    </Screen>
  )
}

export function ParentsScreen() {
  return (
    <Screen title="For parents">
      <ParentsInfo />
    </Screen>
  )
}
