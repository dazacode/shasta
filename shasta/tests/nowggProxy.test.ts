import { describe, expect, it } from 'vitest'
import { nowggProxyBase } from '@/lib/nowggProxy'

describe('nowggProxyBase: each domain hands its now.gg games its own proxy', () => {
  it('a full build (Pages, own domain) offers its own /nowgg', () => {
    expect(nowggProxyBase({ protocol: 'https:', origin: 'https://shasta-dtg.pages.dev' }, true, '')).toBe('https://shasta-dtg.pages.dev/nowgg')
    expect(nowggProxyBase({ protocol: 'https:', origin: 'https://edushasta.lol' }, true, '')).toBe('https://edushasta.lol/nowgg')
  })
  it('Lite on Vercel routes /nowgg itself', () => {
    expect(nowggProxyBase({ protocol: 'https:', origin: 'https://shasta-lite.vercel.app' }, true, 'https://shasta-dtg.pages.dev')).toBe('https://shasta-lite.vercel.app/nowgg')
  })
  it('a static Lite host (Base44) offers the full site it talks to', () => {
    expect(nowggProxyBase({ protocol: 'https:', origin: 'https://shasta-lte.base44.app' }, false, 'https://shasta-dtg.pages.dev')).toBe('https://shasta-dtg.pages.dev/nowgg')
  })
  it('the installed app offers its backend, never its own isolated-app origin', () => {
    expect(nowggProxyBase({ protocol: 'isolated-app:', origin: 'isolated-app://abc' }, true, 'https://edushasta.lol')).toBe('https://edushasta.lol/nowgg')
    expect(nowggProxyBase({ protocol: 'isolated-app:', origin: 'isolated-app://abc' }, true, '')).toBeNull()
  })
})
