import { describe, expect, it, vi } from 'vitest'
import { semanticFit, type Embedder } from '@/ai/retrieve'

// a stand-in for the embedding model: words with the same meaning share a dimension
const CONCEPTS: Record<string, number> = { money: 0, financial: 0, cash: 0, debt: 0, troubles: 1, hardship: 1, struggle: 1, problems: 1, weather: 2, rain: 2, sunny: 2, cooking: 3, recipe: 3, flour: 3 }
const vec = (text: string) => {
  const v = [0, 0, 0, 0, 0.01]
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) if (w in CONCEPTS) v[CONCEPTS[w]] += 1
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}
const fake: Embedder = async (texts) => texts.map(vec)

const filler = (word: string, n = 40) => `${word} `.repeat(n).trim()
const doc = [
  `${filler('Rain and sunny weather alternate here', 8)}.`,
  `${filler('A recipe needs flour and patience when cooking bread', 8)}.`,
  `The family faced financial hardship and mounting debt for years. ${filler('It was a long struggle', 6)}.`,
  `${filler('Sunny weather returned in the spring with light rain', 8)}.`,
  `${filler('Cooking classes taught the recipe with flour', 8)}.`,
].join('\n\n')

describe('semanticFit', () => {
  it('returns short text untouched and never calls the model', async () => {
    const embed = vi.fn(fake)
    expect(await semanticFit('short text', 'q', 100, embed)).toEqual({ text: 'short text', trimmed: false })
    expect(embed).not.toHaveBeenCalled()
  })
  it('finds a passage by meaning when it shares no words with the question', async () => {
    const question = 'what money troubles did they have?'
    const r = await semanticFit(doc, question, 420, fake)
    expect(r.trimmed).toBe(true)
    expect(r.text).toContain('financial hardship')
    expect(r.text.length).toBeLessThanOrEqual(460)
  })
  it('falls back to shared words when the search model is unavailable or fails', async () => {
    const keyword = 'Tell me about flour and the recipe'
    expect((await semanticFit(doc, keyword, 420, async () => null)).text).toMatch(/flour/)
    expect((await semanticFit(doc, keyword, 420, async () => { throw new Error('boom') })).text).toMatch(/flour/)
    expect((await semanticFit(doc, keyword, 420, async () => [[1]])).text).toMatch(/flour/) // wrong shape
  })
  it('embeds at most a hundred pieces however long the text is', async () => {
    const huge = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} ${filler('lorem ipsum dolor', 40)}`).join('\n\n')
    const embed = vi.fn(fake)
    await semanticFit(huge, 'dolor', 2000, embed)
    expect(embed.mock.calls[0][0].length).toBeLessThanOrEqual(101)
  })
})
