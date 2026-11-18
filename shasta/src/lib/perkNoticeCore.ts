// When ad-free time is about to end or has ended: a code's pass (trial or Supporter) or the tour's ad-free day. Owner,
// 2026-11-08: the person gets a notification, and Settings -> Supporter explains what happened, that supporting brings it
// back, and that what they picked with the perks is SAVED and switches back on the moment a code is entered.
//
// That last part is true by construction (docs/notes/supporter.md): a saved Supporter wallpaper is drawn as the default
// while perks are off (`effectiveWallpaper`) but the setting itself is never changed; "Early previews" keeps its setting;
// the badge and no-ads follow `hasPerks()`. Nothing is deleted when perks end. Keep it that way, or this copy lies.
//
// This file is the pure part (tests/perkNotice.test.ts); perkNotice.ts runs it. `startPerkNotices` shows each notice once per device (a toast in the
// browser, and a note in Shasuta's notifications when it is built in), checking every few minutes and whenever the pass
// changes.
import { WALLPAPERS, isWallpaper } from '@/lib/wallpaper'
import { termText, tourEnds } from '@/lib/supporter'

export type NoticeStage = 'ending' | 'ended'
export type NoticeWhat = 'trial' | 'supporter' | 'code' | 'tour'

export interface PerkNotice {
  stage: NoticeStage
  /** `code` = a code that ended (the server no longer says which kind it was) */
  what: NoticeWhat
  /** unix seconds it ends or ended at (0 = not known) */
  at: number
  /** once-per-device key */
  key: string
}

/** How early a warning comes: the tour's day 3 hours before, a trial 2 days before, a Supporter code with an end 3 days before. */
export const WARN = { tour: 3 * 3600, trial: 2 * 86400, supporter: 3 * 86400 }

export interface PerkFacts {
  /** a code is saved on this device */
  code: boolean
  /** the code's pass is valid now */
  pass: boolean
  kind: 'trial' | 'supporter' | null
  /** when the code itself ends (unix s); null = no end date; undefined = not known */
  until: number | null | undefined
  /** the server said the code ended (revoked or expired) */
  codeEnded: boolean
  /** the tour's pass: when it ends (unix s), 0 = never had one */
  tourExp: number
}

/**
 * The one notice to show now, or null. Nothing to say while some other ad-free time is still running: a Supporter whose
 * tour day ends loses nothing, so they are not told.
 */
export function noticeFor(f: PerkFacts, now = Date.now() / 1000): PerkNotice | null {
  const tourLive = f.tourExp > now
  // the code first: it is what people pay for
  if (f.code && f.pass && f.kind && typeof f.until === 'number') {
    const left = f.until - now
    if (left > 0 && left <= WARN[f.kind]) return { stage: 'ending', what: f.kind, at: f.until, key: `ending:${f.kind}:${f.until}` }
  }
  if (f.code && !f.pass && f.codeEnded && !tourLive) return { stage: 'ended', what: 'code', at: typeof f.until === 'number' ? f.until : 0, key: `ended:code:${f.until ?? 'x'}` }
  if (f.pass) return null
  if (f.tourExp) {
    if (tourLive && f.tourExp - now <= WARN.tour) return { stage: 'ending', what: 'tour', at: f.tourExp, key: `ending:tour:${f.tourExp}` }
    if (!tourLive && now - f.tourExp < 30 * 86400) return { stage: 'ended', what: 'tour', at: f.tourExp, key: `ended:tour:${f.tourExp}` }
  }
  return null
}

const NAME: Record<NoticeWhat, string> = { trial: 'free trial', supporter: 'Supporter code', code: 'Supporter code', tour: 'ad-free day from the tour' }

/** The short line for a notification. */
export function noticeTitle(n: PerkNotice, now = Date.now() / 1000): string {
  if (n.stage === 'ended') return n.what === 'tour' ? 'Your ad-free day has ended' : `Your ${NAME[n.what]} has ended`
  if (n.what === 'tour') return `Your ad-free day ends at ${tourEnds(n.at, now * 1000)}`
  return `Your ${NAME[n.what]} ends soon: ${termText(n.at, 0, now)}`
}

/** What the perks were looking after on this device, in plain words, for "it is all saved". */
export function keptThings(s: { wallpaper: string; earlyPreviews: boolean }): string[] {
  const out: string[] = []
  if (isWallpaper(s.wallpaper) && WALLPAPERS[s.wallpaper].supporter) out.push(`your ${WALLPAPERS[s.wallpaper].label} wallpaper`)
  if (s.earlyPreviews) out.push('early previews')
  return out
}

/** The longer explanation (Settings -> Supporter). */
export function noticeBody(n: PerkNotice, kept: string[]): string {
  const what = n.stage === 'ended' ? 'Ads are back on this device and the Supporter looks are paused.' : 'When it ends, ads come back on this device and the Supporter looks pause.'
  const saved = kept.length ? `Nothing you picked is lost: ${kept.join(' and ')} ${kept.length > 1 ? 'are' : 'is'} saved` : 'Nothing you picked is lost: your choices are saved'
  return `${what} ${saved}, and everything switches back on the moment you add a Supporter code. Everything that does something in Shasta stays free either way.`
}

