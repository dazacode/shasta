// Pure helpers of the phone controller (main.ts): button bits in the browser's standard gamepad order (the same order
// lib/gameInput.ts PAD_BUTTONS uses on the window side) and how a thumb on the D-pad or stick becomes a direction.

export const BIT = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15 } as const
export type PadKey = keyof typeof BIT

export const bitOf = (k: PadKey) => 1 << BIT[k]

/**
 * A thumb at (dx, dy) from the D-pad's centre (radius r): 8 directions, so a diagonal presses two arrows like a real
 * D-pad. The middle is a dead zone, and a direction counts within 67.5° of its axis (diagonals overlap both).
 */
export function dpadBits(dx: number, dy: number, r: number): number {
  const dist = Math.hypot(dx, dy)
  if (dist < r * 0.18) return 0
  const angle = Math.atan2(dy, dx) // 0 = right, +90° = down (screen y grows downwards)
  const near = (target: number) => Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target))) <= (67.5 * Math.PI) / 180
  let bits = 0
  if (near(0)) bits |= bitOf('right')
  if (near(Math.PI / 2)) bits |= bitOf('down')
  if (near(Math.PI)) bits |= bitOf('left')
  if (near(-Math.PI / 2)) bits |= bitOf('up')
  return bits
}

/** A thumb on the analog stick: -100..100 on each axis, clamped to the stick's circle. */
export function stickAxes(dx: number, dy: number, r: number): { x: number; y: number } {
  const dist = Math.hypot(dx, dy)
  const scale = dist > r ? r / dist : 1
  return { x: Math.round(((dx * scale) / r) * 100), y: Math.round(((dy * scale) / r) * 100) }
}

/** Codes are 6 characters from an alphabet without look-alikes; what a person types is tidied the same way the server does. */
export const tidyCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
export const validCode = (code: string) => /^[A-HJKMNP-Z2-9]{6}$/.test(code)

// ---- touchpad mode (the phone as a laptop's trackpad and keys) ----------------------------------------------

/** Mouse buttons held, as a bitmask (the MouseEvent.buttons order: 1 left, 2 right, 4 middle). */
export const MOUSE = { left: 1, right: 2, middle: 4 } as const

/**
 * A finger's move on the touchpad (in phone pixels) as cursor pixels on the game: slow moves stay precise, fast flicks
 * cross the screen, like a laptop trackpad's acceleration.
 */
export function accel(d: number, speed = 1): number {
  const a = Math.abs(d)
  return Math.sign(d) * a * speed * (1.6 + Math.min(a, 40) * 0.09)
}

/** Keys the touchpad screen can hold (and that the window accepts from a phone): the ones laptop games use most. */
export const TOUCHPAD_KEYS = ['Escape', 'Tab', 'Space', 'Enter', 'ShiftLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const
