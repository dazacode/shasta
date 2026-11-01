import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, FileText, Globe, Lightbulb, ListChecks, Loader2, Mic, Plus, Mountain, SquarePen, Square, Table2, Volume2, X, Film, AudioLines, ImageIcon } from 'lucide-react'
import { IconButton } from '@/components/browser/IconButton'
import { ModelSetup } from './ModelSetup'
import { AnswerBody } from './AnswerBody'
import { useAssistant, modelBusyLabel, type Msg } from '@/ai/assistantStore'
import { ai, useAi } from '@/ai/engine'
import { explainPrompt } from '@/ai/prompts'
import { readActivePage, readSelection } from '@/ai/pageContext'
import { fileKind } from '@/ai/docs'
import { canSpeak, speak, stopSpeaking } from '@/ai/media'
import { stripMarkdown } from '@/ai/textutil'
import { looksLikeOpenUi, plainFromOpenUi } from '@/ai/genui/prompt'
import { useUi } from '@/stores/uiStore'
import { useTabs } from '@/stores/tabsStore'
import { useSettings } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

const ACCEPT = 'image/*,audio/*,video/*,.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json,.html,.js,.ts,.py,.java,.c,.cpp,.css'

const KindIcon = ({ kind }: { kind: string }) => (kind === 'image' ? <ImageIcon className="size-3.5" /> : kind === 'video' ? <Film className="size-3.5" /> : kind === 'audio' ? <AudioLines className="size-3.5" /> : <FileText className="size-3.5" />)

function Avatar() {
  return <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-shasta-line bg-shasta-bg text-shasta-muted" aria-hidden><Mountain className="size-3.5" strokeWidth={1.5} /></span>
}

function Dots({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-shasta-muted" role="status">
      <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-shasta-muted" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
      {label}
    </p>
  )
}

function Thumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const kind = fileKind(file)
  const url = useMemo(() => (kind === 'image' ? URL.createObjectURL(file) : null), [file, kind])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return (
    <span className="relative inline-flex items-center gap-2 rounded-2xl border border-shasta-line bg-shasta-bg p-1.5 pr-3 text-xs">
      {url ? <img src={url} alt="" className="size-10 rounded-lg object-cover" /> : <span className="grid size-10 place-items-center rounded-lg bg-shasta-field text-shasta-muted"><KindIcon kind={kind} /></span>}
      <span className="max-w-[9rem] truncate">{file.name}</span>
      <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-shasta-fg text-shasta-bg"><X className="size-3" /></button>
    </span>
  )
}

function Message({ m }: { m: Msg }) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5" data-role="user">
        {(m.page || m.files?.length) ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {m.page && <span className="inline-flex items-center gap-1 rounded-full border border-shasta-line px-2.5 py-1 text-xs text-shasta-muted"><Globe className="size-3.5" />{m.page.slice(0, 40)}</span>}
            {m.files?.map((f, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full border border-shasta-line px-2.5 py-1 text-xs text-shasta-muted"><KindIcon kind={f.kind} />{f.name.slice(0, 28)}</span>)}
          </div>
        ) : null}
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-shasta-field px-4 py-2 text-[15px] leading-6">{m.content}</p>
      </div>
    )
  }
  const spoken = () => stripMarkdown(looksLikeOpenUi(m.content) ? plainFromOpenUi(m.content) : m.content)
  return (
    <div className="flex gap-3" data-role="assistant">
      <Avatar />
      <div className="min-w-0 flex-1">
        {m.error ? <p className="text-sm text-shasta-danger" role="alert">{m.content}</p> : m.content ? <AnswerBody content={m.content} streaming={!!m.pending} /> : null}
        {m.pending && <div className={m.content ? 'mt-2' : ''}><Dots label={m.stage ?? 'Thinking…'} /></div>}
        {!m.pending && m.sources?.length ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-shasta-muted">
            <span>Looked up:</span>
            {m.sources.map((s) => (
              <a key={s.url} href={s.url} rel="noreferrer noopener" onClick={(e) => { e.preventDefault(); useTabs.getState().newTab(s.url) }} className="rounded-full border border-shasta-line px-2 py-0.5 hover:bg-shasta-field hover:text-shasta-fg">{s.title}</a>
            ))}
          </p>
        ) : null}
        {!m.pending && m.content && !m.error && (
          <div className="-ml-1.5 mt-1.5 flex gap-0.5 text-shasta-muted">
            <button className="grid size-8 place-items-center rounded-lg hover:bg-shasta-field hover:text-shasta-fg" aria-label="Copy answer" title="Copy" onClick={() => void navigator.clipboard.writeText(spoken()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => undefined)}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</button>
            <button
              className={cn('grid size-8 place-items-center rounded-lg hover:bg-shasta-field hover:text-shasta-fg', speaking && 'text-shasta-accent')}
              aria-label={speaking ? 'Stop reading' : 'Read aloud'}
              title={speaking ? 'Stop reading' : 'Read aloud'}
              onClick={() => {
                if (speaking) return void (stopSpeaking(), setSpeaking(false))
                if (!canSpeak()) return useUi.getState().toast("This device has no built-in voice that works offline, so Shasta can't read aloud privately.", { tone: 'error' })
                setSpeaking(speak(spoken(), () => setSpeaking(false)))
              }}
            ><Volume2 className="size-4" /></button>
          </div>
        )}
      </div>
    </div>
  )
}

function Suggestion({ icon: Icon, title, hint, disabled, onClick }: { icon: typeof FileText; title: string; hint: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex flex-col items-start gap-1 rounded-xl border border-shasta-line p-3 text-left transition-colors duration-150 ease-shasta hover:bg-shasta-field disabled:cursor-not-allowed disabled:opacity-50">
      <Icon className="size-4 text-shasta-muted" aria-hidden />
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-shasta-muted">{hint}</span>
    </button>
  )
}

export function AssistantPanel() {
  const open = useUi((s) => s.assistantOpen)
  const request = useUi((s) => s.assistantRequest)
  const enabled = useSettings((s) => s.settings.ai.enabled)
  const messages = useAssistant((s) => s.messages)
  const busy = useAssistant((s) => s.busy)
  const recording = useAssistant((s) => s.recording)
  const transcribing = useAssistant((s) => s.transcribing)
  const send = useAssistant((s) => s.send)
  const chatState = useAi((s) => s.models.chat.state)
  const cached = useAi((s) => s.cached)
  const speed = useAi((s) => s.speed)
  const activeId = useTabs((s) => s.activeId)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [usePage, setUsePage] = useState(false)
  const [pageTitle, setPageTitle] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) void ai.init()
  }, [open])
  // which page the assistant could read right now (changes with the tab)
  useEffect(() => {
    if (!open) return
    const read = () => setPageTitle(readActivePage()?.title ?? null)
    read()
    const t = setInterval(read, 2000)
    return () => clearInterval(t)
  }, [open, activeId])
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages])
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  // the box grows with what is typed, up to a limit
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text, open])

  const hasModel = chatState === 'ready' || (Object.keys(cached).length > 0 && ai.isCached('chat'))
  const ready = hasModel || messages.length > 0

  // requests from the right-click menu and toolbar
  useEffect(() => {
    if (!request || !open) return
    useUi.getState().consumeAssistantRequest()
    if (!ready) {
      setText(request.text)
      return
    }
    void send(request.text, { usePage: request.withPage, selection: request.selection, image: request.image, label: request.label })
  }, [request, open, ready, send])

  if (!open || !enabled) return null

  const go = () => {
    const t = text.trim()
    if ((!t && !files.length) || busy) return
    void send(t, { files, usePage: usePage && !!pageTitle })
    setText('')
    // a picture stays attached for follow-up questions ("what colour is the roof?") until it is removed; other files are used once
    setFiles((cur) => cur.filter((f) => fileKind(f) === 'image'))
  }
  const addFiles = (picked: Iterable<File>) => {
    const ok: File[] = []
    for (const f of picked) {
      if (fileKind(f) === 'unsupported') useUi.getState().toast(`${f.name}: this kind of file isn't supported.`, { tone: 'error' })
      else ok.push(f)
    }
    setFiles((cur) => [...cur, ...ok].slice(0, 4))
  }
  const download = modelBusyLabel()
  const canSend = (!!text.trim() || files.length > 0) && !busy
  const ask = (t: string) => void send(t, { usePage: true, label: t })

  return (
    <aside className="z-30 flex w-[28rem] max-w-full shrink-0 flex-col border-l border-shasta-line bg-shasta-bg max-sm:absolute max-sm:inset-0 max-sm:w-full" aria-label="Shasta AI assistant">
      <header className="flex items-center gap-1 px-3 py-2">
        <h2 className="flex flex-1 items-baseline gap-2 text-sm font-medium">
          Shasta AI
          <span className="text-xs font-normal text-shasta-faint">on this device</span>
        </h2>
        <IconButton label="New chat" onClick={() => useAssistant.getState().clear()} disabled={!messages.length}><SquarePen className="size-[18px]" /></IconButton>
        <IconButton label="Close assistant" onClick={() => useUi.getState().closeAssistant()}><X className="size-[18px]" /></IconButton>
      </header>

      {!ready ? (
        <div className="flex-1 overflow-auto"><ModelSetup compact /></div>
      ) : (
        <>
          <div ref={list} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            {messages.length === 0 ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-5 px-5 py-8">
                <span className="grid size-12 place-items-center rounded-full border border-shasta-line text-shasta-muted"><Mountain className="size-6" strokeWidth={1.5} /></span>
                <h3 className="text-2xl font-medium tracking-[-0.01em]">How can I help?</h3>
                <div className="grid w-full max-w-md grid-cols-2 gap-2">
                  <Suggestion icon={FileText} title="Summarize this page" hint={pageTitle ? pageTitle.slice(0, 34) : 'Open a website first'} disabled={!pageTitle || busy} onClick={() => ask('Summarize this page in a short paragraph, then list the 3 most important points.')} />
                  <Suggestion icon={ListChecks} title="Quiz me on this" hint="Tap-to-answer questions" disabled={!pageTitle || busy} onClick={() => void useAssistant.getState().quick('quiz')} />
                  <Suggestion icon={Lightbulb} title="Explain simply" hint="In plain words" disabled={!pageTitle || busy} onClick={() => void useAssistant.getState().quick('simplify')} />
                  <Suggestion
                    icon={Table2}
                    title="Compare two things"
                    hint="As a table"
                    disabled={busy}
                    onClick={() => {
                      setText('Compare ')
                      input.current?.focus()
                    }}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className="text-xs text-shasta-muted underline-offset-2 hover:text-shasta-fg hover:underline"
                  onClick={() => {
                    const sel = readSelection(activeId)
                    if (!sel) return void useUi.getState().toast('Select some text on the page first.')
                    void send(explainPrompt(sel), { label: `Explain: “${sel.slice(0, 80)}”` })
                  }}
                >
                  Explain the text I selected
                </button>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-5">{messages.map((m) => <Message key={m.id} m={m} />)}</div>
            )}
          </div>

          <div className="px-3 pb-2 pt-1">
            {download && <p className="mb-2 px-1 text-xs text-shasta-muted" role="status">{download}</p>}
            {pageTitle && (
              <button type="button" aria-pressed={usePage} onClick={() => setUsePage((v) => !v)} className={cn('mb-2 ml-1 inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-[color,background-color,box-shadow] duration-150 ease-shasta', usePage ? 'sh-selected border-transparent' : 'border-shasta-line text-shasta-muted hover:bg-shasta-field')}>
                <Globe className="size-3.5 shrink-0" />
                <span className="truncate">{usePage ? 'Reading' : 'Read'} “{pageTitle.slice(0, 40)}”</span>
                {usePage && <Check className="size-3.5 shrink-0" />}
              </button>
            )}
            <div className="rounded-[20px] border border-shasta-line bg-shasta-field p-2 transition-colors duration-150 ease-shasta focus-within:border-shasta-faint">
              {files.length > 0 && <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">{files.map((f, i) => <Thumb key={`${f.name}${i}`} file={f} onRemove={() => setFiles((cur) => cur.filter((_, j) => j !== i))} />)}</div>}
              <textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    go()
                  }
                }}
                onPaste={(e) => {
                  const pasted = [...e.clipboardData.files]
                  if (pasted.length) {
                    e.preventDefault()
                    addFiles(pasted)
                  }
                }}
                rows={1}
                placeholder={recording ? 'Listening… press the mic again to finish' : 'Ask anything'}
                aria-label="Message"
                className="block max-h-40 min-h-9 w-full resize-none bg-transparent px-3 py-1.5 text-[15px] leading-6 outline-none placeholder:text-shasta-faint"
              />
              <div className="flex items-center gap-1">
                <input ref={picker} type="file" hidden multiple accept={ACCEPT} onChange={(e) => { addFiles(e.target.files ?? []); e.target.value = '' }} />
                <IconButton label="Attach a file, picture, recording or video" onClick={() => picker.current?.click()} disabled={busy || files.length >= 4}><Plus className="size-5" /></IconButton>
                <span className="flex-1" />
                <IconButton
                  label={recording ? 'Stop and transcribe' : 'Speak your question'}
                  className={cn(recording && 'bg-shasta-danger/15 text-shasta-danger')}
                  disabled={busy || transcribing}
                  onClick={async () => {
                    if (!recording) return void useAssistant.getState().startDictation()
                    const said = await useAssistant.getState().stopDictation()
                    if (said) setText((cur) => (cur ? `${cur} ${said}` : said))
                  }}
                >
                  {transcribing ? <Loader2 className="size-[18px] animate-spin" /> : <Mic className="size-[18px]" />}
                </IconButton>
                {busy ? (
                  <button type="button" aria-label="Stop" title="Stop" onClick={() => useAssistant.getState().stop()} className="grid size-8 place-items-center rounded-full bg-shasta-fg text-shasta-bg"><Square className="size-3.5 fill-current" /></button>
                ) : (
                  <button type="button" aria-label="Send" title="Send" disabled={!canSend} onClick={go} className="sh-press grid size-8 place-items-center rounded-full bg-shasta-fg text-shasta-bg disabled:opacity-25"><ArrowUp className="size-[18px]" /></button>
                )}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-shasta-faint">Runs on this device{speed ? ` · ~${(speed * 0.75).toFixed(0)} words/s` : ''} · AI can make mistakes</p>
          </div>
        </>
      )}
    </aside>
  )
}
