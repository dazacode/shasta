// One inline advert on Shasta's own pages: an AdSense unit when the build has AdSense, otherwise the Adsterra banner
// that fits the space. Renders nothing when no display provider is configured or this is a supporter's device, so a
// placement can be dropped in anywhere without a layout branch.
//
// SPA note: an internal page is unmounted when its tab is not in front, so switching tabs mounts a fresh unit and
// fires a fresh request — more impressions, and each push targets its own element. `data-ad-filled` guards against a
// double AdSense push into the same element (React 19 StrictMode runs effects twice in dev).
import { useEffect, useRef, useState } from 'react'
import {
  ADSENSE_CLIENT,
  ADSENSE_SLOT,
  ADSTERRA_NATIVE,
  HAS_DISPLAY_ADS,
  adsAvailable,
  pickBanner,
  pushAdSense,
  useAdsOn,
} from '@/lib/ads'
import { cn } from '@/lib/utils'
import { AdsterraFrame } from './AdsterraFrame'

type Format = 'auto' | 'horizontal' | 'rectangle' | 'vertical' | 'native'

/** Adsterra sizes per placement shape, best first; the first one this build has that fits the width wins. */
const SIZES: Record<Exclude<Format, 'native'>, string[]> = {
  auto: ['728x90', '468x60', '320x50'],
  horizontal: ['728x90', '468x60', '320x50'],
  rectangle: ['300x250', '320x50'],
  vertical: ['160x600', '160x300'],
}

export function AdSlot({
  slot = ADSENSE_SLOT,
  /** 'auto' adapts, 'horizontal' stays short (the bottom bar), 'rectangle'/'vertical' for rails, 'native' = a native
   *  unit where the network has one (AdSense treats it as 'auto') */
  format = 'auto',
  /** reserve space so the page does not jump when the unit lands; 0 lets the unit size itself */
  minHeight = 96,
  /** the tiny "Ad" marker in the corner */
  label = true,
  className,
}: {
  slot?: string
  format?: Format
  minHeight?: number
  label?: boolean
  className?: string
}) {
  const on = useAdsOn()
  const ref = useRef<HTMLModElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el || el.dataset.adFilled === '1') return
    el.dataset.adFilled = '1'
    pushAdSense()
    // `on` is a dependency so turning ads back on re-pushes into the freshly mounted <ins>
  }, [slot, on])

  // Adsterra units have fixed sizes, so the slot measures itself to pick one that fits
  useEffect(() => {
    const el = wrap.current
    if (!el || ADSENSE_CLIENT) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [on])

  if (!HAS_DISPLAY_ADS || !on) return null

  if (!ADSENSE_CLIENT) {
    if (!adsAvailable()) return null
    const banner = format === 'native' && ADSTERRA_NATIVE ? 'native' : pickBanner(SIZES[format === 'native' ? 'auto' : format], width)
    return (
      <div ref={wrap} className={cn('relative w-full', className)} data-ad-slot-wrap>
        {banner && label && (
          <span className="pointer-events-none absolute -top-1 right-0 z-10 select-none text-[10px] font-medium uppercase tracking-wide text-shasta-muted/70">
            Ad
          </span>
        )}
        {banner && <AdsterraFrame banner={banner} />}
      </div>
    )
  }

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
        data-ad-format={format === 'native' ? 'auto' : format}
        data-full-width-responsive="true"
      />
    </div>
  )
}
