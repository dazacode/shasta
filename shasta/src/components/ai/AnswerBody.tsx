import { Suspense, lazy } from 'react'
import { Markdown } from '@/ai/markdown'
import { looksLikeOpenUi } from '@/ai/genui/prompt'

// the OpenUI runtime loads only when an answer is actually visual
const GenUi = lazy(() => import('@/ai/genui/GenUi'))

/** The body of an assistant reply: a drawn visual answer when the model wrote one, otherwise formatted text. */
export function AnswerBody({ content, streaming }: { content: string; streaming: boolean }) {
  if (!looksLikeOpenUi(content)) return <Markdown text={content} />
  return (
    <Suspense fallback={<div className="h-16 animate-pulse rounded-xl bg-shasta-field" />}>
      <GenUi source={content} streaming={streaming} />
    </Suspense>
  )
}
