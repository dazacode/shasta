// The instructions given to the small models. Short on purpose: a 360M-600M model follows a few clear rules far better
// than a long list, and every word costs context window and time on a Chromebook.

export const SYSTEM_PROMPT =
  "You are Shasta AI, a friendly assistant that runs privately on the user's own device. Answer clearly and briefly in plain language. " +
  'Use short paragraphs or bullet points. Never invent facts, quotes, numbers or links. ' +
  'Sometimes a reference, a web page or a file is given before the question: answer the question from it, and say so when it does not contain the answer. ' +
  'If you are not sure of a fact and nothing given states it, say you are not sure instead of guessing.'

export interface PageInfo {
  title: string
  url: string
  text: string
}

export const QUICK_ACTIONS = [
  { id: 'summarize', label: 'Summarize this page', needs: 'page' },
  { id: 'keypoints', label: 'Key points', needs: 'page' },
  { id: 'simplify', label: 'Explain simply', needs: 'page' },
  { id: 'quiz', label: 'Quiz me on this', needs: 'page' },
] as const
export type QuickActionId = (typeof QUICK_ACTIONS)[number]['id']

export const quickPrompt = (id: QuickActionId): string =>
  ({
    summarize: 'Summarize this page in a short paragraph, then list the 3 most important points.',
    keypoints: 'List the key points of this page as short bullet points.',
    simplify: 'Explain what this page says in simple words, as if to a younger student.',
    quiz: 'Write 4 short quiz questions about this page, then give the answers at the end.',
  })[id]

export const explainPrompt = (selection: string) => `Explain this in simple words and give a short example if it helps:\n\n“${selection}”`
export const definePrompt = (selection: string) => `What does “${selection}” mean? Give a short definition.`
export const translatePrompt = (selection: string, language: string) => `Translate this into ${language}. Reply with the translation only:\n\n${selection}`
export const describeImagePrompt = 'Describe this image in detail. Read out any text that is visible.'

/** One piece of source material placed before the question: a plain label and its text, nothing that looks like an instruction. */
export function contextBlock(label: string, text: string): string {
  return `${label}:\n${text}`
}

/** The user turn when there is material: material first, then the question, then a nudge to answer from it. */
export function questionWithMaterial(blocks: string[], question: string): string {
  return `${blocks.join('\n\n')}\n\nQuestion: ${question || 'Summarize the text above.'}\nAnswer briefly, using the text above.`
}
