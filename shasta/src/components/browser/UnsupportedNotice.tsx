import { MonitorX, X } from 'lucide-react'
import { describeMissing } from '@/lib/browserSupport'
import { useCompat } from '@/stores/compatStore'
import type { Tab } from '@/lib/tabModel'

/** Shown over a page that crashed because this Chrome is too old for it (lib/browserSupport.ts), instead of a black screen. */
export function UnsupportedNotice({ tab }: { tab: Tab }) {
  const feature = useCompat((s) => s.byTab[tab.id])
  if (!feature || tab.error) return null
  const what = tab.app?.scheme === 'game' ? 'game' : tab.app ? 'app' : 'page'
  return (
    <div role="alert" className="absolute inset-x-0 top-0 z-[8] flex items-start gap-3 border-b border-shasta-line bg-shasta-field px-4 py-2 text-sm text-shasta-fg">
      <MonitorX className="mt-0.5 size-4 shrink-0 text-shasta-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{describeMissing(feature, what)}</p>
        <p className="mt-0.5 text-xs text-shasta-muted">
          Shasta can't add this: the {what} runs on this device's own Chrome. Updating Chrome fixes it (on a school device, the school decides). A device that no longer gets
          updates can't run this {what}.
        </p>
      </div>
      <button aria-label="Dismiss" onClick={() => useCompat.getState().clear(tab.id)} className="rounded-full p-1 text-shasta-muted hover:bg-shasta-hover">
        <X className="size-4" />
      </button>
    </div>
  )
}
