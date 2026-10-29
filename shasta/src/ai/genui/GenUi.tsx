import { Renderer, createParser } from '@openuidev/react-lang'
import { Markdown } from '../markdown'
import { genuiLibrary } from './library'
import { extractOpenUi, plainFromOpenUi } from './prompt'

const parser = createParser(genuiLibrary.toJSONSchema(), genuiLibrary.root)

/** Does this program have something to draw? */
export function isDrawable(source: string): boolean {
  const lang = extractOpenUi(source)
  if (!lang) return false
  try {
    const r = parser.parse(lang)
    return !!r.root && !r.meta.errors.some((e) => e.code === 'no-root')
  } catch {
    return false
  }
}

function Skeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="Building the answer">
      <div className="h-4 w-1/3 animate-pulse rounded bg-shasta-field" />
      <div className="h-16 animate-pulse rounded-xl bg-shasta-field" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-shasta-field" />
    </div>
  )
}

/**
 * Draws an OpenUI Lang answer with Shasta's own components. No actions are wired up: nothing in an answer can do anything.
 * A program the model got wrong is shown as its plain words, never as raw code.
 */
export default function GenUi({ source, streaming }: { source: string; streaming: boolean }) {
  if (!isDrawable(source)) return streaming ? <Skeleton /> : <div data-answer="fallback"><Markdown text={plainFromOpenUi(source) || source} /></div>
  return (
    <div data-answer="visual">
      <Renderer response={extractOpenUi(source)} library={genuiLibrary} isStreaming={streaming} />
    </div>
  )
}
