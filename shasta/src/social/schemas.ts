// Form rules for what a person types, the same limits the server enforces (docs/social-protocol.md). The server is
// the authority (it also runs automod); these give live feedback so a form never fails on something we could see.
import { z } from 'zod'

/** the protocol's list plus the web chat's reserved names (server/src/services/webchat.ts RESERVED) */
export const RESERVED_HANDLES = ['shasta', 'admin', 'administrator', 'staff', 'mod', 'moderator', 'support', 'official', 'system', 'owner', 'discord', 'clyde', 'everyone', 'here'] as const

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/

/** What to tell someone about the handle they are typing; null = fine as far as this device can tell. */
export function handleProblem(raw: string): string | null {
  const h = raw.trim().toLowerCase()
  if (h.length < 3) return 'At least 3 characters.'
  if (h.length > 20) return 'At most 20 characters.'
  if (!HANDLE_RE.test(h)) return 'Only letters, numbers and _ (no spaces).'
  if (RESERVED_HANDLES.some((r) => h === r || h.split('_').includes(r))) return "That one's reserved. Pick another."
  return null
}

export const handleSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .superRefine((h, ctx) => {
    const problem = handleProblem(h)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })

/** The neutral age question: a whole number. Only the band it falls in is ever stored (by the server). */
export const ageSchema = z.coerce.number({ message: 'Type a number.' }).int('Type a whole number.').min(1, 'Type your age.').max(120, 'Type your age.')

export const LIMITS = { about: 200, status: 80, post: 280, note: 140, message: 1000, deviceName: 40 } as const

const text = (max: number, what: string) => z.string().trim().max(max, `${what} can be at most ${max} characters.`)
export const aboutSchema = text(LIMITS.about, 'About')
export const statusSchema = text(LIMITS.status, 'Status')
export const postSchema = text(LIMITS.post, 'A post').min(1, 'Write something first.')
export const noteSchema = text(LIMITS.note, 'A note')
export const messageSchema = text(LIMITS.message, 'A message').min(1, 'Write something first.')
export const deviceNameSchema = text(LIMITS.deviceName, 'A name').min(1, 'Give it a name.')

/** First error message of a zod result, or null. */
export function firstError(r: { success: boolean; error?: { issues: { message: string }[] } }): string | null {
  return r.success ? null : (r.error?.issues[0]?.message ?? 'Check this field.')
}
