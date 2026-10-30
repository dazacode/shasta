// One inline advert (a Google AdSense unit) on Shasta's own pages. Renders nothing when no display provider is
// configured or the person turned ads off, so a placement can be dropped in anywhere without a layout branch.
//
// SPA note: an internal page is unmounted when its tab is not in front, so switching tabs mounts a fresh <ins> and
// fires a fresh request — more impressions, and each push targets its own element. `data-ad-filled` guards against a
// double push into the same element (React 19 StrictMode runs effects twice in dev).
import { useEffect, useRef } from 'react'
import { ADSENSE_CLIENT, ADSENSE_SLOT, HAS_DISPLAY_ADS, pushAdSense } from '@/lib/ads'
import { useSettings } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

export function AdSlot({
  slot = ADSENSE_SLOT,
  /** AdSense layout: 'auto' adapts, 'horizontal' stays short (the bottom bar), 'rectangle'/'vertical' for rails. */
  format = 'auto',
  /** reserve space so the page does not jump when the unit lands; 0 lets the unit size itself */
  minHeight = 96,
  /** the tiny "Ad" marker in the corner */
  label = true,
  className,
}: {
  slot?: string
  format?: 'auto' | 'horizontal' | 'rectangle' | 'vertical'
  minHeight?: number
  label?: boolean
  className?: string
}) {
  const on = useSettings((s) => s.settings.ads)
  const ref = useRef<HTMLModElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || el.dataset.adFilled === '1') return
    el.dataset.adFilled = '1'
    pushAdSense()
    // `on` is a dependency so turning ads back on re-pushes into the freshly mounted <ins>
  }, [slot, on])

  if (!HAS_DISPLAY_ADS || !on) return null

  return (
    <div className={cn('relative w-full', className)} data-ad-slot-wrap>
      {label && (
        <span className="pointer-events-none absolute -top-1 right-0 z-10 select-none text-[10px] font-medium uppercase tracking-wide text-shasta-muted/70">
          Ad
        </span>
      )}
      <ins
        ref={ref}
        className="adsbygoogle block w-full"
        style={{ display: 'block', minHeight: minHeight || undefined }}
        data-ad-client={ADSENSE_CLIENT}
        {...(slot ? { 'data-ad-slot': slot } : {})}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  )
}
