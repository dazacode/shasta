// Small wording helpers shared by the social screens: times, moods, nudge and report copy. Plain, friendly words;
// no counts, no streaks.
import type { Mood, NudgeKind, ReportReason } from './types'

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "for 20 min" since a presence's (5-minute rounded) start */
export function playingFor(since: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - since) / 60_000))
  if (m < 5) return 'just started'
  if (m < 60) return `for ${m} min`
  const h = Math.floor(m / 60)
  return `for ${h} h${m % 60 >= 5 ? ` ${m % 60} min` : ''}`
}

export const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export const MOODS: Record<Mood, string> = {
  happy: 'Happy',
  chill: 'Chill',
  hyped: 'Hyped',
  tired: 'Tired',
  focused: 'Focused',
  gaming: 'Gaming',
  sad: 'A bit down',
  silly: 'Silly',
}
export const MOOD_IDS = Object.keys(MOODS) as Mood[]

/** What the double-check sheet says for each nudge kind (server/src/social/safety.ts decides the kind). */
export const NUDGE_COPY: Record<NudgeKind, string> = {
  other_app: 'It looks like this asks to talk on another app. People you only know online sometimes do that to get away from Shasta’s safety checks.',
  phone: 'It looks like this has a phone number in it. Once you share it, you can’t take it back.',
  address: 'It looks like this has an address in it. Only share where you live with people you know in real life.',
  school: 'It looks like this mentions a school. Think about who can see it before you say where you go.',
  age: 'It looks like this is about someone’s age. You don’t have to tell anyone how old you are.',
  photos: 'It looks like this asks for pictures. Nobody should pressure you for photos, and you can always say no.',
  meet: 'It looks like this is about meeting up. Only meet people you know in real life, and tell a trusted adult.',
}

export const REPORT_REASONS: Record<ReportReason, string> = {
  bullying: 'Bullying or being mean',
  sexual: 'Sexual or inappropriate',
  scam: 'Scam or pretending to be someone',
  self_harm: 'Someone might hurt themselves',
  spam: 'Spam',
  other: 'Something else',
}

/** a random id for client message ids (idempotent sends) */
export function clientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20)
}
