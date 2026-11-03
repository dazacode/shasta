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
  it('Lite on Base44 offers its own backend function (path in the query)', () => {
    expect(nowggProxyBase({ protocol: 'https:', origin: 'https://shasta-lte.base44.app' }, true, 'https://shasta-dtg.pages.dev', '/functions/nowgg?p=')).toBe('https://shasta-lte.base44.app/functions/nowgg?p=')
  })
  it('a static Lite host with no proxy offers the full site it talks to', () => {
    expect(nowggProxyBase({ protocol: 'https:', origin: 'https://shasta-lte.base44.app' }, false, 'https://shasta-dtg.pages.dev')).toBe('https://shasta-dtg.pages.dev/nowgg')
  })
  it('the installed app offers its backend, never its own isolated-app origin', () => {
    expect(nowggProxyBase({ protocol: 'isolated-app:', origin: 'isolated-app://abc' }, true, 'https://edushasta.lol')).toBe('https://edushasta.lol/nowgg')
    expect(nowggProxyBase({ protocol: 'isolated-app:', origin: 'isolated-app://abc' }, true, '')).toBeNull()
  })
})

import { nowggCandidates, nowggProbeUrl, pickNowggBase } from '@/lib/nowggProxy'

describe('pickNowggBase: a Lite mirror depends on no single domain', () => {
  const A = 'https://shasta-dtg.pages.dev/nowgg', B = 'https://edushasta.lol/nowgg', C = 'https://shasta-lte.base44.app/functions/nowgg?p='
  const fake = (blocked: string[], delay: Record<string, number> = {}) =>
    ((url: string) => new Promise((res, rej) => setTimeout(() => (blocked.some((b) => url.startsWith(b.replace('?p=', ''))) ? rej(new Error('blocked')) : res(new Response(''))), delay[url] ?? 1))) as unknown as typeof fetch
  it('keeps the best-ranked one that answers', async () => {
    expect(await pickNowggBase([A, B, C], fake([]))).toBe(A)
    expect(await pickNowggBase([A, B, C], fake([A]))).toBe(B)
    expect(await pickNowggBase([A, B, C], fake([A, B]))).toBe(C)
    expect(await pickNowggBase([A, B, C], fake([A, B, C]))).toBeNull()
  })
  it('waits for a better-ranked answer that is slower', async () => {
    expect(await pickNowggBase([A, B], fake([], { [nowggProbeUrl(A)]: 30 }))).toBe(A)
  })
  it('candidates: own first, https only, no duplicates; probe puts the path in ?p= for Base44', () => {
    expect(nowggCandidates(B, [A, B, 'http://x', C])).toEqual([B, A, C])
    expect(nowggProbeUrl(C)).toBe(C + encodeURIComponent('/ncm/ping'))
    expect(nowggProbeUrl(A)).toBe(A + '/ncm/ping')
  })
})
