import { useState } from 'react'
import { ExternalLink, Heart, RefreshCw, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Row, Toggle } from './settingsParts'
import { useSettings } from '@/stores/settingsStore'
import { useSupporter, useSupporterStore } from '@/stores/supporterStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { DISCORD_INVITE } from '@/lib/supporter'
import { DiscordQrButton } from '@/components/DiscordQr'

function statusText(s: ReturnType<typeof useSupporter>): string {
  if (s.perks) return `${s.kind === 'trial' ? 'Free trial' : 'Supporter'} · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left. Thank you!`
  if (!s.code) return 'Not a Supporter on this device. Everything in Shasta still works.'
  if (s.note === 'ended') return 'This code has ended (it expired or the membership stopped). Ads are back and the perks are off; everything else still works.'
  if (s.note === 'unsupported') return "This browser can't check Supporter passes (it lacks Ed25519 in WebCrypto), so ads stay on and the perks stay off here. Everything else works. A recent Chrome, Edge, Firefox or Safari can check them."
  if (s.note === 'invalid') return "This device couldn't confirm the pass for this code. Try “Check again”."
  return 'The pass for this code has run out. Shasta tries to renew it on its own; “Check again” does it now.'
}

/** Settings -> Supporter. Plain about what is free (everything that does something) and what the perks are (looks). */
export function SupporterSection() {
  const s = useSupporter()
  const earlyPreviews = useSettings((x) => x.settings.earlyPreviews)
  const update = useSettings((x) => x.update)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const redeem = async () => {
    setError('')
    const err = await useSupporterStore.getState().redeem(code)
    if (err) return setError(err)
    setCode('')
    useUi.getState().toast('Code added. Thank you for supporting Shasta!', { tone: 'success' })
  }

  return (
    <>
      <Row title="Status" desc={statusText(s)}>
        {s.perks && <span className="inline-flex items-center gap-1 rounded-full bg-shasta-accent/15 px-2.5 py-1 text-xs font-medium text-shasta-accent"><Heart className="size-3 fill-current" aria-hidden /> {s.kind === 'trial' ? 'Trial' : 'Supporter'}</span>}
        {s.code && !s.perks && (
          <Button variant="outline" disabled={s.busy} onClick={() => void useSupporterStore.getState().refresh({ force: true })}>
            <RefreshCw /> {s.busy ? 'Checking…' : 'Check again'}
          </Button>
        )}
      </Row>
      {s.code && (
        <Row title="Code on this device" desc={s.code}>
          <Button variant="outline" onClick={() => { if (confirm('Remove the Supporter code from this device? Ads come back and the perks turn off here. You can add the code again later while it is still valid.')) useSupporterStore.getState().remove() }}>
            <Trash2 /> Remove from this device
          </Button>
        </Row>
      )}

      <Row title={s.code ? 'Use a different code' : 'Add a code'} desc="Codes look like SHASTA-XXXX-XXXX-XXXX. Letters are not case-sensitive." htmlFor="sup-code">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void redeem() }}>
          <Input id="sup-code" value={code} onChange={(e) => { setCode(e.target.value); setError('') }} placeholder="SHASTA-XXXX-XXXX-XXXX" className="w-64 font-mono" spellCheck={false} autoComplete="off" aria-invalid={!!error} />
          <Button type="submit" disabled={!code.trim() || s.busy}>{s.busy ? 'Checking…' : 'Redeem'}</Button>
        </form>
        {error && <p role="alert" className="basis-full text-sm text-shasta-danger">{error}</p>}
      </Row>

      <Row title="Early previews" desc={s.perks ? 'Try new features before everyone else when there are some to try. Nothing is in preview right now.' : 'A Supporter perk: try new features before everyone else.'} htmlFor="sup-early">
        <Toggle id="sup-early" label="Early previews" checked={s.perks && earlyPreviews} onChange={(v) => (s.perks ? update({ earlyPreviews: v }) : useUi.getState().toast('Early previews are a Supporter perk.'))} />
      </Row>

      <section className="border-t border-shasta-line py-4" aria-labelledby="sup-what">
        <h3 id="sup-what" className="mb-2 text-sm font-medium">What is free, what is a perk</h3>
        <ul className="max-w-2xl list-disc space-y-1 pl-5 text-sm text-shasta-muted">
          <li><strong className="text-shasta-fg">Free for everyone, always:</strong> browsing, tabs, bookmarks, the Store and every app and game in it, Shasta AI, settings, profiles. Nothing that does something is ever locked.</li>
          <li><strong className="text-shasta-fg">Supporter perks:</strong> no ads anywhere in Shasta (the only way to turn them off), plus extra new tab wallpapers, a small Supporter badge, and early previews of new features.</li>
          <li>Supporting is optional and helps pay for the servers that run Shasta.</li>
        </ul>
      </section>

      <section className="border-t border-shasta-line py-4" aria-labelledby="sup-how">
        <h3 id="sup-how" className="mb-2 text-sm font-medium">How to get a code or a trial</h3>
        <p className="max-w-2xl text-sm text-shasta-muted">
          Pay for the <strong className="text-shasta-fg">membership on Ko-fi</strong> ($5 a month), connect Discord to Ko-fi to get the Supporter role, then run <code className="rounded bg-shasta-field px-1">/supporter</code> in Shasta's Discord. The bot sends you a code; paste it above. <code className="rounded bg-shasta-field px-1">/trial</code> there gives a free trial. If the bot isn't answering, ask the owner for a code.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => useTabs.getState().openInternal('support')}>
            <Heart /> Become a Supporter
          </Button>
          {DISCORD_INVITE && (
            <a className={buttonVariants({ variant: 'outline' })} href={DISCORD_INVITE} target="_blank" rel="noreferrer noopener">
              <ExternalLink /> Join the Discord
            </a>
          )}
          <DiscordQrButton />
        </div>
      </section>

      <section className="border-t border-shasta-line py-4" aria-labelledby="sup-privacy">
        <h3 id="sup-privacy" className="mb-2 text-sm font-medium">What is linked to what</h3>
        <ul className="max-w-2xl list-disc space-y-1 pl-5 text-sm text-shasta-muted">
          <li>Shasta never sees your payment. Ko-fi handles it.</li>
          <li>Discord links your Discord account to your code on Shasta's server only, so a trial isn't repeated and a membership can end.</li>
          <li>Your browsing is never linked to the code. The code is only sent to Shasta's server to get or renew a pass; the pass is checked here, on this device.</li>
          <li>If you cancel on Ko-fi, the pass runs out on its own within about 5 weeks. The owner may also end it sooner.</li>
          <li>The code and the pass are kept in this browser only. They are not included when you export a profile.</li>
        </ul>
      </section>
    </>
  )
}
