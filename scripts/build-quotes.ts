// Builds the new tab Quote widget's library (shasta/src/lib/quotes.data.json, committed) from open-licensed GitHub
// datasets, pinned to a commit and checked by sha256 like the seasonal photos. Nothing is written by hand: every
// line, author and title comes from a source below. Run: `bun run build:quotes` (only when the sources change).
//
// Filtering, because most people reading this are at school: lines with swearing, sex, drugs or slurs are dropped,
// as are very long ones, and religion/politics/war/death topics from the big general set. Sampling is deterministic
// (by a hash of the text), so a rebuild gives the same file.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Kind = 'screen' | 'anime' | 'people' | 'philosophy' | 'motivation' | 'joke'
type Row = [Kind, string, string, string?]

interface Source {
  id: string
  name: string
  repo: string
  commit: string
  file: string
  sha256: string
  license: string
}

const SOURCES: Record<string, Source> = {
  movies: { id: 'movies', name: 'popular-movie-quotes', repo: 'NikhilNamal17/popular-movie-quotes', commit: 'f093932a7a1efa21b94a61b441d4830fdbceaeac', file: 'data/data.json', sha256: 'f6a36ddc20e215df75b8f6bf0b6fc3bffc7d0abaca5b4f22d9038bd98fb6a630', license: 'MIT' },
  anime: { id: 'anime', name: 'AniQuotesAPI', repo: 'Shineii86/AniQuotesAPI', commit: '440308cc0a84e77c25562c084abc24803ec43048', file: 'data/quotes.json', sha256: '7802e6af53c1318c57631e1fce2541f42dc09f3df1eb1f82f9bbe10772506232', license: 'MIT' },
  motivation: { id: 'motivation', name: 'inspirational-quotes', repo: 'vinitshahdeo/inspirational-quotes', commit: '8da167d5e7bd6a01e165fb737ae2df63deb2e8b3', file: 'data/data.json', sha256: '9b36f064c3050f0aed3721aad304dbeb19980bfdd2ac90d3aad1386b97307e8f', license: 'MIT' },
  general: { id: 'general', name: 'Inspirational-Quotes', repo: 'akhiltak/inspirational-quotes', commit: '76cf1b2dba84f02c3025760d9fd39b27038bc89d', file: 'Quotes.csv', sha256: '8609fc4a5c4cfb4358dca8c6ce4cd42aea625f5749011efdaa173ede52f0ac90', license: 'MIT' },
  jokes: { id: 'jokes', name: 'Official Joke API', repo: '15Dkatz/official_joke_api', commit: '2c632ed832ba0eb555ca11a5db7bdc38dffd32ea', file: 'jokes/index.json', sha256: '54a996f5966e1bb92fdb2f7ff010762e69b4941a7d09921b385b63f2d2048e37', license: 'MIT' },
}

async function fetchSource(s: Source): Promise<string> {
  const url = `https://raw.githubusercontent.com/${s.repo}/${s.commit}/${s.file}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${s.repo}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== s.sha256) throw new Error(`${s.repo}: sha256 ${got} does not match the pin`)
  return buf.toString('utf8').replace(/^﻿/, '')
}

// ---- filtering ------------------------------------------------------------------------------------------------

const BLOCK = /\b(f+u+c+k\w*|shit\w*|bitch\w*|bastard\w*|asshole\w*|ass|damn\w*|dick\w*|cock\w*|piss\w*|crap\w*|whore\w*|slut\w*|sex\w*|sexy|naked|nude\w*|porn\w*|rape\w*|orgasm\w*|virgin\w*|drunk\w*|beer|booze|wine|whisk(e)?y|vodka|cocaine|heroin|drugs?|marijuana|weed|cigarettes?|suicide|kill yourself|nigg\w*|fag\w*|retard\w*|hooker\w*|bloody|goddamn\w*|hell)\b/i
const clean = (s: string) => !BLOCK.test(s)
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/^"+|"+$/g, '').trim()
const fits = (s: string, max = 200) => s.length >= 8 && s.length <= max
const hash = (s: string) => createHash('sha1').update(s).digest('hex')

/** At most `n` rows, picked by a stable hash so a rebuild keeps the same lines. */
const sample = <T,>(rows: T[], n: number, key: (r: T) => string) => [...rows].sort((a, b) => (hash(key(a)) < hash(key(b)) ? -1 : 1)).slice(0, n)

const PHILOSOPHERS = new Set([
  'Socrates', 'Plato', 'Aristotle', 'Confucius', 'Lao Tzu', 'Seneca', 'Marcus Aurelius', 'Epictetus', 'Epicurus', 'Heraclitus', 'Friedrich Nietzsche',
  'Immanuel Kant', 'Rene Descartes', 'René Descartes', 'Jean-Paul Sartre', 'Albert Camus', 'Soren Kierkegaard', 'Søren Kierkegaard', 'Voltaire',
  'Jean-Jacques Rousseau', 'Henry David Thoreau', 'Ralph Waldo Emerson', 'Bertrand Russell', 'Arthur Schopenhauer', 'John Locke', 'David Hume',
  'Baruch Spinoza', 'Blaise Pascal', 'Michel de Montaigne', 'Ludwig Wittgenstein', 'Simone de Beauvoir', 'Hannah Arendt', 'Thomas Hobbes',
  'John Stuart Mill', 'Francis Bacon', 'Cicero', 'Diogenes', 'Pythagoras', 'Sun Tzu', 'Thales', 'Democritus', 'Alan Watts', 'Will Durant',
])
const PEOPLE_GENRES = new Set(['education', 'learning', 'knowledge', 'science', 'success', 'dreams', 'hope', 'happiness', 'change', 'experience', 'art', 'music', 'technology', 'imagination', 'inspirational', 'motivational', 'great', 'best', 'future', 'work', 'time', 'nature'])
const AVOID_GENRES = new Set(['religion', 'god', 'politics', 'government', 'war', 'death', 'marriage', 'relationship', 'romantic', 'men', 'women', 'money', 'alone', 'sad'])

async function main() {
  const out: Row[] = []
  const seen = new Set<string>()
  const add = (kind: Kind, text: string, by: string, answer?: string) => {
    const t = tidy(text)
    const key = t.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!fits(t) || !clean(t) || !clean(by) || (answer && !clean(answer)) || seen.has(key)) return false
    if (kind !== 'joke' && /^(anonymous|unknown)$/i.test(by.trim())) return false
    // fiction may fight; real-world quotes about killing or playboys stay out
    if (kind !== 'anime' && kind !== 'screen' && /\b(kill\w*|playboy)\b/i.test(t)) return false
    seen.add(key)
    out.push(answer ? [kind, t, tidy(by), tidy(answer)] : [kind, t, tidy(by)])
    return true
  }

  // movies and TV: the line and its title (the dataset's years are unreliable, so they are left out)
  const movies = JSON.parse(await fetchSource(SOURCES.movies)) as { quote: string; movie: string; type: string }[]
  for (const m of sample(movies.filter((m) => m.type === 'movie' || m.type === 'tv'), 600, (m) => m.quote)) add('screen', m.quote, m.movie)

  // anime: character and show, at most 40 per show so one series never fills the list
  const anime = JSON.parse(await fetchSource(SOURCES.anime)) as { quote: string; anime: string; character: string; language: string }[]
  const perShow = new Map<string, number>()
  for (const a of sample(anime.filter((a) => a.language === 'en'), anime.length, (a) => a.quote)) {
    const n = perShow.get(a.anime) ?? 0
    if (n >= 40) continue
    if (add('anime', a.quote, `${a.character}, ${a.anime}`)) perShow.set(a.anime, n + 1)
  }

  // motivation: the curated set first
  const motiv = JSON.parse(await fetchSource(SOURCES.motivation)) as { text: string; from: string }[]
  for (const m of motiv) if (m.from && m.from !== 'Unknown') add('motivation', m.text, m.from)

  // famous people and philosophy: the big general set (QUOTE;AUTHOR;GENRE), sorted by its genres
  const csv = (await fetchSource(SOURCES.general)).split(/\r?\n/).slice(1).map((l) => l.split(';')).filter((r) => r.length === 3)
  const usable = csv.filter(([text, by, genre]) => by && fits(tidy(text), 180) && !AVOID_GENRES.has(genre))
  const philo = usable.filter(([, by]) => PHILOSOPHERS.has(by.trim()))
  for (const [text, by] of sample(philo, 500, (r) => r[0])) add('philosophy', text, by)
  const people = usable.filter(([, by, genre]) => !PHILOSOPHERS.has(by.trim()) && PEOPLE_GENRES.has(genre))
  for (const [text, by] of sample(people, 600, (r) => r[0])) add('people', text, by)
  const more = usable.filter(([, , genre]) => genre === 'motivational' || genre === 'inspirational' || genre === 'success' || genre === 'dreams')
  let extra = 0
  for (const [text, by] of sample(more, 2000, (r) => r[0] + 'm')) if (extra < 250 && add('motivation', text, by)) extra++

  // jokes: setup + punchline, general and programming ones
  const jokes = JSON.parse(await fetchSource(SOURCES.jokes)) as { type: string; setup: string; punchline: string }[]
  for (const j of jokes) if (j.type === 'general' || j.type === 'programming' || j.type === 'dad') add('joke', j.setup, '', j.punchline)

  const counts = Object.fromEntries((['screen', 'anime', 'people', 'philosophy', 'motivation', 'joke'] as Kind[]).map((k) => [k, out.filter((r) => r[0] === k).length]))
  const file = {
    note: 'Generated by scripts/build-quotes.ts from the sources below. Do not edit by hand.',
    sources: Object.values(SOURCES).map(({ name, repo, commit, license }) => ({ name, url: `https://github.com/${repo}`, commit, license })),
    quotes: out,
  }
  const dest = join(import.meta.dir, '..', 'shasta', 'src', 'lib', 'quotes.data.json')
  writeFileSync(dest, JSON.stringify(file) + '\n')
  console.log(`wrote ${out.length} lines to ${dest}`, counts)
}

await main()
