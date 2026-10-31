import { describe, expect, it } from 'vitest'
import { DEFAULT_PAD, cleanHint, controlsKey, defaultControls, detectEngine, diffKeys, isDefaultControls, keyLabel, keySpec, normalizeControls, padKeys, remapKey } from '@/lib/gameInput'

describe('keySpec', () => {
  it('gives key, code and the legacy keyCode games read', () => {
    expect(keySpec('ArrowUp')).toEqual({ code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 })
    expect(keySpec('Space')).toEqual({ code: 'Space', key: ' ', keyCode: 32 })
    expect(keySpec('KeyW')).toEqual({ code: 'KeyW', key: 'w', keyCode: 87 })
    expect(keySpec('KeyW', true)?.key).toBe('W')
    expect(keySpec('Digit7')).toEqual({ code: 'Digit7', key: '7', keyCode: 55 })
    expect(keySpec('MediaPlayPause')).toBeNull()
  })
  it('labels keys for people', () => {
    expect(keyLabel('ArrowLeft')).toBe('←')
    expect(keyLabel('KeyQ')).toBe('Q')
    expect(keyLabel(null)).toBe('—')
  })
})

describe('normalizeControls', () => {
  it('keeps only known keys and buttons from stored data', () => {
    const c = normalizeControls({ keys: { KeyW: 'ArrowUp', Bogus: 'KeyA', KeyA: 'Nope', KeyS: 'KeyS' }, pad: { a: 'KeyJ', b: null, x: 42, zz: 'KeyA' }, padToKeys: false, stickAsDpad: 'yes' })
    expect(c.keys).toEqual({ KeyW: 'ArrowUp' })
    expect(c.pad.a).toBe('KeyJ')
    expect(c.pad.b).toBeNull()
    expect(c.pad.x).toBe(DEFAULT_PAD.x)
    expect(c.padToKeys).toBe(false)
    expect(c.stickAsDpad).toBe(true)
  })
  it('falls back to the defaults for garbage', () => {
    expect(normalizeControls('nope')).toEqual(defaultControls())
    expect(isDefaultControls(normalizeControls(null))).toBe(true)
  })
})

describe('remapKey', () => {
  it('only remaps what the profile names', () => {
    const c = { ...defaultControls(), keys: { KeyW: 'ArrowUp' } }
    expect(remapKey(c, 'KeyW')).toBe('ArrowUp')
    expect(remapKey(c, 'KeyA')).toBeNull()
    expect(remapKey(c, 'toString')).toBeNull()
    expect(remapKey(null, 'KeyW')).toBeNull()
  })
})

describe('padKeys', () => {
  const c = defaultControls()
  it('turns held buttons into held keys', () => {
    const buttons = Array(17).fill(0)
    buttons[0] = 1 // A
    buttons[9] = 1 // Start
    expect(padKeys(c, buttons, [0, 0])).toEqual(new Set(['Space', 'Enter']))
  })
  it('treats a half-pressed trigger as pressed and a light touch as not', () => {
    const buttons = Array(17).fill(0)
    buttons[6] = 0.7
    buttons[7] = 0.2
    expect(padKeys(c, buttons, [])).toEqual(new Set(['ShiftLeft']))
  })
  it('moves the left stick like the D-pad past the dead zone', () => {
    expect(padKeys(c, [], [-0.9, 0.1])).toEqual(new Set(['ArrowLeft']))
    expect(padKeys(c, [], [0.3, -0.3])).toEqual(new Set())
    expect(padKeys({ ...c, stickAsDpad: false }, [], [-0.9, 0])).toEqual(new Set())
  })
  it('skips buttons with no key', () => {
    const buttons = Array(17).fill(0)
    buttons[10] = 1
    expect(padKeys(c, buttons, []).size).toBe(0)
  })
})

describe('diffKeys', () => {
  it('lists presses and releases', () => {
    expect(diffKeys(new Set(['ArrowUp', 'Space']), new Set(['Space', 'KeyX']))).toEqual({ down: ['KeyX'], up: ['ArrowUp'] })
  })
})

describe('controlsKey', () => {
  it('uses the Store app, else the site', () => {
    expect(controlsKey({ app: { scheme: 'game', slug: 'slope' } }, 'example.com')).toBe('game:slope')
    expect(controlsKey({ app: null }, 'example.com')).toBe('site:example.com')
    expect(controlsKey({ app: null }, '')).toBeNull()
  })
})

describe('players and engines', () => {
  it('knows an engine from the page address', () => {
    expect(detectEngine('https://archive.org/embed/pacman')).toBe('mame')
    expect(detectEngine('https://www.lexaloffle.com/bbs/widget.php?pid=celeste')).toBe('pico8')
    expect(detectEngine('https://poki.com/en/g/rooftop-snipers')).toBe('generic')
    expect(detectEngine('not a url')).toBe('generic')
  })
  it('gives each player their own keys: two players share one keyboard', () => {
    const generic = defaultControls()
    expect(generic.pad.up).toBe('ArrowUp')
    expect(generic.players[0]?.up).toBe('KeyW')
    expect(generic.players[1]).toBeNull()
    // player 1's and player 2's keys never overlap, so both can be held at once
    const p1 = new Set(Object.values(generic.pad).filter(Boolean))
    expect(Object.values(generic.players[0]!).filter((k) => k && p1.has(k))).toEqual([])
    const mame = defaultControls('mame')
    expect([mame.pad.a, mame.players[0]?.up, mame.players[0]?.a, mame.players[0]?.start]).toEqual(['ControlLeft', 'KeyR', 'KeyA', 'Digit2'])
    const pico = defaultControls('pico8')
    expect([pico.pad.a, pico.players[0]?.left, pico.players[0]?.a, pico.players[0]?.b]).toEqual(['KeyZ', 'KeyS', 'ShiftLeft', 'KeyQ'])
  })
  it('applies a curated layout over the engine defaults', () => {
    const c = defaultControls('generic', { players: [{ a: 'KeyW', b: 'KeyE' }, { a: 'KeyI', b: 'KeyO' }] })
    expect([c.pad.a, c.pad.b, c.pad.up]).toEqual(['KeyW', 'KeyE', 'ArrowUp'])
    expect([c.players[0]?.a, c.players[0]?.b, c.players[0]?.up]).toEqual(['KeyI', 'KeyO', 'KeyW'])
    expect(defaultControls('generic', { engine: 'mame' }).pad.a).toBe('ControlLeft')
  })
  it('sends a player\'s buttons with that player\'s keys', () => {
    const c = defaultControls()
    const a = Array(17).fill(0)
    a[0] = 1
    expect(padKeys(c, a, [], 1)).toEqual(new Set(['Space']))
    expect(padKeys(c, a, [], 2)).toEqual(new Set(['KeyG']))
    expect(padKeys(c, a, [-1, 0], 2)).toEqual(new Set(['KeyG', 'KeyA']))
    expect(padKeys(c, a, [], 3).size).toBe(0)
  })
  it('reads saved players against the game\'s defaults and keeps a cleared player cleared', () => {
    const base = defaultControls('mame')
    const c = normalizeControls({ players: [null, { a: 'KeyJ' }] }, base)
    expect(c.players[0]).toBeNull()
    expect(c.players[1]?.a).toBe('KeyJ')
    expect(isDefaultControls(normalizeControls({}, base), base)).toBe(true)
    expect(isDefaultControls(c, base)).toBe(false)
  })
  it('accepts only real buttons and keys from a curated hint', () => {
    expect(cleanHint({ engine: 'pico8', players: [{ a: 'KeyW', jump: 'KeyX', b: 'F13' }, 'x'] })).toEqual({ engine: 'pico8', players: [{ a: 'KeyW' }, null] })
    expect(cleanHint({ engine: 'n64' })).toBeNull()
    expect(cleanHint(null)).toBeNull()
  })
})
