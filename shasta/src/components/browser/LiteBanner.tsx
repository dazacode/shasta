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
    <div role="note" className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-shasta-line bg-shasta-field px-4 py-1.5 text-sm text-shasta-fg">
      <span>
        This is <strong className="font-medium">Shasta Lite</strong>. Shasta AI, offline use and heavier games need the full site.
      </span>
      <a
        href={FULL_SITE}
        target="_blank"
        rel="noopener noreferrer"
        className="sh-press inline-flex h-6 items-center gap-1 rounded-md bg-shasta-accent px-2.5 font-medium text-shasta-accent-fg hover:opacity-90"
      >
        Open full Shasta <ExternalLink className="size-3.5" />
      </a>
      <button onClick={dismiss} className="grid size-6 place-items-center rounded-md text-shasta-muted transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg" aria-label="Dismiss" title="Dismiss">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
