import { useEffect, useState } from 'react'
import { ExternalLink, Heart, Server, Sparkles } from 'lucide-react'
import { PageShell } from './PageShell'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SupporterBadge } from '@/components/SupporterBadge'
import { useTabs } from '@/stores/tabsStore'
import { useSupporter, useSupporterStore } from '@/stores/supporterStore'
import { DISCORD_INVITE, MEMBERSHIP_URL, SUPPORT_URL, purgeLegacyPaymentKeys } from '@/lib/supporter'

const linkProps = { target: '_blank', rel: 'noreferrer noopener' } as const

function Done({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 rounded-xl border border-shasta-line p-4" role="status">
      <p className="font-medium">{title}</p>
      <p className="text-shasta-muted">{children}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={() => useTabs.getState().openInternal('settings', 'newtab')}>See the new tab wallpapers</Button>
        <Button variant="outline" onClick={() => useTabs.getState().openInternal('settings', 'supporter')}><Heart /> Supporter settings</Button>
      </div>
    </div>
  )
}

/** shasta://support: what keeps Shasta running and how to help. Reached on purpose only: the adverts live elsewhere. */
export default function SupportPage() {
  const sup = useSupporter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [justAdded, setJustAdded] = useState(false)

  useEffect(() => {
    purgeLegacyPaymentKeys()
  }, [])

  const redeem = async () => {
    setError('')
    const err = await useSupporterStore.getState().redeem(code)
    if (err) return setError(err)
    setCode('')
    setJustAdded(true)
  }

  const days = `${sup.daysLeft} day${sup.daysLeft === 1 ? '' : 's'}`

  return (
    <PageShell title="Support Shasta" subtitle="Shasta is free, and everything that does something stays free." actions={<SupporterBadge />}>
      <div className="grid max-w-2xl gap-6 text-sm">
        <section aria-labelledby="support-heading" className="grid gap-2">
          <h2 id="support-heading" className="flex items-center gap-2 text-base font-semibold"><Server className="size-4 text-shasta-accent" aria-hidden /> What support pays for</h2>
          <p className="text-shasta-muted">
            Every page you open in Shasta travels through Shasta's servers, and the Store, the app hosting and the AI model downloads run there too. That costs money every month, and donations go toward that hosting and bandwidth. Shasta has no accounts and no trackers of its own, but it does show adverts on its own pages (the new tab, the Store and Watch) to help pay for them. They are the one third-party thing here; the privacy policy says exactly what they see.
          </p>
          <div>
            <Button variant="outline" onClick={() => useTabs.getState().openInternal('privacy')}>Privacy policy</Button>
          </div>
        </section>

        <section aria-labelledby="support-tier" className="grid gap-3">
          <h2 id="support-tier" className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4 text-shasta-accent" aria-hidden /> Supporter</h2>

          {sup.perks ? (
            justAdded ? (
              <Done title="Code accepted. Thank you!">The extras are on for this device ({days} left on this pass). It renews on its own while your membership continues.</Done>
            ) : sup.kind === 'trial' ? (
              <Done title="You're on a free trial.">{days} left. To keep the extras after that, become a Supporter on Ko-fi and get your code with /supporter in the Discord.</Done>
            ) : (
              <Done title="You're a Supporter. Thank you!">{days} left on this device's pass. It renews on its own while your membership continues.</Done>
            )
          ) : (
            <>
              <p className="text-shasta-muted">
                Supporters get a few thank-you extras that only change how Shasta looks: extra new tab wallpapers, a small badge and early previews of new features. There are no accounts and Shasta never sees your payment. Three steps:
              </p>
              <ol className="grid gap-3">
                <li className="grid gap-2 rounded-xl border border-shasta-line p-4">
                  <h3 className="font-medium">1. Support on Ko-fi</h3>
                  <p className="text-shasta-muted">
                    <strong className="text-shasta-fg">$5 a month or $50 a year</strong> as a Ko-fi membership, for looks only. A one-off tip is a thank you and does not unlock anything. Ko-fi opens in a new tab, outside Shasta.
                  </p>
                  <div>
                    {MEMBERSHIP_URL ? (
                      <a className={buttonVariants()} href={MEMBERSHIP_URL} {...linkProps}><ExternalLink /> Support on Ko-fi</a>
                    ) : (
                      <p className="text-shasta-muted">The membership link isn't set up on this Shasta yet.</p>
                    )}
                  </div>
                </li>
                <li className="grid gap-2 rounded-xl border border-shasta-line p-4">
                  <h3 className="font-medium">2. Join the Discord</h3>
                  <p className="text-shasta-muted">
                    Connect your Discord account to Ko-fi (in Ko-fi's settings) and Ko-fi gives you the Supporter role there. Want to try the extras first? A free trial is available in the Discord with <code className="rounded bg-shasta-field px-1">/trial</code>.
                  </p>
                  {DISCORD_INVITE && (
                    <div>
                      <a className={buttonVariants({ variant: 'outline' })} href={DISCORD_INVITE} {...linkProps}><ExternalLink /> Join the Discord</a>
                    </div>
                  )}
                </li>
                <li className="grid gap-2 rounded-xl border border-shasta-line p-4">
                  <h3 className="font-medium"><label htmlFor="support-code">3. Get your code</label></h3>
                  <p className="text-shasta-muted">
                    In the Discord, run <code className="rounded bg-shasta-field px-1">/supporter</code>. The bot replies with a code that only you can see. If the bot isn't answering, message the owner there and they will send you one. Then paste it here.
                  </p>
                  <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void redeem() }}>
                    <Input id="support-code" value={code} onChange={(e) => { setCode(e.target.value); setError('') }} placeholder="SHASTA-XXXX-XXXX-XXXX" className="w-64 font-mono" spellCheck={false} autoComplete="off" aria-invalid={!!error} />
                    <Button type="submit" disabled={!code.trim() || sup.busy}>{sup.busy ? 'Checking…' : 'Redeem'}</Button>
                  </form>
                  {error && <p role="alert" className="text-shasta-danger">{error}</p>}
                  <p className="text-shasta-muted">Codes are not case-sensitive. Already have one? It also works in Settings, then Supporter.</p>
                </li>
              </ol>
            </>
          )}

          <details className="text-shasta-muted">
            <summary className="cursor-pointer select-none">What is linked to what</summary>
            <ul className="mt-2 grid list-disc gap-1 pl-5">
              <li>Shasta never sees your payment. Ko-fi handles it.</li>
              <li>Discord links your Discord account to your code on Shasta's server only, so a trial isn't repeated and a membership can end.</li>
              <li>Your browsing is never linked to the code. The code is sent to Shasta's server only to get or renew a pass; the pass is checked on this device.</li>
              <li>If you cancel on Ko-fi, the pass runs out on its own within about 5 weeks. The owner may also end it sooner.</li>
            </ul>
          </details>
        </section>

        {SUPPORT_URL && (
          <section aria-labelledby="support-tip" className="grid gap-2">
            <h2 id="support-tip" className="flex items-center gap-2 text-base font-semibold"><Heart className="size-4 text-shasta-accent" aria-hidden /> Leave a tip</h2>
            <p className="text-shasta-muted">A one-off tip is a thank you and helps just as much, but it does <strong className="text-shasta-fg">not</strong> unlock the Supporter extras (only the membership does). It opens in your own browser, outside Shasta.</p>
            <div>
              <a className={buttonVariants({ variant: 'outline' })} href={SUPPORT_URL} {...linkProps}><ExternalLink /> Tip jar</a>
            </div>
          </section>
        )}

        <p className="text-xs text-shasta-muted">Not supporting is completely fine. Shasta works the same either way.</p>
      </div>
    </PageShell>
  )
}
