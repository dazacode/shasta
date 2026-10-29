import { describe, expect, it } from 'vitest'
import { cleanTitle, lookupQueries, lookupTerm, needsLookup, rankFacts, relevant, type Fact } from '@/ai/lookup'

const none = { attachments: false, pageChars: 0 }

describe('when to look something up', () => {
  it.each(['Who owns YouTube?', 'What is the capital of France?', 'who invented the telephone', 'when was Roblox founded', 'how many moons does Mars have', 'define photosynthesis'])('yes: %s', (q) => expect(needsLookup(q, none)).toBe(true))
  it.each(['hello', 'write me a poem', 'summarize this page', 'quiz me on this', 'What does this picture show?', 'translate that into Spanish'])('no: %s', (q) => expect(needsLookup(q, none)).toBe(false))
  it('never looks up when something is attached', () => {
    expect(needsLookup('who wrote this?', { attachments: true, pageChars: 0 })).toBe(false)
    expect(needsLookup('Who owns YouTube?', { attachments: true, pageChars: 0 })).toBe(false)
  })
  it('uses the page as the reference when it has real text ("who is he?" on a long article), but looks up for a near-empty page', () => {
    expect(needsLookup('who is he', { attachments: false, pageChars: 20_000 })).toBe(false)
    expect(needsLookup('who own it?', { attachments: false, pageChars: 90 })).toBe(true)
  })
})

describe('what to search for', () => {
  it('uses the page subject for "it", "he", "this"', () => {
    expect(lookupTerm('who own it?', 'YouTube')).toBe('YouTube')
    expect(lookupTerm('who is he', 'Kanye West - Wikipedia')).toBe('Kanye West')
    expect(lookupTerm('what is this?', 'Roblox Corporation | Home')).toBe('Roblox Corporation')
  })
  it('keeps the topic words of an ordinary question', () => {
    expect(lookupTerm('Who owns YouTube?', null)).toBe('owns youtube')
    expect(lookupTerm('What is the capital of France?', null)).toBe('capital france')
    expect(lookupTerm("who invented the telephone", null)).toBe('invented telephone')
    expect(lookupTerm("what is Mars' moon called", null)).toContain('mars')
  })
  it('gives up (no search at all) when there is no topic word', () => {
    expect(lookupTerm('who own it', null)).toBe('')
    expect(lookupTerm('what is it?', null)).toBe('')
  })
  it('cleans page titles', () => {
    expect(cleanTitle('Photosynthesis - Wikipedia')).toBe('Photosynthesis')
    expect(cleanTitle('Home | Khan Academy')).toBe('Home')
    expect(cleanTitle('YouTube')).toBe('YouTube')
    expect(cleanTitle('a-b')).toBe('a-b')
  })
})

describe('relevance', () => {
  const f = (title: string, extract: string): Fact => ({ title, extract, url: `https://en.wikipedia.org/wiki/${title}` })
  it('drops articles that are about something else', () => {
    const facts = [f('YouTube', 'YouTube is an American online video sharing platform owned by Google.'), f('Tube', 'A tube is a long hollow cylinder used for moving fluids.')]
    expect(relevant(facts, 'owns youtube').map((x) => x.title)).toEqual(['YouTube'])
    expect(relevant(facts, '')).toEqual([])
  })
})

describe('which articles to use', () => {
  const f = (title: string): Fact => ({ title, extract: `${title} is a thing that is described here at some length.`, url: `https://en.wikipedia.org/wiki/${title}` })
  it('searches the bare topic first, then the topic with the relation words', () => {
    expect(lookupQueries('What is the capital of France?', null)).toEqual(['france', 'capital france'])
    expect(lookupQueries('Who owns YouTube?', null)).toEqual(['youtube', 'owns youtube'])
    expect(lookupQueries('who is he', 'Kanye West - Wikipedia')).toEqual(['Kanye West'])
    expect(lookupQueries('who own it', null)).toEqual([])
  })
  it('puts the article named exactly like the topic first and drops repeats', () => {
    const ranked = rankFacts([f('Capital punishment in France'), f('France'), f('France'), f('Capital (French magazine)')], 'france')
    expect(ranked.map((x) => x.title)).toEqual(['France', 'Capital punishment in France', 'Capital (French magazine)'])
  })
})
