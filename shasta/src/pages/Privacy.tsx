// shasta://privacy — the plain-words privacy policy. Ad networks and Ezoic-style reviewers want a real one on the
// site, and Shasta's whole pitch is honesty about what leaves the device, so this doubles as the disclosure for the
// adverts (lib/ads.ts) and the stats (lib/stats.ts). Keep it in step with the Settings -> Privacy copy.
import { PageShell } from './PageShell'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-2 border-b border-shasta-line py-5 last:border-0">
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      <div className="grid gap-2 text-sm text-shasta-muted">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  const open = useTabs.getState().openInternal
  return (
    <PageShell
      title="Privacy"
      subtitle="Plain words about what stays on your device and what does not."
      actions={<Button variant="outline" onClick={() => open('settings', 'privacy')}>Privacy settings</Button>}
    >
      <div className="max-w-2xl">
        <p className="text-sm text-shasta-muted">
          Shasta has no accounts and no sign-in. Nothing about you is tied to an identity, because there is no identity
          to tie it to. This page explains the few times something does leave your device, and how to turn each one off.
        </p>

        <Section id="device" title="What stays on this device">
          <p>
            Your settings, bookmarks, history, downloads, installed apps and their saved data live in this browser only.
            Nothing about them is sent to a Shasta server. Clearing this browser's site data, using a private window, or
            switching browser or device starts you from scratch.
          </p>
          <p>You can export a profile to move them; it never includes cookies, logins, passwords, history or site data.</p>
        </Section>

        <Section id="proxy" title="Browsing, and the proxy">
          <p>
            When you open a website, Shasta can relay it through its own server so a school filter that blocks the site
            still lets it load. On the <strong className="text-shasta-fg">proxy</strong> path the operator of that server
            sees which hosts you connect to (not, for https, the contents). On the{' '}
            <strong className="text-shasta-fg">local</strong> path in the installed app, there is no relay at all.
          </p>
          <p>
            Websites you open still behave like websites: they can set their own cookies and see your IP. That is true of
            any browser. Private tabs keep their own throwaway storage and are not written into Shasta's history.
          </p>
        </Section>

        <Section id="stats" title="Shasta's own stats (anonymous, optional)">
          <p>
            Shasta counts which of its own features and pages are used, and the hostname of each site opened (for example
            <code className="mx-1 rounded bg-shasta-field px-1">example.com</code>, never the page or a search). These go
            to Shasta's own stats server, which runs Umami — not an ad or analytics company — which also sees your
            browser, device type and a rough location, and groups one browser's visits with a code that changes monthly.
            Your IP address is not stored. Private tabs are never counted.
          </p>
          <p>Turn it off in <button onClick={() => open('settings', 'privacy')} className="text-shasta-accent hover:underline">Settings → Privacy</button>.</p>
        </Section>

        <Section id="ads" title="Adverts">
          <p>
            Shasta shows adverts on its own pages (the new tab, the Store and Watch) and, if you leave it on, a thin strip
            along the bottom. They never appear inside the sites you open — those frames belong to the site itself.
          </p>
          <p>
            Adverts come from <strong className="text-shasta-fg">Google AdSense</strong> and{' '}
            <strong className="text-shasta-fg">Monetag</strong>. Unlike Shasta's own stats, these{' '}
            <em>do</em> see your IP address and set their own cookies, and they can follow you across the web to pick what
            to show. They may open a tab behind the current one (a "pop-under") and push small notifications. This is the
            part of Shasta that is not the most gentle, on purpose: it is what keeps the servers paid for.
          </p>
          <p>
            Because the pages are cross-origin isolated for the games, the advert frames load <em>credentialless</em>
            (without your cookies to the ad network). Turn adverts off entirely in{' '}
            <button onClick={() => open('settings', 'privacy')} className="text-shasta-accent hover:underline">Settings → Privacy</button>.
          </p>
        </Section>

        <Section id="watch" title="Watch and the AI">
          <p>
            Watch can route video through Shasta's server (so a blocked streaming host still plays and its CDN rules are
            met). The AI runs on your device: no prompt, file, picture or recording is ever sent to a server.
          </p>
        </Section>

        <Section id="school" title="Schools and Chromebooks">
          <p>
            The school's own web filter and network can still see and block traffic, and if a device is managed the
            administrator can see more than Shasta does. Shasta tries to be categorized as "education" so filters leave it
            alone, but that is the filter's call, not a promise.
          </p>
        </Section>

        <Section id="changes" title="Changes">
          <p>This policy is honest by design and changes when the app does. Last updated 30 October 2026.</p>
        </Section>
      </div>
    </PageShell>
  )
}
