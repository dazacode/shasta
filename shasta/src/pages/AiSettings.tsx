import { useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Row, Segmented, Toggle, selectCls } from './settingsParts'
import { useSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { CHAT_MODELS, SPEECH_MODELS, VISION_MODEL, backendFor, downloadMb, offeredTiers, recommendTier, speechSize, type Tier } from '@/ai/catalog'
import { activeTier, ai, totalSizeMb, useAi } from '@/ai/engine'
import { formatBytes } from '@/ai/textutil'

function ModelRow({ title, desc, repo, mb, kind }: { title: string; desc: string; repo: string; mb: number; kind: 'chat' | 'vision' | 'speech' }) {
  const here = useAi((s) => !!s.cached[repo])
  const status = useAi((s) => s.models[kind])
  const busy = status.state === 'downloading' || status.state === 'loading'
  return (
    <Row title={title} desc={`${desc} ${here ? 'Downloaded.' : `${mb} MB download.`}`}>
      {busy ? (
        <span className="text-sm text-shasta-muted" role="status">{status.state === 'loading' ? 'Starting…' : `${Math.round(status.progress * 100)}%`}</span>
      ) : (
        !here && <Button variant="outline" onClick={() => void ai.prepare(kind).catch((e: unknown) => useUi.getState().toast(e instanceof Error ? e.message : 'Download failed', { tone: 'error' }))}><Download /> Download</Button>
      )}
      {status.state === 'ready' && <span className="text-sm text-shasta-muted">In memory{status.backend ? ` · ${status.backend === 'webgpu' ? 'graphics chip' : 'processor'}` : ''}</span>}
    </Row>
  )
}

export function AiSection() {
  const s = useSettings((x) => x.settings.ai)
  const update = useSettings((x) => x.update)
  const profile = useAi((x) => x.profile)
  const cached = useAi((x) => x.cached)
  const setup = useAi((x) => x.setup)
  const [storage, setStorage] = useState('')
  useEffect(() => {
    void ai.init()
    void ai.refreshCached()
    void navigator.storage?.estimate?.().then((e) => setStorage(e.usage ? formatBytes(e.usage) : ''), () => undefined)
  }, [])
  const set = (patch: Partial<typeof s>) => update({ ai: { ...s, ...patch } })
  const offered = offeredTiers(profile)
  const backend = backendFor(profile)
  const tier = activeTier()
  const anything = Object.keys(cached).length > 0
  const allHere = anything && ai.isAllCached()

  return (
    <>
      <Row title="Shasta AI" desc="An assistant that runs on this device: ask questions, summarize pages, describe pictures, read PDFs, transcribe recordings. Your files, pictures, recordings and pages never leave the device." htmlFor="ai-on">
        <Toggle id="ai-on" label="Turn on Shasta AI" checked={s.enabled} onChange={(enabled) => set({ enabled })} />
      </Row>
      {s.enabled && (
        <>
          <Row title="Download everything" desc={`Chat, pictures and speech in one go (${totalSizeMb()} MB, once). Or download them one at a time below.`}>
            {setup.running ? <span className="text-sm text-shasta-muted" role="status">{setup.step} · {Math.round(setup.progress * 100)}%</span> : <Button variant="outline" disabled={allHere} onClick={() => void ai.prepareAll().catch((e: unknown) => useUi.getState().toast(e instanceof Error ? e.message : 'Download failed', { tone: 'error' }))}><Download /> {allHere ? 'Downloaded' : 'Download all'}</Button>}
          </Row>
          <Row title="Language model" desc={CHAT_MODELS[tier].blurb} htmlFor="ai-model">
            <select id="ai-model" className={selectCls} value={s.chatModel} onChange={(e) => set({ chatModel: e.target.value as 'auto' | Tier })}>
              <option value="auto">Automatic ({CHAT_MODELS[recommendTier(profile)].label})</option>
              {offered.map((t) => <option key={t} value={t}>{CHAT_MODELS[t].label} · {downloadMb(CHAT_MODELS[t], profile, backend)} MB</option>)}
            </select>
          </Row>
          <ModelRow title="Chat model" desc={`${CHAT_MODELS[tier].label}.`} repo={CHAT_MODELS[tier].repo} mb={downloadMb(CHAT_MODELS[tier], profile, backend)} kind="chat" />
          <ModelRow title="Pictures" desc="Lets the AI see pictures and video frames (SmolVLM 256M)." repo={VISION_MODEL.repo} mb={downloadMb(VISION_MODEL, profile, backend)} kind="vision" />
          <ModelRow title="Speech" desc="Lets the AI understand your voice and recordings (Whisper)." repo={SPEECH_MODELS[speechSize(profile)].repo} mb={SPEECH_MODELS[speechSize(profile)].mb.wasm} kind="speech" />
          <Row title="Free memory when idle" desc="Unload the models after a while so the rest of the browser has room. They reload from this device in a few seconds." htmlFor="ai-idle">
            <select id="ai-idle" className={selectCls} value={s.idleUnloadMinutes} onChange={(e) => set({ idleUnloadMinutes: Number(e.target.value) })}>
              <option value={2}>After 2 minutes</option>
              <option value={5}>After 5 minutes</option>
              <option value={15}>After 15 minutes</option>
              <option value={0}>Never</option>
            </select>
          </Row>
          <Row title="Visual answers" desc="Let the AI answer with tables, steps, cards, charts and quizzes when the question suits it (powered by OpenUI). Auto uses it with the Standard model; the Light model is too small to lay answers out reliably, so there only “Always” tries. A wrong layout falls back to plain text.">
            <Segmented label="Visual answers" value={s.visual} onChange={(visual) => set({ visual })} options={[{ value: 'auto', label: 'Auto' }, { value: 'always', label: 'Always' }, { value: 'off', label: 'Off' }]} />
          </Row>
          <Row title="Look things up" desc="For factual questions, fetch the intro of the matching Wikipedia article so the answer does not rely on a small model's memory, and show the source. Only the topic words (like “YouTube”) are sent, through Shasta's server. Your files, pictures, recordings and pages never are." htmlFor="ai-lookup">
            <Toggle id="ai-lookup" label="Look things up on Wikipedia" checked={s.lookup} onChange={(lookup) => set({ lookup })} />
          </Row>
          <Row title="Right-click menu" desc="Add “Ask Shasta AI”, “Explain”, “Summarize this page” and “Describe image” to the page menu." htmlFor="ai-menu">
            <Toggle id="ai-menu" label="AI entries in the right-click menu" checked={s.contextMenu} onChange={(contextMenu) => set({ contextMenu })} />
          </Row>
          <Row title="Downloaded models" desc={anything ? `Stored on this device${storage ? ` (Shasta is using ${storage} in total)` : ''}. Removing them frees the space; they download again if you use the AI.` : 'Nothing downloaded yet.'}>
            <Button variant="destructive" disabled={!anything} onClick={async () => { if (confirm('Remove all downloaded AI models from this device?')) { await ai.removeDownloads(); useUi.getState().toast('AI models removed') } }}><Trash2 /> Remove</Button>
          </Row>
        </>
      )}
      <section className="border-t border-shasta-line py-4" aria-label="About on-device AI">
        <h2 className="mb-2 text-sm font-medium">How it works</h2>
        <ul className="max-w-2xl list-disc space-y-1 pl-5 text-sm text-shasta-muted">
          <li>The models run inside this browser tab with {backend === 'webgpu' ? 'your graphics chip (WebGPU)' : 'your processor (WebAssembly; this device has no usable WebGPU, so answers are slower)'}. Your questions, files, pictures and recordings are processed here and are not uploaded. The one exception is the optional “Look things up” setting above, which sends only a topic word to Wikipedia through Shasta's server.</li>
          <li>The model files themselves are public downloads. Shasta's server fetches each one once and passes it on, so a school filter that blocks the model host does not matter. The server never sees what you ask.</li>
          <li>Small models make mistakes and can sound sure when they are wrong. Check anything that matters.</li>
          <li>This device: {profile.memoryGb ? `${profile.memoryGb} GB memory (reported by the browser), ` : 'memory unknown, '}{profile.cores} CPU cores, WebGPU {profile.webgpu ? (profile.f16 ? 'yes (fast 16-bit)' : 'yes') : 'no'}, multithreading {profile.isolated ? 'on' : 'off'}.</li>
        </ul>
      </section>
    </>
  )
}
