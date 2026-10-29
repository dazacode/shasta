import { useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { acknowledgeDisclosure, classifySignIn, hasAcknowledgedDisclosure, openInHostBrowser, SIGN_IN_WARNING } from '@/lib/authGuidance'
import { ProxyDisclosureDialog } from '@/components/ProxyDisclosure'
import { useTabs } from '@/stores/tabsStore'
import { tabUrl, type Tab } from '@/lib/tabModel'

/**
 * Shown over a proxied page that looks like a sign-in page (judged from its address only). Explains the proxy trust model;
 * the first time ever it blocks the page until the person has read it. It never looks at, or touches, the page's forms.
 */
export function SignInNotice({ tab }: { tab: Tab }) {
  const url = tabUrl(tab)
  const info = classifySignIn(url)
  const [dismissedHost, setDismissedHost] = useState('')
  const [acked, setAcked] = useState(hasAcknowledgedDisclosure)
  const [learn, setLearn] = useState(false)
  if (!info.isSignIn || tab.error) return null

  const blocking = !acked
  return (
    <>
      {dismissedHost !== info.host && (
        <div role="note" className="absolute inset-x-0 top-0 z-[8] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-shasta-line bg-shasta-field px-4 py-2 text-sm text-shasta-fg">
          <ShieldAlert className="size-4 shrink-0 text-shasta-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <p>{SIGN_IN_WARNING}</p>
            {info.known && <p className="mt-0.5 text-xs text-shasta-muted"><strong>{info.known.title}.</strong> {info.known.body}</p>}
          </div>
          <button onClick={() => openInHostBrowser(url)} className="rounded-full bg-shasta-hover px-3 py-0.5 font-medium hover:bg-shasta-line">Open the original site in my browser</button>
          <button onClick={() => setLearn(true)} className="rounded-full px-3 py-0.5 text-shasta-muted hover:bg-shasta-hover">Learn more</button>
          <button aria-label="Dismiss" onClick={() => setDismissedHost(info.host)} className="rounded-full p-1 text-shasta-muted hover:bg-shasta-hover"><X className="size-4" /></button>
        </div>
      )}
      <ProxyDisclosureDialog
        open={blocking || learn}
        blocking={blocking}
        onContinue={() => (acknowledgeDisclosure(), setAcked(true))}
        onOpenOriginal={() => openInHostBrowser(url)}
        onGoBack={() => useTabs.getState().back(tab.id)}
        onClose={() => setLearn(false)}
      />
    </>
  )
}
