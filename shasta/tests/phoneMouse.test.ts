import { describe, expect, it } from 'vitest'
import { accel } from '@/pad/padInput'
import { charSpec } from '@/lib/phoneMouse'

describe('phone touchpad', () => {
  it('accelerates fast moves and keeps slow ones precise', () => {
    expect(accel(0)).toBe(0)
    expect(Math.abs(accel(1))).toBeLessThan(2)
    expect(accel(-1)).toBe(-accel(1))
    expect(accel(30) / 30).toBeGreaterThan(accel(2) / 2)
  })
  it('turns typed characters into the key presses a laptop makes', () => {
    expect(charSpec('a')).toEqual({ spec: { code: 'KeyA', key: 'a', keyCode: 65 }, shift: false })
    expect(charSpec('A')).toEqual({ spec: { code: 'KeyA', key: 'A', keyCode: 65 }, shift: true })
    expect(charSpec('7').spec.code).toBe('Digit7')
    expect(charSpec(' ').spec.code).toBe('Space')
    expect(charSpec('\b').spec.key).toBe('Backspace')
    expect(charSpec('\n').spec.key).toBe('Enter')
    expect(charSpec('é').spec.key).toBe('é')
  })
})
