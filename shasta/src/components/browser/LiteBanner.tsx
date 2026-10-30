import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { FULL_SITE, LITE } from '@/lib/edition'

const KEY = 'shasta-lite-banner'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Shasta Lite only: says what is missing here and where the whole of Shasta is. Dismissed per device. */
export function LiteBanner() {
  const [hidden, setHidden] = useState(wasDismissed)
  if (!LITE || hidden) return null
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* private window: hidden for this visit only */
    }
    setHidden(true)
  }
  return (
    <div role="note" className="flex items-center justify-center gap-3 border-t border-shasta-line bg-shasta-field px-4 py-1.5 text-sm text-shasta-fg">
      <span>
        This is <strong>Shasta Lite</strong>. Shasta AI, offline use and heavier games need the full site.
      </span>
      <a
        href={FULL_SITE}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-full bg-shasta-accent px-3 py-0.5 font-medium text-white hover:opacity-90"
      >
        Open full Shasta <ExternalLink className="size-3.5" />
      </a>
      <button onClick={dismiss} className="rounded-full p-1 text-shasta-muted hover:bg-shasta-hover" aria-label="Dismiss" title="Dismiss">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
