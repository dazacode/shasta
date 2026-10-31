import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isControllerUrl, onLaunch } from '@/lib/launchQueue'

// node environment: a window that shows the start page of the installed app
const win: { launchQueue?: unknown } = {}

describe('launch queue (installed app opening a captured link)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', win)
    vi.stubGlobal('location', new URL('https://shasta.example/'))
  })
  afterEach(() => {
    delete win.launchQueue
    vi.unstubAllGlobals()
  })

  it('knows the controller page with or without .html', () => {
    expect(isControllerUrl(new URL('https://x.dev/pad.html?c=ABCDEF'))).toBe(true)
    expect(isControllerUrl(new URL('https://x.dev/pad?c=ABCDEF'))).toBe(true)
    expect(isControllerUrl(new URL('https://x.dev/?save=phone'))).toBe(false)
    expect(isControllerUrl(new URL('https://x.dev/~/sj/a/b/https%3A%2F%2Fe.com%2Fpad'))).toBe(false)
  })

  it('hands over a different same-origin address, ignores the current one and other origins', () => {
    let consumer: (p: { targetURL?: string }) => void = () => {}
    ;win.launchQueue = { setConsumer: (fn: typeof consumer) => (consumer = fn) }
    const seen = vi.fn()
    expect(onLaunch(seen)).toBe(true)
    consumer({ targetURL: location.href })
    consumer({ targetURL: 'https://elsewhere.example/pad.html?c=ABCDEF' })
    consumer({})
    expect(seen).not.toHaveBeenCalled()
    consumer({ targetURL: `${location.origin}/pad.html?c=ABCDEF` })
    expect(seen).toHaveBeenCalledOnce()
    expect(seen.mock.calls[0][0].pathname).toBe('/pad.html')
  })

  it('does nothing without a launch queue', () => {
    expect(onLaunch(() => {})).toBe(false)
  })
})
