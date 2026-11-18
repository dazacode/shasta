// One Adsterra unit inside its own frame. Their tags assume a page of their own (a global `atOptions`, code that
// writes the ad into an about:blank frame next to its script), which an SPA cannot give them inline; a frame can.
//
// The frame is a data: URL, NOT srcdoc: a srcdoc frame would share Shasta's origin, and sandboxing it (no
// allow-same-origin) left every banner blank — the sandbox is inherited by their about:blank ad frame, whose cookies
// and storage then fail (measured in Chrome 2026-10-30: sealed srcdoc = 0 ad requests, data: = a filled banner).
// A data: document still gets an opaque origin of its own, so the ad code cannot reach Shasta, its storage or the
// proxied sites' cookie jar. `credentialless` lets it embed the network's frames under Shasta's COEP.
import { useEffect, useRef } from 'react'
import { ADSTERRA_HOST, ADSTERRA_NATIVE, type Banner } from '@/lib/ads'

// <body> matters: their script inserts the ad frame next to itself, and a frame left in <head> is never drawn (0x0)
const BASE = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:transparent}</style><body>'

// Tells the slot whether anything arrived, so a blocked or unfilled unit collapses instead of leaving an empty box (a
// school filter blocking the ad host is common). Their script failing to load reports at once; otherwise the check
// runs once the frame has had time to fill. The ad's own nodes are frames, images, links or a filled native container.
const REPORT_AFTER_MS = 8000
const REPORTER = `<script>(function(){var sent=0;function r(e){if(sent)return;sent=1;parent.postMessage({shastaAd:e?'empty':(document.querySelector('iframe,img,a,ins,[id^=container-] *')?'filled':'empty')},'*')}window.shastaAdFail=function(){r(1)};setTimeout(function(){r(0)},${REPORT_AFTER_MS})})()</script>`

function bannerDoc(b: Banner) {
  // the key is validated as 32 hex characters in lib/ads.ts, so nothing here can break out of the markup
  return `${BASE}${REPORTER}<script>atOptions={key:'${b.key}',format:'iframe',height:${b.height},width:${b.width},params:{}}</script><script src="${ADSTERRA_HOST}/22/${b.key}" onerror="shastaAdFail()"></script>`
}

function nativeDoc() {
  return `${BASE}${REPORTER}<script async data-cfasync="false" src="${ADSTERRA_HOST}/21/${ADSTERRA_NATIVE}" onerror="shastaAdFail()"></script><div id="container-${ADSTERRA_NATIVE}"></div>`
}

/** The documents are plain ASCII, so btoa is safe. */
const dataUrl = (html: string) => `data:text/html;base64,${btoa(html)}`

export function AdsterraFrame({ banner, nativeHeight = 280, onEmpty }: { banner: Banner | 'native'; nativeHeight?: number; onEmpty?: () => void }) {
  const native = banner === 'native'
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!onEmpty) return
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || (e.data as { shastaAd?: string })?.shastaAd !== 'empty') return
      onEmpty()
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [onEmpty])

  return (
    <iframe
      ref={frame}
      title="Advertisement"
      src={dataUrl(native ? nativeDoc() : bannerDoc(banner))}
      // Chrome's anonymous-iframe flag; React drops it when the value is '' (it treats the attribute as boolean)
      {...{ credentialless: 'true' }}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      scrolling="no"
      className="mx-auto block border-0"
      // `normal` matches the frame document's own scheme: in dark mode a mismatch makes Chrome paint the frame opaque white
      style={{ colorScheme: 'normal', ...(native ? { width: '100%', height: nativeHeight } : { width: banner.width, height: banner.height }) }}
    />
  )
}
