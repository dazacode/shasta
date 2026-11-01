// Generative UI: the on-device model can answer with a small program in OpenUI Lang (https://openui.com), and these are
// the components it may use. Everything is drawn by Shasta from plain data: the model never supplies markup, links,
// images, scripts or actions, so a wrong or hostile answer can only ever produce text in a card.
import { useState, type ReactNode } from 'react'
import { Check, CircleHelp, Info, Lightbulb, TriangleAlert, X } from 'lucide-react'
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { z } from 'zod/v4'
import { cn } from '@/lib/utils'

const str = z.string()
const strs = z.array(z.string())
const kids = z.array(z.any())
const ok = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

const Stack = defineComponent({
  name: 'Stack',
  description: 'Vertical layout of blocks',
  props: z.object({ children: kids }),
  component: ({ props, renderNode }) => <div className="space-y-3">{(props.children ?? []).map((c, i) => <div key={i}>{renderNode(c) as ReactNode}</div>)}</div>,
})

const Heading = defineComponent({
  name: 'Heading',
  description: 'A title',
  props: z.object({ text: str }),
  component: ({ props }) => <h3 className="text-base font-medium leading-snug">{ok(props.text)}</h3>,
})

const Text = defineComponent({
  name: 'Text',
  description: 'A paragraph',
  props: z.object({ text: str }),
  component: ({ props }) => <p className="whitespace-pre-wrap text-sm leading-relaxed">{ok(props.text)}</p>,
})

const List = defineComponent({
  name: 'List',
  description: 'Bulleted or numbered list',
  props: z.object({ items: strs, ordered: z.boolean().optional() }),
  component: ({ props }) => {
    const Tag = props.ordered ? 'ol' : 'ul'
    return <Tag className={cn('space-y-1 pl-5 text-sm leading-relaxed', props.ordered ? 'list-decimal' : 'list-disc')}>{(props.items ?? []).map((t, i) => <li key={i}>{ok(t)}</li>)}</Tag>
  },
})

const Table = defineComponent({
  name: 'Table',
  description: 'A table with a header row',
  props: z.object({ headers: strs, rows: z.array(strs) }),
  component: ({ props }) => (
    <div className="overflow-x-auto rounded-xl border border-shasta-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-shasta-field">
          <tr>{(props.headers ?? []).map((h, i) => <th key={i} className="px-3 py-2 font-medium">{ok(h)}</th>)}</tr>
        </thead>
        <tbody>
          {(props.rows ?? []).map((r, i) => (
            <tr key={i} className="border-t border-shasta-line">{(Array.isArray(r) ? r : [r]).map((c, j) => <td key={j} className="px-3 py-2 align-top">{ok(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
})

const TONES = {
  info: { icon: Info, cls: 'border-sky-500/40 bg-sky-500/10' },
  tip: { icon: Lightbulb, cls: 'border-emerald-500/40 bg-emerald-500/10' },
  warning: { icon: TriangleAlert, cls: 'border-amber-500/50 bg-amber-500/10' },
} as const

const Callout = defineComponent({
  name: 'Callout',
  description: 'A highlighted note',
  props: z.object({ text: str, tone: z.enum(['info', 'tip', 'warning']).optional(), title: str.optional() }),
  component: ({ props }) => {
    const t = TONES[props.tone ?? 'info'] ?? TONES.info
    const Icon = t.icon
    return (
      <div className={cn('flex gap-2.5 rounded-xl border p-3 text-sm', t.cls)} role="note">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>{props.title && <p className="font-medium">{ok(props.title)}</p>}<p className="leading-relaxed">{ok(props.text)}</p></div>
      </div>
    )
  },
})

const Card = defineComponent({
  name: 'Card',
  description: 'A titled card (use inside Cards)',
  props: z.object({ title: str, text: str.optional() }),
  component: ({ props }) => (
    <div className="rounded-xl border border-shasta-line bg-shasta-field/60 p-3">
      <p className="text-sm font-medium">{ok(props.title)}</p>
      {props.text && <p className="mt-1 text-sm leading-relaxed text-shasta-muted">{ok(props.text)}</p>}
    </div>
  ),
})

const Cards = defineComponent({
  name: 'Cards',
  description: 'A grid of Card',
  props: z.object({ items: kids }),
  component: ({ props, renderNode }) => <div className="grid gap-2 sm:grid-cols-2">{(props.items ?? []).map((c, i) => <div key={i}>{renderNode(c) as ReactNode}</div>)}</div>,
})

const Steps = defineComponent({
  name: 'Steps',
  description: 'Numbered steps in order',
  props: z.object({ items: strs }),
  component: ({ props }) => (
    <ol className="space-y-2">
      {(props.items ?? []).map((t, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed">
          <span className="grid size-6 shrink-0 place-items-center rounded-full border border-shasta-line font-mono text-xs tabular-nums text-shasta-muted">{i + 1}</span>
          <span className="pt-0.5">{ok(t)}</span>
        </li>
      ))}
    </ol>
  ),
})

const Stat = defineComponent({
  name: 'Stat',
  description: 'A label and a value (use inside Stats)',
  props: z.object({ label: str, value: z.union([z.string(), z.number()]) }),
  component: ({ props }) => (
    <div className="rounded-xl border border-shasta-line p-3">
      <p className="text-2xl font-medium tabular-nums">{ok(props.value)}</p>
      <p className="mt-1 text-xs text-shasta-muted">{ok(props.label)}</p>
    </div>
  ),
})

const Stats = defineComponent({
  name: 'Stats',
  description: 'A row of Stat',
  props: z.object({ items: kids }),
  component: ({ props, renderNode }) => <div className="grid grid-cols-2 gap-2">{(props.items ?? []).map((c, i) => <div key={i}>{renderNode(c) as ReactNode}</div>)}</div>,
})

const BarChart = defineComponent({
  name: 'BarChart',
  description: 'Horizontal bars, one per label',
  props: z.object({ labels: strs, values: z.array(z.number()), unit: str.optional() }),
  component: ({ props }) => {
    const values = (props.values ?? []).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
    const max = Math.max(1, ...values.map((v) => Math.abs(v)))
    return (
      <div className="space-y-1.5" role="img" aria-label={`Bar chart: ${(props.labels ?? []).map((l, i) => `${ok(l)} ${values[i] ?? 0}`).join(', ')}`}>
        {(props.labels ?? []).map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-right text-shasta-muted" title={ok(l)}>{ok(l)}</span>
            <div className="h-5 flex-1 rounded bg-shasta-field"><div className={cn('h-full rounded', Math.abs(values[i] ?? 0) === max ? 'bg-shasta-accent' : 'bg-shasta-fg/20')} style={{ width: `${Math.max(2, (Math.abs(values[i] ?? 0) / max) * 100)}%` }} /></div>
            <span className="w-14 shrink-0 font-mono tabular-nums text-shasta-muted">{values[i] ?? 0}{props.unit ? ` ${ok(props.unit)}` : ''}</span>
          </div>
        ))}
      </div>
    )
  },
})

const Quiz = defineComponent({
  name: 'Quiz',
  description: 'A multiple-choice question with instant feedback',
  props: z.object({ question: str, options: strs, answer: z.number(), explanation: str.optional() }),
  component: ({ props }) => {
    const [picked, setPicked] = useState<number | null>(null)
    const options = props.options ?? []
    const right = Math.round(Number(props.answer))
    return (
      <div className="rounded-xl border border-shasta-line p-3">
        <p className="mb-2 flex gap-2 text-sm font-medium"><CircleHelp className="mt-0.5 size-4 shrink-0 text-shasta-muted" aria-hidden />{ok(props.question)}</p>
        <div className="space-y-1.5">
          {options.map((o, i) => {
            const done = picked !== null
            const state = !done ? '' : i === right ? 'border-emerald-500 bg-emerald-500/15' : i === picked ? 'border-red-500 bg-red-500/15' : 'opacity-60'
            return (
              <button key={i} type="button" disabled={done} onClick={() => setPicked(i)} className={cn('flex w-full items-center gap-2 rounded-lg border border-shasta-line px-3 py-2 text-left text-sm transition-colors', !done && 'hover:bg-shasta-hover', state)}>
                <span className="flex-1">{ok(o)}</span>
                {done && i === right && <Check className="size-4 text-emerald-500" aria-label="Correct" />}
                {done && i === picked && i !== right && <X className="size-4 text-red-500" aria-label="Not quite" />}
              </button>
            )
          })}
        </div>
        {picked !== null && <p className="mt-2 text-sm text-shasta-muted" role="status">{picked === right ? 'Correct. ' : 'Not quite. '}{props.explanation ? ok(props.explanation) : options[right] ? `The answer is “${ok(options[right])}”.` : ''}</p>}
      </div>
    )
  },
})

const Flashcard = defineComponent({
  name: 'Flashcard',
  description: 'A card that flips from a question to its answer',
  props: z.object({ front: str, back: str }),
  component: ({ props }) => {
    const [flipped, setFlipped] = useState(false)
    return (
      <button type="button" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} className={cn('w-full rounded-xl border p-4 text-left text-sm transition-[color,background-color,box-shadow] duration-150 ease-shasta', flipped ? 'sh-selected border-transparent' : 'border-shasta-line bg-shasta-field/60 hover:bg-shasta-hover')}>
        <span className="mb-1 block text-xs text-shasta-faint">{flipped ? 'Answer' : 'Question · tap to flip'}</span>
        {flipped ? ok(props.back) : ok(props.front)}
      </button>
    )
  },
})

const Event = defineComponent({
  name: 'Event',
  description: 'A moment in time (use inside Timeline)',
  props: z.object({ when: str, text: str }),
  component: ({ props }) => (
    <div className="relative pb-3 pl-5 before:absolute before:left-1 before:top-1.5 before:size-2 before:rounded-full before:bg-shasta-faint after:absolute after:bottom-0 after:left-[7px] after:top-4 after:w-px after:bg-shasta-line">
      <p className="font-mono text-xs text-shasta-muted">{ok(props.when)}</p>
      <p className="text-sm leading-relaxed">{ok(props.text)}</p>
    </div>
  ),
})

const Timeline = defineComponent({
  name: 'Timeline',
  description: 'A list of Event in time order',
  props: z.object({ items: kids }),
  component: ({ props, renderNode }) => <div>{(props.items ?? []).map((c, i) => <div key={i}>{renderNode(c) as ReactNode}</div>)}</div>,
})

export const GENUI_COMPONENTS = [Stack, Heading, Text, List, Table, Callout, Card, Cards, Steps, Stat, Stats, BarChart, Quiz, Flashcard, Event, Timeline]

export const genuiLibrary = createLibrary({ components: GENUI_COMPONENTS, root: 'Stack' })
