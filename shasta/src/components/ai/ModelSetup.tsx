import { useEffect } from 'react'
import { Download, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CHAT_MODELS, backendFor } from '@/ai/catalog'
import { activeTier, ai, totalSizeMb, useAi } from '@/ai/engine'
import { useUi } from '@/stores/uiStore'

/** First-run card: says what will be downloaded, that it stays on the device, and waits for a click. */
export function ModelSetup({ compact = false }: { compact?: boolean }) {
  const profile = useAi((s) => s.profile)
  const ready = useAi((s) => s.profileReady)
  const setup = useAi((s) => s.setup)
  useEffect(() => {
    void ai.init()
  }, [])
  const mb = ready ? totalSizeMb() : 0
  const busy = setup.running
  const start = () => ai.prepareAll().catch((e: unknown) => useUi.getState().toast(e instanceof Error ? e.message : 'Could not start the AI.', { tone: 'error' }))

  return (
    <div className={compact ? 'p-4' : 'mx-auto max-w-md p-6 text-center'}>
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-shasta-accent/15 text-shasta-accent"><Sparkles className="size-6" /></div>
      <h2 className="text-base font-semibold">Set up Shasta AI</h2>
      <p className="mt-1 text-sm text-shasta-muted">
        The AI runs on this device. Your files, pictures, recordings and the pages you read never leave it. Shasta checks this device and downloads the models that suit it: chat, understanding pictures, and your voice.
      </p>
      <div className="mt-3 rounded-xl bg-shasta-field p-3 text-left text-xs text-shasta-muted" aria-live="polite">
        {ready ? (
          <>
            <p><b className="text-shasta-fg">This device:</b> {profile.memoryGb ? `${profile.memoryGb} GB memory, ` : ''}{profile.cores} CPU cores, {backendFor(profile) === 'webgpu' ? 'graphics chip (WebGPU) available' : 'no WebGPU, so it will use the processor'}.</p>
            <p className="mt-1"><b className="text-shasta-fg">Best fit:</b> the {CHAT_MODELS[activeTier()].label} model plus the picture and speech models, {mb} MB in total, downloaded once.</p>
          </>
        ) : (
          <p>Checking this device…</p>
        )}
      </div>
      {busy ? (
        <div className="mt-4" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-shasta-field"><div className="h-full rounded-full bg-shasta-accent transition-[width]" style={{ width: `${Math.round(setup.progress * 100)}%` }} /></div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-shasta-muted"><Loader2 className="size-3 animate-spin" /> Downloading the {setup.step}… {Math.round(setup.progress * 100)}%</p>
        </div>
      ) : (
        <Button className="mt-4" disabled={!ready} onClick={() => void start()}><Download /> Set up for this device</Button>
      )}
      {setup.error && !busy && <p className="mt-3 text-sm text-shasta-danger" role="alert">{setup.error}</p>}
      <p className="mt-3 text-xs text-shasta-muted">On a school network the download comes from Shasta's own server. You can remove it any time in Settings → AI.</p>
    </div>
  )
}
