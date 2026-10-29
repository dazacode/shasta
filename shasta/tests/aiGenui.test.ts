import { afterEach, describe, expect, it, vi } from 'vitest'

// OpenUI's parser reports anonymous usage from Node-like runtimes (never from a browser window). Keep tests offline and
// prove that nothing is sent while parsing.
vi.hoisted(() => {
  process.env.DO_NOT_TRACK = '1'
})
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'))
afterEach(() => fetchSpy.mockClear())

import { createParser } from '@openuidev/react-lang'
import { GENUI_COMPONENTS, genuiLibrary } from '@/ai/genui/library'
import { decideVisual, extractOpenUi, genuiPrompt, looksLikeOpenUi, plainFromOpenUi, wantsVisual } from '@/ai/genui/prompt'

const parser = createParser(genuiLibrary.toJSONSchema(), genuiLibrary.root)
const EXAMPLE = 'root = Stack([Heading("Planets"), Table(["Planet","Moons"], [["Earth","1"],["Mars","2"]]), Callout("Mars has two moons.", "tip")])'

describe('the prompt given to the model', () => {
  it("only names components that exist, and its example parses with OpenUI's own parser", () => {
    const names = new Set(GENUI_COMPONENTS.map((c) => c.name))
    for (const small of [true, false]) {
      const p = genuiPrompt(small)
      const used = [...p.matchAll(/\b([A-Z][A-Za-z]+)\(/g)].map((m) => m[1])
      expect(used.length).toBeGreaterThan(5)
      for (const n of used) expect(names.has(n)).toBe(true)
    }
    const r = parser.parse(EXAMPLE)
    expect(r.root?.typeName).toBe('Stack')
    expect(r.meta.errors).toEqual([])
    expect(genuiPrompt(false)).toContain(EXAMPLE)
  })
  it('is short enough for a 2k-token model', () => {
    expect(genuiPrompt(true).length).toBeLessThan(1100)
    expect(genuiPrompt(false).length).toBeLessThan(1500)
  })
})

describe('reading a model answer', () => {
  it('draws every component we ship from a plausible program', () => {
    const src = [
      'root = Stack([Heading("Cells"), Text("A cell is small."), List(["a","b"], true), Steps(["one","two"]), Cards([Card("A","x"), Card("B","y")]),',
      'Stats([Stat("Moons", 2), Stat("Days", "687")]), BarChart(["A","B"], [3, 5], "kg"), Quiz("2+2?", ["3","4"], 1, "Basic."), Flashcard("Q","A"),',
      'Timeline([Event("1900","Start"), Event("1950","Later")]), Callout("Careful","warning","Note")])',
    ].join('\n')
    const r = parser.parse(src)
    expect(r.meta.errors).toEqual([])
    expect(r.root?.typeName).toBe('Stack')
  })
  it('recognises programs, including ones wrapped in fences or preceded by chatter', () => {
    expect(looksLikeOpenUi(EXAMPLE)).toBe(true)
    expect(looksLikeOpenUi('Sure!\n```openui\n' + EXAMPLE + '\n```')).toBe(true)
    expect(looksLikeOpenUi('The root = 3 here')).toBe(false)
    expect(looksLikeOpenUi('Paris is the capital of France.')).toBe(false)
    expect(extractOpenUi('Sure!\n```openui\n' + EXAMPLE + '\n```\nHope that helps!')).toBe(EXAMPLE)
  })
  it('keeps multi-statement programs and drops a closing remark', () => {
    const src = 'root = Stack([a, b])\na = Heading("Hi")\nb = Text("There")\nThat is all.'
    expect(extractOpenUi(src)).toBe('root = Stack([a, b])\na = Heading("Hi")\nb = Text("There")')
    expect(parser.parse(extractOpenUi(src)).meta.errors).toEqual([])
  })
  it('turns a program into plain words for the conversation history', () => {
    expect(plainFromOpenUi(EXAMPLE)).toBe('Planets. Planet. Moons. Earth. 1. Mars. 2. Mars has two moons.. tip')
  })
  it('tolerates an unknown component by rendering what it can', () => {
    const r = parser.parse('root = Stack([Heading("Hi"), Banana("x")])')
    expect(r.root?.typeName).toBe('Stack')
    expect(r.meta.errors.some((e) => e.code === 'unknown-component')).toBe(true)
  })
})

describe('when to answer visually', () => {
  it.each(['Compare cats and dogs', 'make a table of the planets', 'give me a timeline of WW2', 'How do I solve quadratic equations?', 'Quiz me on fractions', 'pros and cons of solar power', 'a study plan for finals'])('yes: %s', (q) => expect(wantsVisual(q)).toBe(true))
  it.each(['hello', 'What is the capital of France?', 'Why is the sky blue?', 'explain photosynthesis'])('no: %s', (q) => expect(wantsVisual(q)).toBe(false))
})

describe('deciding', () => {
  it('follows the setting, and never draws a picture answer', () => {
    expect(decideVisual('off', 'compare a and b', false)).toBe(false)
    expect(decideVisual('always', 'hello', false)).toBe(true)
    expect(decideVisual('always', 'hello', true)).toBe(false)
    expect(decideVisual('auto', 'compare a and b', false)).toBe(true)
    expect(decideVisual('auto', 'hello', false)).toBe(false)
    // the Light model is too small for auto; "always" still lets it try
    expect(decideVisual('auto', 'compare a and b', false, false)).toBe(false)
    expect(decideVisual('always', 'hello', false, false)).toBe(true)
  })
})

it('ships an app bundle without any telemetry address', async () => {
  const { readFileSync } = await import('node:fs')
  const bundle = readFileSync(new URL('../../apps/shasta-ai/openui.js', import.meta.url), 'utf8')
  expect(bundle.length).toBeGreaterThan(10_000)
  expect(bundle).not.toMatch(/cloudfront|posthog\.com/i)
})

it('never sends anything over the network', () => {
  parser.parse(EXAMPLE)
  genuiLibrary.prompt({ preamble: 'x' })
  expect(fetchSpy).not.toHaveBeenCalled()
})
