// Shasta AI: a ChatGPT-style app. The models run in the Shasta browser itself (on this device); this page only draws the
// conversation and talks to the browser through postMessage. Chats are kept in this app's own storage.
// Answers can be plain text (markdown) or a visual program in OpenUI Lang (tables, steps, quizzes...), drawn with DOM code
// below from the tree that OpenUI's own parser (openui.js) produces. Nothing in an answer can run code or open a link.
'use strict'
const TAG = 'shasta-ai-bridge'
const $ = (id) => document.getElementById(id)
const KEY = 'shasta-ai.chats.v1'
const EXAMPLES = ['Explain photosynthesis like I am 10', 'Compare mitosis and meiosis in a table', 'Quiz me on the causes of World War I', 'Write a polite email asking my teacher for an extension']

// ---------- bridge ----------
let seq = 0
const waiting = new Map()
let statusHandler = () => {}
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return
  const m = e.data
  if (!m || m[TAG] !== 1) return
  if (m.type === 'status') return statusHandler(m.status)
  if (m.type === 'prompt') return askNew(m.text)
  const w = waiting.get(m.id)
  if (!w) return
  if (m.type === 'token') w.onToken?.(m.text)
  else if (m.type === 'stage') w.onStage?.(m.stage)
  else {
    waiting.delete(m.id)
    m.type === 'error' ? w.reject(new Error(m.message)) : w.resolve(m)
  }
})
function call(op, payload = {}, hooks = {}) {
  const id = ++seq
  const p = new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, ...hooks })
    window.parent.postMessage({ [TAG]: 1, id, op, ...payload }, '*')
  })
  p.id = id
  return p
}

// ---------- storage ----------
let chats = []
let current = null
try { chats = JSON.parse(localStorage.getItem(KEY) || '[]') } catch { chats = [] }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(chats.slice(0, 60))) } catch { /* storage full or blocked */ } }
const uid = () => Math.random().toString(36).slice(2, 10)

// ---------- small DOM helper ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)))
  return n
}

// ---------- safe markdown ----------
function inline(parent, text) {
  for (const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g)) {
    if (!part) continue
    let node
    if (part.length > 2 && part[0] === '`' && part.endsWith('`')) node = el('code', { text: part.slice(1, -1) })
    else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) node = el('strong', { text: part.slice(2, -2) })
    else if (part.length > 2 && part[0] === '*' && part.endsWith('*')) node = el('em', { text: part.slice(1, -1) })
    parent.append(node || document.createTextNode(part))
  }
}
function markdown(target, md) {
  target.replaceChildren()
  const lines = md.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const body = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i])
      target.append(el('pre', {}, el('code', { text: body.join('\n') })))
    } else if (/^#{1,6}\s+/.test(line)) {
      const p = el('p'); const b = el('strong'); inline(b, line.replace(/^#{1,6}\s+/, '')); p.append(b); target.append(p)
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/
      const list = el(ordered ? 'ol' : 'ul')
      for (; i < lines.length && re.test(lines[i]); i++) { const li = el('li'); inline(li, lines[i].replace(re, '')); list.append(li) }
      i--; target.append(list)
    } else if (line.trim()) {
      const para = [line]
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*(```|#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i + 1])) para.push(lines[++i])
      const p = el('p'); p.style.whiteSpace = 'pre-wrap'; inline(p, para.join('\n')); target.append(p)
    }
  }
}
const plainOf = (md) => md.replace(/```[\s\S]*?```/g, ' (code) ').replace(/[`*#_]/g, '').replace(/^\s*[-•]\s+/gm, '')

// ---------- generative answers (OpenUI Lang) ----------
const ROOT = /^\s*root\s*=\s*[A-Z][A-Za-z]*\s*\(/m
const looksLikeUi = (t) => ROOT.test(t)
function extractUi(t) {
  const s = t.replace(/```[a-zA-Z-]*\n?/g, '')
  const m = ROOT.exec(s)
  if (!m) return ''
  return s.slice(m.index).split('\n').filter((l, i) => i === 0 || /^\s*[A-Za-z_]\w*\s*=/.test(l) || /^\s+\S/.test(l)).join('\n').trim()
}
const uiWords = (t) => [...extractUi(t).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"')).join('. ').slice(0, 1500)
const isEl = (v) => v && typeof v === 'object' && v.type === 'element'
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const arr = (v) => (Array.isArray(v) ? v : [])
const KIDS = (node) => arr(node.props.children ?? node.props.items).map(build)

const UI = {
  Stack: (n) => el('div', { class: 'ui' }, KIDS(n)),
  Heading: (n) => el('h3', { text: str(n.props.text) }),
  Text: (n) => el('p', { text: str(n.props.text), style: 'white-space:pre-wrap' }),
  List: (n) => el(n.props.ordered ? 'ol' : 'ul', {}, arr(n.props.items).map((t) => el('li', { text: str(t) }))),
  Table: (n) => el('table', {}, el('thead', {}, el('tr', {}, arr(n.props.headers).map((h) => el('th', { text: str(h) })))), el('tbody', {}, arr(n.props.rows).map((r) => el('tr', {}, (Array.isArray(r) ? r : [r]).map((c) => el('td', { text: str(c) })))))),
  Callout: (n) => el('div', { class: `callout ${['info', 'tip', 'warning'].includes(n.props.tone) ? n.props.tone : 'info'}`, role: 'note' }, n.props.title ? el('b', { text: str(n.props.title) }) : null, str(n.props.text)),
  Card: (n) => el('div', { class: 'tile' }, el('b', { text: str(n.props.title) }), n.props.text ? el('span', { text: str(n.props.text) }) : null),
  Cards: (n) => el('div', { class: 'grid2' }, KIDS(n)),
  Steps: (n) => el('ol', { class: 'steps' }, arr(n.props.items).map((t, i) => el('li', {}, el('i', { text: String(i + 1) }), el('span', { text: str(t) })))),
  Stat: (n) => el('div', { class: 'tile' }, el('div', { class: 'stat', text: str(n.props.value) }), el('span', { text: str(n.props.label) })),
  Stats: (n) => el('div', { class: 'grid2' }, KIDS(n)),
  BarChart: (n) => {
    const vals = arr(n.props.values).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
    const max = Math.max(1, ...vals.map(Math.abs))
    return el('div', { class: 'bars' }, arr(n.props.labels).map((l, i) => el('div', { class: 'r' }, el('span', { class: 'l', text: str(l), title: str(l) }), el('div', { class: 't' }, el('div', { class: 'f', style: `width:${Math.max(2, (Math.abs(vals[i] ?? 0) / max) * 100)}%` })), el('span', { class: 'v', text: `${vals[i] ?? 0}${n.props.unit ? ' ' + str(n.props.unit) : ''}` }))))
  },
  Quiz: (n) => {
    const right = Math.round(Number(n.props.answer))
    const opts = arr(n.props.options)
    const fb = el('div', { class: 'fb', role: 'status' })
    const buttons = opts.map((o, i) => el('button', {
      type: 'button', class: 'o', text: str(o),
      onclick: () => {
        buttons.forEach((b, j) => { b.disabled = true; if (j === right) b.classList.add('ok'); else if (j === i) b.classList.add('no') })
        fb.textContent = (i === right ? 'Correct! ' : 'Not quite. ') + (n.props.explanation ? str(n.props.explanation) : opts[right] ? `The answer is “${str(opts[right])}”.` : '')
      },
    }))
    return el('div', { class: 'quiz' }, el('div', { class: 'q', text: str(n.props.question) }), buttons, fb)
  },
  Flashcard: (n) => {
    const b = el('button', { type: 'button', class: 'flash' }, el('small', { text: 'Question · tap to flip' }), str(n.props.front))
    let on = false
    b.addEventListener('click', () => { on = !on; b.classList.toggle('on', on); b.replaceChildren(el('small', { text: on ? 'Answer' : 'Question · tap to flip' }), on ? str(n.props.back) : str(n.props.front)) })
    return b
  },
  Event: (n) => el('div', { class: 'e' }, el('small', { text: str(n.props.when) }), str(n.props.text)),
  Timeline: (n) => el('div', { class: 'tl' }, KIDS(n)),
}
function build(v) {
  if (isEl(v)) return UI[v.typeName] ? UI[v.typeName](v) : document.createDocumentFragment()
  if (typeof v === 'string' || typeof v === 'number') return document.createTextNode(String(v))
  return document.createDocumentFragment()
}
/** Draws an answer into `target`: a visual program when the model wrote one that parses, otherwise formatted text. */
function drawAnswer(target, text, streaming) {
  if (!looksLikeUi(text) || !window.ShastaOpenUI) return markdown(target, text)
  const r = window.ShastaOpenUI.parse(extractUi(text))
  if (r.root && !r.errors.includes('no-root')) { target.replaceChildren(build(r.root)); return }
  if (streaming) { target.replaceChildren(el('div', { class: 'stage' }, 'Building the answer…')); return }
  markdown(target, uiWords(text) || text) // the model got the layout wrong: show its words, never raw code
}

// ---------- chat list and log ----------
function renderList() {
  const ul = $('chats'); ul.replaceChildren()
  for (const c of chats) {
    const del = el('button', { class: 'del', 'aria-label': `Delete ${c.title}`, text: '✕', onclick: () => { if (busy) return; chats = chats.filter((x) => x !== c); if (current === c) current = null; save(); draw() } })
    ul.append(el('li', { class: c === current ? 'on' : '' }, el('button', { class: 'open', text: c.title, onclick: () => { if (!busy) { current = c; draw(); $('side').classList.remove('open') } } }), del))
  }
}
function addRow(m) {
  if (m.role === 'user') {
    const row = el('div', { class: 'row me' })
    if (m.files?.length) row.append(el('div', { class: 'chips' }, m.files.map((f) => el('span', { class: 'chip', text: f }))))
    row.append(el('div', { class: 'bubble', text: m.content }))
    $('log').append(row)
    return { row }
  }
  const body = el('div', { class: 'body' })
  const bubble = el('div', { class: 'bubble' })
  body.append(bubble)
  drawAnswer(bubble, m.content || '', false)
  const row = el('div', { class: `row ai${m.error ? ' err' : ''}` }, el('span', { class: 'avatar', 'aria-hidden': 'true', text: '✦' }), body)
  if (m.sources?.length) body.append(el('div', { class: 'sources' }, 'Looked up:', m.sources.map((s) => el('span', { class: 'chip', text: s.title }))))
  if (m.content && !m.error) body.append(tools(m))
  $('log').append(row)
  return { row, body, bubble }
}
function tools(m) {
  const copy = el('button', { type: 'button', text: 'Copy', onclick: () => navigator.clipboard.writeText(looksLikeUi(m.content) ? uiWords(m.content) : m.content).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200) }, () => {}) })
  const say = el('button', { type: 'button', text: 'Read aloud', onclick: () => {
    const local = speechSynthesis.getVoices().find((v) => v.localService)
    if (speechSynthesis.speaking) return speechSynthesis.cancel()
    if (!local) return alert('This device has no built-in voice that works offline, so Shasta AI will not read aloud (some voices send text to a server).')
    const u = new SpeechSynthesisUtterance((looksLikeUi(m.content) ? uiWords(m.content) : plainOf(m.content)).slice(0, 6000)); u.voice = local; speechSynthesis.speak(u)
  } })
  const t = el('div', { class: 'tools' }, copy, say)
  if (current && m === current.messages[current.messages.length - 1]) t.append(el('button', { type: 'button', text: 'Regenerate', onclick: regenerate }))
  return t
}
function draw() {
  $('log').replaceChildren()
  $('title').textContent = current?.title || 'Shasta AI'
  for (const m of current?.messages || []) addRow(m)
  $('empty').hidden = !!current?.messages.length
  renderList()
  $('scroll').scrollTop = $('scroll').scrollHeight
}

// ---------- sending ----------
let busy = false
let files = []
let activeId = 0
const historyOf = (msgs) => msgs.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: looksLikeUi(m.content) ? uiWords(m.content) : m.content, note: m.note }))
const setBusy = (b) => { busy = b; $('send').hidden = b; $('stop').hidden = !b; $('input').disabled = b; updateSend() }
const updateSend = () => { $('send').disabled = busy || (!$('input').value.trim() && !files.length) }

async function run(history, text, sendFiles) {
  setBusy(true)
  const ai = { role: 'assistant', content: '' }
  const { row, body, bubble } = addRow(ai)
  const stage = el('div', { class: 'stage' }, el('span', { class: 'dots' }, el('i'), el('i'), el('i')), el('span', { text: 'Getting ready…' }))
  body.append(stage)
  $('scroll').scrollTop = $('scroll').scrollHeight
  let acc = ''
  const req = call('chat', { text, files: sendFiles, history }, {
    onStage: (s) => { stage.lastChild.textContent = s },
    onToken: (t) => { acc += t; drawAnswer(bubble, acc, true); $('scroll').scrollTop = $('scroll').scrollHeight },
  })
  activeId = req.id
  try {
    const res = await req
    ai.content = res.text || acc || (res.stopped ? 'Stopped.' : 'I could not come up with an answer. Try asking a different way.')
    ai.note = res.note
    if (res.sources?.length) ai.sources = res.sources.map((s) => ({ title: String(s.title).slice(0, 80) }))
  } catch (e) { ai.content = e.message; ai.error = true }
  void row
  current.messages.push(ai); save()
  setBusy(false); $('input').focus()
  draw()
}
async function send() {
  const text = $('input').value.trim()
  if ((!text && !files.length) || busy) return
  if (!current) { current = { id: uid(), title: (text || files[0].name).slice(0, 48), messages: [] }; chats.unshift(current) }
  const history = historyOf(current.messages)
  current.messages.push({ role: 'user', content: text || 'Please look at the attached file.', files: files.map((f) => f.name) })
  const sendFiles = files
  // a picture stays attached for follow-up questions until it is removed; other files are used once
  files = files.filter((f) => f.type.startsWith('image/'))
  $('input').value = ''; autosize(); drawFiles(); save(); draw()
  await run(history, text, sendFiles)
}
// a question sent from the new tab page: it starts a new chat
function askNew(text) {
  text = String(text || '').trim().slice(0, 8000)
  if (!text || busy) return
  current = null; files = []; drawFiles()
  $('input').value = text; autosize()
  void send()
}
async function regenerate() {
  if (busy || !current) return
  const last = current.messages.pop(); if (last?.role !== 'assistant') return
  const user = current.messages[current.messages.length - 1]
  save(); draw()
  await run(historyOf(current.messages.slice(0, -1)), user.content, [])
}
$('composer').addEventListener('submit', (e) => { e.preventDefault(); void send() })
$('stop').onclick = () => call('stop', { target: activeId })
$('new').onclick = () => { if (busy) return; current = null; draw(); $('side').classList.remove('open'); $('input').focus() }
$('menu').onclick = () => $('side').classList.toggle('open')
const autosize = () => { const t = $('input'); t.style.height = 'auto'; t.style.height = `${Math.min(200, t.scrollHeight)}px`; updateSend() }
$('input').addEventListener('input', autosize)
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send() } })

// ---------- attachments ----------
function drawFiles() {
  const ul = $('attached'); ul.replaceChildren()
  files.forEach((f, i) => {
    const thumb = f.type.startsWith('image/') ? el('img', { alt: '', src: URL.createObjectURL(f), onload: (e) => URL.revokeObjectURL(e.target.src) }) : el('span', { class: 'ico', text: '📄' })
    ul.append(el('li', {}, thumb, el('span', { text: f.name.slice(0, 26) }), el('button', { type: 'button', 'aria-label': `Remove ${f.name}`, text: '✕', onclick: () => { files.splice(i, 1); drawFiles() } })))
  })
  updateSend()
}
const addFiles = (list) => { files = [...files, ...list].slice(0, 4); drawFiles() }
$('attach').onclick = () => $('file').click()
$('file').onchange = (e) => { addFiles([...e.target.files]); e.target.value = '' }
$('input').addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f) } })
for (const ev of ['dragenter', 'dragover']) $('composer').addEventListener(ev, (e) => { e.preventDefault(); $('composer').classList.add('drag') })
for (const ev of ['dragleave', 'drop']) $('composer').addEventListener(ev, (e) => { e.preventDefault(); $('composer').classList.remove('drag') })
$('composer').addEventListener('drop', (e) => addFiles([...(e.dataTransfer?.files || [])]))

// ---------- voice ----------
let recording = false
$('mic').onclick = async () => {
  if (busy) return
  try {
    if (!recording) { await call('record.start'); recording = true; $('mic').classList.add('rec'); $('input').placeholder = 'Listening… press the mic again to finish'; return }
    recording = false; $('mic').classList.remove('rec'); $('input').placeholder = 'Transcribing…'; $('mic').disabled = true
    const { text } = await call('record.stop')
    if (text) { $('input').value = ($('input').value ? `${$('input').value} ` : '') + text; autosize() }
  } catch { recording = false; $('mic').classList.remove('rec'); alert('Could not use the microphone. Allow it in the browser and try again.') }
  finally { $('mic').disabled = false; $('input').placeholder = 'Ask anything' }
}

// ---------- onboarding: check the device, download what suits it ----------
function applyStatus(s) {
  $('badge').hidden = !s.ready; $('badge').textContent = `${s.model} · on this device${s.speed ? ` · ~${(s.speed * 0.75).toFixed(0)} words/s` : ''}`
  const dev = s.device
  const a = el('div', {}, el('b', { text: 'This device: ' }), `${dev.memoryGb ? `${dev.memoryGb} GB memory, ` : ''}${dev.cores} CPU cores, ${dev.backend === 'webgpu' ? 'graphics chip available' : 'no WebGPU, so it will use the processor'}.`)
  const c = el('div', { style: 'margin-top:4px' }, el('b', { text: 'Best fit: ' }), `the ${s.model} model plus picture and speech models${s.totalMb ? `, ${s.totalMb} MB in total` : ''}, downloaded once.`)
  $('gate-device').replaceChildren(a, c)
  const running = s.setup.running
  $('gate').hidden = s.ready && !running
  $('bar').hidden = !running; $('bar').firstElementChild.style.width = `${Math.round(s.setup.progress * 100)}%`
  $('setup').hidden = running
  $('gate-status').textContent = running ? `Downloading the ${s.setup.step}… ${Math.round(s.setup.progress * 100)}%` : s.setup.error || 'Your files, pictures and recordings never leave this device.'
  $('gate-text').textContent = 'Shasta checks your device and downloads the AI models that suit it. One step, once.'
}
statusHandler = applyStatus
$('setup').onclick = async () => { try { applyStatus((await call('setup')).status) } catch (e) { $('gate-status').textContent = e.message; $('setup').hidden = false } }

function boot() {
  for (const t of EXAMPLES) $('examples').append(el('button', { type: 'button', text: t, onclick: () => { $('input').value = t; autosize(); $('input').focus() } }))
  current = null; draw(); updateSend()
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('no bridge')), 3000))
  Promise.race([call('status'), timeout]).then((r) => { applyStatus(r.status); if (r.status.ready) call('prompt.take').then((p) => askNew(p.text), () => {}) }, () => {
    $('gate').hidden = false; $('setup').hidden = true; $('bar').hidden = true
    $('gate-title').textContent = 'Open this app in Shasta'; $('gate-text').textContent = 'Shasta AI runs on the models inside the Shasta browser. Install it from the Shasta Store and open it there.'; $('gate-device').hidden = true; $('gate-status').textContent = ''
  })
}
boot()
