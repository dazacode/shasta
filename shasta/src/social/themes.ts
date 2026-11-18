// Profile looks (docs/social-plan.md "Profile"): a validated theme, never custom CSS or HTML. Four colours with a
// contrast check, one of six fonts (bundled fontsource fonts or system stacks only), and a curated background made of
// CSS gradients and patterns (no images). contrastOk is the same rule the server applies: WCAG 2 contrast >= 4.5.
import type { CSSProperties } from 'react'
import type { Font, Theme } from './types'

export const HEX = /^#[0-9a-fA-F]{6}$/

// ---- contrast (WCAG 2.x relative luminance) ------------------------------------------------------------------------

const channel = (v: number) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
/** 1 (none) to 21 (black on white) */
export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 1
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
export const MIN_CONTRAST = 4.5
export const contrastOk = (text: string, bg: string) => contrastRatio(text, bg) >= MIN_CONTRAST

/** Every pair a visitor reads: text on the page and on cards, plus the accent on cards (links, buttons). */
export function themeProblems(t: Theme): string[] {
  const out: string[] = []
  if (!contrastOk(t.text, t.bg)) out.push('Text is hard to read on the background.')
  if (!contrastOk(t.text, t.surface)) out.push('Text is hard to read on the cards.')
  if (contrastRatio(t.accent, t.surface) < 3) out.push('The accent colour is hard to see on the cards.')
  return out
}

// ---- palettes ----------------------------------------------------------------------------------------------------

export interface Palette {
  id: string
  name: string
  colors: Pick<Theme, 'bg' | 'surface' | 'text' | 'accent'>
}

export const PALETTES: readonly Palette[] = [
  { id: 'paper', name: 'Paper', colors: { bg: '#f4f1ea', surface: '#ffffff', text: '#1d1b16', accent: '#b4462c' } },
  { id: 'night', name: 'Night', colors: { bg: '#11131a', surface: '#1b1f2a', text: '#eef0f5', accent: '#8ab4ff' } },
  { id: 'forest', name: 'Forest', colors: { bg: '#e7efe5', surface: '#f8fbf6', text: '#16261a', accent: '#2f7a46' } },
  { id: 'ocean', name: 'Ocean', colors: { bg: '#dcecf4', surface: '#f6fbfd', text: '#0e2733', accent: '#0f6b8f' } },
  { id: 'peach', name: 'Peach', colors: { bg: '#fde8dc', surface: '#fff7f2', text: '#3a1f12', accent: '#c2410c' } },
  { id: 'grape', name: 'Grape', colors: { bg: '#2a1f33', surface: '#362942', text: '#f6eefb', accent: '#f0abfc' } },
  { id: 'mint', name: 'Mint', colors: { bg: '#e3f6f0', surface: '#ffffff', text: '#0f2a24', accent: '#0f766e' } },
  { id: 'arcade', name: 'Arcade', colors: { bg: '#0b0b14', surface: '#171728', text: '#f5f5ff', accent: '#facc15' } },
  { id: 'sky', name: 'Sky', colors: { bg: '#eaf2ff', surface: '#ffffff', text: '#122036', accent: '#2563eb' } },
  { id: 'lemon', name: 'Lemon', colors: { bg: '#fff8d6', surface: '#fffdf2', text: '#2b2505', accent: '#8a6a00' } },
]

// ---- fonts -------------------------------------------------------------------------------------------------------

export const FONTS: Record<Font, { label: string; stack: string; style?: CSSProperties }> = {
  system: { label: 'Clean', stack: "'Geist Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  rounded: { label: 'Rounded', stack: "'Nunito Variable', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" },
  serif: { label: 'Bookish', stack: "ui-serif, 'New York', Georgia, Cambria, 'Times New Roman', serif" },
  mono: { label: 'Typewriter', stack: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  // no pixel font is bundled: a heavy monospace with wide letters stands in
  pixel: { label: 'Blocky', stack: "ui-monospace, 'Cascadia Mono', 'Courier New', monospace", style: { fontWeight: 700, letterSpacing: '0.06em' } },
  hand: { label: 'Handwritten', stack: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', cursive" },
}
export const FONT_IDS = Object.keys(FONTS) as Font[]

// ---- backgrounds (CSS only, drawn from the theme's own colours) -----------------------------------------------------

export interface Background {
  id: string
  label: string
  css(t: Theme): string
}

const mix = (a: string, b: string, pct: number) => `color-mix(in oklab, ${a} ${pct}%, ${b})`

export const BACKGROUNDS: readonly Background[] = [
  { id: 'none', label: 'Plain', css: (t) => t.bg },
  { id: 'dots', label: 'Dots', css: (t) => `radial-gradient(${mix(t.accent, t.bg, 22)} 1.5px, transparent 1.6px) 0 0 / 18px 18px, ${t.bg}` },
  { id: 'grid', label: 'Graph paper', css: (t) => `linear-gradient(${mix(t.text, t.bg, 8)} 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(90deg, ${mix(t.text, t.bg, 8)} 1px, transparent 1px) 0 0 / 22px 22px, ${t.bg}` },
  { id: 'stripes', label: 'Stripes', css: (t) => `repeating-linear-gradient(135deg, ${t.bg} 0 14px, ${mix(t.accent, t.bg, 10)} 14px 28px)` },
  { id: 'checker', label: 'Checks', css: (t) => `repeating-conic-gradient(${mix(t.accent, t.bg, 9)} 0 25%, ${t.bg} 0 50%) 0 0 / 36px 36px` },
  { id: 'horizon', label: 'Horizon', css: (t) => `linear-gradient(180deg, ${t.bg} 0%, ${t.bg} 55%, ${mix(t.accent, t.bg, 18)} 100%)` },
  { id: 'corner', label: 'Glow corner', css: (t) => `radial-gradient(120% 80% at 100% 0%, ${mix(t.accent, t.bg, 16)}, transparent 60%), ${t.bg}` },
  { id: 'waves', label: 'Waves', css: (t) => `radial-gradient(circle at 50% 120%, transparent 38%, ${mix(t.accent, t.bg, 10)} 39% 41%, transparent 42%) 0 0 / 48px 24px, ${t.bg}` },
]
export const backgroundById = (id: string) => BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]

// ---- the theme as a whole ------------------------------------------------------------------------------------------

export const DEFAULT_THEME: Theme = { ...PALETTES[0].colors, font: 'system', background: 'none' }

/** Keeps a theme only if every part is known and readable; otherwise the default (what the server would keep). */
export function validTheme(t: unknown): t is Theme {
  if (!t || typeof t !== 'object') return false
  const x = t as Record<string, unknown>
  return (
    ['bg', 'surface', 'text', 'accent'].every((k) => typeof x[k] === 'string' && HEX.test(x[k] as string)) &&
    typeof x.font === 'string' && x.font in FONTS &&
    typeof x.background === 'string' && BACKGROUNDS.some((b) => b.id === x.background) &&
    contrastOk(x.text as string, x.bg as string)
  )
}

/** CSS variables + the background for a profile page. Children use var(--p-bg) etc. */
export function themeStyle(input: Theme): CSSProperties {
  const t = validTheme(input) ? input : DEFAULT_THEME
  const font = FONTS[t.font]
  return {
    '--p-bg': t.bg,
    '--p-surface': t.surface,
    '--p-text': t.text,
    '--p-accent': t.accent,
    '--p-muted': mix(t.text, t.surface, 68),
    '--p-line': mix(t.text, t.surface, 14),
    background: backgroundById(t.background).css(t),
    color: t.text,
    fontFamily: font.stack,
    ...font.style,
  } as CSSProperties
}

/** Text colour that reads on the accent (for a filled button). */
export const onAccent = (accent: string) => (contrastRatio('#ffffff', accent) >= contrastRatio('#111111', accent) ? '#ffffff' : '#111111')
