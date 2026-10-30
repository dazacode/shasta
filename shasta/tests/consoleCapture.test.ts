import { describe, expect, it } from 'vitest'
import { _flush, captureConsole, useConsole } from '@/lib/consoleCapture'

function fakeWindow() {
  const listeners: Record<string, (e: unknown) => void> = {}
  const seen: unknown[][] = []
  const con = { log: (...a: unknown[]) => seen.push(a), info() {}, warn() {}, error() {}, debug() {} }
  const win = { console: con, addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f) } as unknown as Window
  return { win, con, listeners, seen }
}

describe('consoleCapture', () => {
  it('copies console calls, keeps the original working and formats values', () => {
    useConsole.getState().clear()
    const { win, con, seen } = fakeWindow()
    captureConsole(win, 'example.com')
    captureConsole(win, 'example.com') // twice is a no-op
    con.log('%cHello', 'color:red', { a: 1, b: [1, 'x'] })
    con.warn('careful')
    _flush()
    expect(seen).toHaveLength(1)
    const e = useConsole.getState().entries
    expect(e.map((x) => [x.level, x.source, x.text])).toEqual([
      ['log', 'example.com', 'Hello {a: 1, b: [1, "x"]}'],
      ['warn', 'example.com', 'careful'],
    ])
  })

  it('records uncaught errors and rejections without the query string', () => {
    useConsole.getState().clear()
    const { win, listeners } = fakeWindow()
    captureConsole(win, () => 'game.io')
    listeners.error({ error: { name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at f' }, filename: 'https://game.io/a.js?token=1', lineno: 3 })
    listeners.unhandledrejection({ reason: 'nope' })
    _flush()
    expect(useConsole.getState().entries.map((x) => x.text)).toEqual(['Uncaught TypeError: x is undefined\n    at f (https://game.io/a.js:3)', 'Uncaught (in promise) nope'])
  })
})
