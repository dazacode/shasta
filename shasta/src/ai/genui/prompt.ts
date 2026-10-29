// How the on-device model is told to answer visually, and how Shasta recognises a visual answer. Pure and unit-tested.
// The prompt is short on purpose: small models follow a few clear rules, and every token costs context and time.

const FULL = `VISUAL ANSWER MODE. Reply with ONLY a UI program in OpenUI Lang. No other text, no code fences.
One statement per line, starting with: root = Stack([...]). Put components inline inside each other. Arguments are positional; strings use "double quotes".
Components:
Stack(children[]) Heading(text) Text(text) List(items[], ordered?) Table(headers[], rows[][])
Callout(text, tone?, title?) tone is "info", "tip" or "warning". Cards([Card(title, text)]) Steps(items[])
Stats([Stat(label, value)]) BarChart(labels[], values[], unit?) Quiz(question, options[], answerIndex, explanation?)
Flashcard(front, back) Timeline([Event(when, text)])
Example:
root = Stack([Heading("Planets"), Table(["Planet","Moons"], [["Earth","1"],["Mars","2"]]), Callout("Mars has two moons.", "tip")])`

const SMALL = `VISUAL ANSWER MODE. Reply with ONLY a UI program in OpenUI Lang. No other text, no code fences.
One statement per line, starting with: root = Stack([...]). Put components inline inside each other. Arguments are positional; strings use "double quotes".
Components:
Stack(children[]) Heading(text) Text(text) List(items[], ordered?) Table(headers[], rows[][])
Callout(text, tone?, title?) tone is "info", "tip" or "warning". Cards([Card(title, text)]) Steps(items[])
Quiz(question, options[], answerIndex, explanation?)
Example:
root = Stack([Heading("Planets"), Table(["Planet","Moons"], [["Earth","1"],["Mars","2"]]), Callout("Mars has two moons.", "tip")])`

/** The instruction block added to the system prompt for a visual answer. `small` is the shorter set for a 2k-token model. */
export const genuiPrompt = (small: boolean) => (small ? SMALL : FULL)

const VISUAL = /\b(compare|comparison|versus|vs\.?|differences?|pros and cons|table|chart|graph|timeline|step[- ]by[- ]step|steps to|how (do|to|can)|checklist|schedule|study (guide|plan)|cheat ?sheet|flash ?cards?|quiz|multiple choice|overview of|breakdown|list of)\b/i

/** Does the request look like it wants a table, steps, a quiz...? Used in Auto mode. */
export const wantsVisual = (text: string) => VISUAL.test(text)

/**
 * Should this question get a visual answer? `off` never does; a picture is always answered in words. `auto` needs a model that
 * can keep to the layout language: the 360M Light model could not (measured), so there only `always` tries.
 */
export function decideVisual(mode: 'auto' | 'off' | 'always', text: string, hasImage: boolean, capable = true): boolean {
  if (mode === 'off' || hasImage) return false
  return mode === 'always' || (capable && wantsVisual(text))
}

const ROOT = /^\s*root\s*=\s*[A-Z][A-Za-z]*\s*\(/m

/** Is this reply an OpenUI Lang program (possibly wrapped in a code fence by a chatty model)? */
export const looksLikeOpenUi = (text: string) => ROOT.test(text)

/** The program itself: fences and any chatter before `root =` removed. */
export function extractOpenUi(text: string): string {
  const t = text.replace(/```[a-zA-Z-]*\n?/g, '')
  const m = ROOT.exec(t)
  if (!m) return ''
  const body = t.slice(m.index)
  // anything after the program (a closing remark) is not part of it: keep lines that look like statements
  return body
    .split('\n')
    .filter((l, i) => i === 0 || /^\s*[A-Za-z_]\w*\s*=/.test(l) || /^\s+\S/.test(l))
    .join('\n')
    .trim()
}

/** The words of a program (its quoted strings), for keeping a visual answer in the conversation history as plain text. */
export function plainFromOpenUi(text: string): string {
  const parts = [...extractOpenUi(text).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'))
  return parts.join('. ').slice(0, 1500)
}
