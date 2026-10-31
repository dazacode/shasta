import { describe, expect, it } from 'vitest'
import { BIT, bitOf, dpadBits, stickAxes, tidyCode, validCode } from '@/pad/padInput'
import { PAD_BUTTONS } from '@/lib/gameInput'

describe('phone controller input', () => {
  it('uses the same button order as the window side', () => {
    expect(Object.keys(BIT)).toEqual([...PAD_BUTTONS])
  })
  it('reads a thumb on the D-pad as 8 directions with a dead centre', () => {
    const r = 100
    expect(dpadBits(0, 0, r)).toBe(0)
    expect(dpadBits(5, -5, r)).toBe(0)
    expect(dpadBits(0, -80, r)).toBe(bitOf('up'))
    expect(dpadBits(80, 0, r)).toBe(bitOf('right'))
    expect(dpadBits(-70, 70, r)).toBe(bitOf('left') | bitOf('down'))
    expect(dpadBits(80, -20, r)).toBe(bitOf('right'))
  })
  it('clamps the stick to its circle', () => {
    expect(stickAxes(0, 0, 100)).toEqual({ x: 0, y: 0 })
    expect(stickAxes(50, 0, 100)).toEqual({ x: 50, y: 0 })
    expect(stickAxes(300, 0, 100)).toEqual({ x: 100, y: 0 })
    expect(stickAxes(-300, 300, 100)).toEqual({ x: -71, y: 71 })
  })
  it('tidies typed codes and rejects look-alike letters', () => {
    expect(tidyCode(' ab-cd 23 ')).toBe('ABCD23')
    expect(validCode('ABCD23')).toBe(true)
    expect(validCode('ABCD0O')).toBe(false)
    expect(validCode('ABC')).toBe(false)
  })
})
