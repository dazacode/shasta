import { describe, expect, it } from 'vitest'
import { HALF_LIFE_DAYS, decay, hasTaste, recommend, record, topFacets, type Taste } from '@/store/taste'
import type { AppCard } from '@/store/types'

const DAY = 86_400_000
const T0 = 1_800_000_000_000
const empty = (): Taste => ({ v: 1, at: T0, f: {} })

const card = (id: string, cat: string, developer = `dev-${id}`, isGame = true, genres: string[] = []): AppCard => ({
  id, slug: id, name: id, developer, store: { id: 'official', slug: 'shasta', name: 'Shasta', accent: 200, logoUrl: null, bannerUrl: null, official: true } as AppCard['store'],
  summary: '', kind: 'linked', category: { id: cat, name: cat, isGame }, genres: genres.map((g) => ({ id: g, name: g[0].toUpperCase() + g.slice(1) })), iconUrl: null, bannerUrl: null, featured: false, version: null, releasedAt: null, updatedAt: null, status: 'published',
})

describe('store taste profile', () => {
  it('learns genres and developers from events, installs counting more than views', () => {
    let t = record(empty(), card('a', 'puzzle', 'Zach'), 'view', T0)
    expect(hasTaste(t)).toBe(false)
    t = record(t, card('b', 'racing'), 'install', T0)
    expect(hasTaste(t)).toBe(true)
    expect(topFacets(t).map((f) => f.id)).toEqual(['racing', 'puzzle'])
    t = record(t, card('c', 'puzzle', 'Zach'), 'install', T0)
    expect(topFacets(t)[0].id).toBe('puzzle')
    expect(t.f['d:zach']).toBeGreaterThan(0)
  })

  it('fades: half the weight after one half-life, and tiny weights are dropped', () => {
    const t = record(empty(), card('a', 'puzzle'), 'install', T0)
    const later = decay(t, T0 + HALF_LIFE_DAYS * DAY)
    expect(later.f['c:puzzle']).toBeCloseTo(t.f['c:puzzle'] / 2)
    expect(Object.keys(decay(t, T0 + 400 * DAY).f)).toHaveLength(0)
  })

  it('an uninstall pulls a genre down but never below a small floor', () => {
    let t = record(empty(), card('a', 'horror'), 'install', T0)
    for (let i = 0; i < 10; i++) t = record(t, card('a', 'horror'), 'uninstall', T0)
    expect(t.f['c:horror']).toBe(-3)
    expect(topFacets(t)).toEqual([])
  })

  it('recommends from liked genres only, skips excluded apps and keeps the row varied', () => {
    let t = empty()
    for (let i = 0; i < 3; i++) t = record(t, card(`p${i}`, 'puzzle', 'Zach'), 'install', T0)
    t = record(t, card('r', 'racing'), 'install', T0)
    const puzzle = Array.from({ length: 10 }, (_, i) => card(`pz${i}`, 'puzzle', i < 6 ? 'Zach' : `other${i}`))
    const racing = Array.from({ length: 5 }, (_, i) => card(`rc${i}`, 'racing'))
    const shooter = [card('s1', 'shooter')]
    const picks = recommend(t, [puzzle, racing, shooter], { exclude: new Set(['pz0']), limit: 8 })
    const ids = picks.map((p) => p.app.id)
    expect(ids).not.toContain('pz0')
    expect(ids).not.toContain('s1')
    expect(ids[0]).toBe('pz1')
    expect(picks[0].reason).toMatch(/Zach|puzzle/)
    // diversity: the same developer does not take the whole row
    expect(picks.filter((p) => p.app.developer === 'Zach').length).toBeLessThan(6)
    expect(ids.some((id) => id.startsWith('rc'))).toBe(true)
  })

  it('for games, learns genres rather than the bare "Games" category, and recommends by them', () => {
    let t = empty()
    t = record(t, card('cup', 'games', 'StudioMDHR', true, ['action', 'platformer']), 'install', T0)
    expect(topFacets(t)).toEqual([{ param: 'genre', id: 'action' }, { param: 'genre', id: 'platformer' }])
    expect(t.f['c:games']).toBeLessThan(t.f['g:action'])
    const pool = [card('gr', 'games', 'DVloper', true, ['horror']), card('hm', 'games', 'Dennaton', true, ['action'])]
    const picks = recommend(t, [pool])
    expect(picks.map((p) => p.app.id)[0]).toBe('hm')
    expect(picks[0].reason).toBe('You like Action')
  })
})
