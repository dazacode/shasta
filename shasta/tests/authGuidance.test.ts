import { describe, expect, it } from 'vitest'
import { classifySignIn, directOpenUrl } from '@/lib/authGuidance'

describe('classifySignIn', () => {
  it('flags well-known identity hosts with a hedged warning', () => {
    const r = classifySignIn('https://accounts.google.com/v3/signin/identifier?x=1')
    expect(r.isSignIn).toBe(true)
    expect(r.known?.body).toMatch(/often|may/i)
  })
  it('recognises login paths on any site', () => {
    expect(classifySignIn('https://example.com/login').isSignIn).toBe(true)
    expect(classifySignIn('https://example.com/users/sign-in').isSignIn).toBe(true)
    expect(classifySignIn('https://login.example.com/').isSignIn).toBe(true)
  })
  it('leaves ordinary pages alone', () => {
    expect(classifySignIn('https://example.com/blog/loginless-future').isSignIn).toBe(false)
    expect(classifySignIn('https://en.wikipedia.org/wiki/Main_Page').isSignIn).toBe(false)
    expect(classifySignIn('shasta://settings').isSignIn).toBe(false)
    expect(classifySignIn('not a url').isSignIn).toBe(false)
  })
})

describe('directOpenUrl', () => {
  it('only returns web addresses', () => {
    expect(directOpenUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(directOpenUrl('javascript:alert(1)')).toBeNull()
    expect(directOpenUrl('shasta://settings')).toBeNull()
  })
})
