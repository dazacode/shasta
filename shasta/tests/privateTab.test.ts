import { describe, expect, it } from 'vitest'
import { inheritsPrivate, makeTab, persistableTabs, shouldRecordVisit } from '@/lib/tabModel'

describe('private tabs', () => {
  it('are off by default', () => {
    expect(makeTab('https://a.example/').private).toBe(false)
  })

  it('are left out of the saved session', () => {
    const tabs = [makeTab('https://a.example/'), makeTab('https://b.example/', { private: true }), makeTab('https://c.example/')]
    expect(persistableTabs(tabs).map((t) => t.entries[0].url)).toEqual(['https://a.example/', 'https://c.example/'])
    expect(persistableTabs([makeTab('https://b.example/', { private: true })])).toEqual([])
  })

  it('pass privacy on to tabs opened from them, unless told otherwise', () => {
    const priv = makeTab('https://a.example/', { private: true })
    const normal = makeTab('https://a.example/')
    expect(inheritsPrivate(priv)).toBe(true)
    expect(inheritsPrivate(normal)).toBe(false)
    expect(inheritsPrivate(undefined)).toBe(false)
    expect(inheritsPrivate(normal, true)).toBe(true)
    expect(inheritsPrivate(priv, false)).toBe(false)
  })

  it('never record history', () => {
    expect(shouldRecordVisit(makeTab('https://a.example/'), true)).toBe(true)
    expect(shouldRecordVisit(makeTab('https://a.example/', { private: true }), true)).toBe(false)
    expect(shouldRecordVisit(makeTab('https://a.example/'), false)).toBe(false)
  })
})
