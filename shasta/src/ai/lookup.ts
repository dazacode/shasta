// Fact lookup. Small models forget and invent, so for a factual question Shasta fetches the introduction of the matching
// Wikipedia article (through its own server) and gives it to the model as reference text, then shows where it came from.
// Only the topic words are sent; files, pictures, recordings and page text never are. Turned off in Settings -> AI.

export interface Fact {
  title: string
  extract: string
  url: string
}

const QUESTION = /^(who|what|when|where|which|whom|whose|how (many|much|old|tall|long|far|big|large)|is|are|was|were|did|does|do|tell me about|define)\b|\b(capital|owner|owns?|owned|founder|founded|invented|inventor|born|died|population|meaning of|definition|president|ceo|height|located|discovered)\b/i
/** the question is about what is on screen or attached, not about the world */
const ABOUT_SCREEN = /\b(this (page|article|text|file|document|pdf|image|picture|photo|video|recording|website|section)|the (page|article|text|file|document|above|picture|image)|summar|key points|attached|above|quiz|explain simply)\b/i
const PRONOUN = /\b(it|its|this|that|he|him|his|she|her|hers|they|them|their|the (site|website|page|app|company|game|person|band|team))\b/i

const STOP = new Set(
  'a an and are as at be but by for from has have how i if in into is it its of on or that the their then there these they this to was were what when where which who whom whose will with you your can could do does did about tell me please explain give make'.split(' '),
)
/** words that describe the question, not the topic: kept only to help the search when there is a real topic word too */
const WEAK = new Set('own owns owned owner capital founder founded invented inventor born died population meaning definition define president ceo height located discovered old tall long far big large many much'.split(' '))

/** Is this a question worth looking up? Questions about attached files, pictures or the page itself are not. */
export function needsLookup(question: string, ctx: { attachments: boolean; pageChars: number }): boolean {
  const q = question.trim()
  if (q.length < 4 || ctx.attachments || ABOUT_SCREEN.test(q)) return false
  if (!QUESTION.test(q)) return false
  // a page with real text is already the reference for "who is he?"; look up only when there is little or nothing to read
  if (PRONOUN.test(q) && ctx.pageChars >= 800) return false
  return true
}

/** "Kanye West - Wikipedia" -> "Kanye West"; "YouTube" stays. */
export const cleanTitle = (title: string) => title.split(/\s+[-|–—·•:]\s+/)[0].trim()

/** What to search for: the page's subject for "who owns it?", otherwise the topic words of the question. */
export function lookupTerm(question: string, pageTitle: string | null): string {
  const q = question.trim()
  if (pageTitle && PRONOUN.test(q)) {
    const t = cleanTitle(pageTitle)
    if (t.length >= 2) return t.slice(0, 80)
  }
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []).map((t) => t.replace(/['’]s$/, ''))
  const strong = tokens.filter((t) => !STOP.has(t) && !WEAK.has(t) && t.length >= 2)
  if (!strong.length) return ''
  return tokens.filter((t) => !STOP.has(t) && (strong.includes(t) || WEAK.has(t))).slice(0, 8).join(' ')
}

/** The topic words alone ("france" for "capital of France"): finds the article about the thing itself. */
export function strongTerm(term: string): string {
  return term.split(' ').filter((t) => t && !WEAK.has(t)).join(' ')
}

/** Searches to run, best first: the bare topic, then the topic with the relation words ("invented telephone"). */
export function lookupQueries(question: string, pageTitle: string | null): string[] {
  const full = lookupTerm(question, pageTitle)
  if (!full) return []
  const strong = strongTerm(full)
  return strong && strong !== full ? [strong, full] : [full]
}

/** Articles whose title is exactly the topic first (the "France" article before "Capital punishment in France"), then the rest, no repeats. */
export function rankFacts(facts: Fact[], topic: string): Fact[] {
  const t = topic.toLowerCase().trim()
  const seen = new Set<string>()
  const unique = facts.filter((f) => !seen.has(f.title) && !!seen.add(f.title))
  return [...unique.filter((f) => f.title.toLowerCase() === t), ...unique.filter((f) => f.title.toLowerCase() !== t)]
}

/** Keeps only articles that are about the thing asked for (a search can return something unrelated). */
export function relevant(facts: Fact[], term: string): Fact[] {
  const want = (term.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w) && !WEAK.has(w))
  if (!want.length) return []
  return facts.filter((f) => {
    const hay = `${f.title} ${f.extract.slice(0, 200)}`.toLowerCase()
    return want.some((w) => hay.includes(w))
  })
}

/** Runs each search and merges the answers, topic-titled articles first. */
export async function fetchFactsFor(queries: string[], signal?: AbortSignal): Promise<Fact[]> {
  if (!queries.length) return []
  const lists = await Promise.all(queries.map((q) => fetchFacts(q, signal)))
  return rankFacts(lists.flat(), queries[0]).slice(0, 2)
}

/** Asks Shasta's server (which asks Wikipedia). Any failure just means "no facts": the AI answers without them. */
export async function fetchFacts(term: string, signal?: AbortSignal): Promise<Fact[]> {
  if (!term) return []
  try {
    const lang = (navigator.language || 'en').slice(0, 2).toLowerCase()
    const res = await fetch(`/api/ai/lookup?q=${encodeURIComponent(term)}&lang=${/^[a-z]{2}$/.test(lang) ? lang : 'en'}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000) })
    if (!res.ok) return []
    const json = (await res.json()) as { facts?: Fact[] }
    return relevant(Array.isArray(json.facts) ? json.facts.slice(0, 2) : [], term)
  } catch {
    return []
  }
}
