import { ExternalLink, MessagesSquare } from 'lucide-react'
import { PageShell } from './PageShell'
import { buttonVariants } from '@/components/ui/button'
import { DISCORD_INVITE } from '@/lib/supporter'
import { DiscordQrButton, DiscordQrCard } from '@/components/DiscordQr'

/** shasta://discord: one place that points at the community server. The invite lives in DISCORD_INVITE (lib/supporter.ts). */
export default function DiscordPage() {
  return (
    <PageShell title="Discord" subtitle="Ask questions, share games and apps, get help, and hang out with other Shasta users.">
      <div className="grid max-w-2xl gap-4 text-sm">
        {DISCORD_INVITE ? (
          <>
            <p className="text-shasta-muted">Our Discord is where updates, support and the community live. The link opens Discord in a new tab, or scan the code to join on your phone.</p>
            <div className="flex flex-wrap gap-2">
              <a className={buttonVariants()} href={DISCORD_INVITE} target="_blank" rel="noreferrer noopener">
                <MessagesSquare /> Join the Discord <ExternalLink />
              </a>
              <DiscordQrButton />
            </div>
            <DiscordQrCard className="max-w-md" />
          </>
        ) : (
          <p className="text-shasta-muted">The Discord link is not set up in this build.</p>
        )}
      </div>
    </PageShell>
  )
}
