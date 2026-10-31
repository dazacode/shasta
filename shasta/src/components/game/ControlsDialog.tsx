// "Controls": key remaps and the controller layout for the game (or site) in a tab, saved on this device
// (stores/gameControlsStore.ts). Opened from the game splash, the game-mode bar, the main menu and the
// "controller connected" toast. Keys are picked by pressing them, never typed.
import { useEffect, useState } from 'react'
import { ArrowRight, Gamepad2, Keyboard, Plus, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { DPAD_PRESETS, LAYOUTS, MAX_PLAYERS, PAD_BUTTONS, PAD_LABELS, PRESETS, isKnownKey, keyLabel, playerMap, type GameControls, type LayoutName, type PadButton, type PadMap, type PresetName } from '@/lib/gameInput'
import { usePhonePads } from '@/lib/phonePad'
import { usePads } from '@/lib/gamepad'
import { tabTitle, type Tab } from '@/lib/tabModel'
import { cn } from '@/lib/utils'
import { tabBaseControls, tabControlsKey } from '@/hooks/useGameInput'
import { useGameControls } from '@/stores/gameControlsStore'
import { PLAYER_COLORS, PhonePadCard } from './PhonePadCard'
import { useTabs } from '@/stores/tabsStore'

export function ControlsHost() {
  const tabId = useGameControls((s) => s.dialogTab)
  const tab = useTabs((s) => (tabId ? s.tabs.find((t) => t.id === tabId) : undefined))
  if (!tab) return <Dialog open={false} />
  return <ControlsDialog tab={tab} onClose={() => useGameControls.getState().closeDialog()} />
}

type Capture = { kind: 'from' } | { kind: 'to'; from: string } | { kind: 'pad'; button: PadButton; player: number } | null

function Kbd({ code, active, onClick, label }: { code: string | null; active?: boolean; onClick?: () => void; label?: string }) {
  const cls = cn(
    'inline-flex h-7 min-w-9 items-center justify-center rounded-md border px-2 font-mono text-xs',
    active ? 'animate-pulse border-shasta-accent bg-shasta-accent/15 text-shasta-accent' : 'border-shasta-line bg-shasta-field',
    !code && !active && 'text-shasta-muted',
  )
  if (!onClick) return <span className={cls}>{active ? 'Press a key…' : keyLabel(code)}</span>
  return (
    <button type="button" onClick={onClick} className={cn(cls, 'hover:border-shasta-accent')} aria-label={label}>
      {active ? 'Press a key…' : keyLabel(code)}
    </button>
  )
}

function ControlsDialog({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const key = tabControlsKey(tab)
  const saved = useGameControls((s) => (key ? s.profiles[key] : undefined))
  // the game's own defaults (engine + curated layout): re-read when the Store's hint arrives
  useGameControls((s) => (tab.app ? s.hints[tab.app.slug] : undefined))
  const store = useGameControls.getState()
  const base = tabBaseControls(tab)
  const c: GameControls = store.get(key, base)
  const [player, setPlayer] = useState(1)
  const phones = usePhonePads((s) => s.pads)
  const pad = usePads((s) => s.name)
  const pressed = usePads((s) => s.pressed)
  const [capture, setCapture] = useState<Capture>(null)
  const [hint, setHint] = useState('')
  const name = tab.app?.name ?? tabTitle(tab)
  const sandboxed = tab.app?.kind === 'package'

  const save = (next: GameControls) => key && store.set(key, next, base)
  /** a new layout for player `n` (1 = c.pad) */
  const withPlayer = (cur: GameControls, n: number, layout: PadMap | null): GameControls =>
    n <= 1 ? { ...cur, pad: layout ?? cur.pad } : { ...cur, players: cur.players.map((p, i) => (i === n - 2 ? layout : p)) }
  const layout = playerMap(c, player)

  // the live button highlight only runs while the dialog is open
  useEffect(() => {
    usePads.setState({ watching: true })
    return () => {
      usePads.setState({ watching: false, pressed: [] })
    }
  }, [])

  // picking a key: the next key press is the answer (it never reaches Shasta's shortcuts or the page)
  useEffect(() => {
    if (!capture || !key) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.code === 'Escape' && capture.kind !== 'pad') {
        setCapture(null)
        setHint('')
        return
      }
      if (!isKnownKey(e.code)) {
        setHint(`${e.key || e.code} can't be sent to a game. Pick a letter, number, arrow or Space, Enter, Shift…`)
        return
      }
      setHint('')
      const cur = useGameControls.getState().get(key, base)
      if (capture.kind === 'from') setCapture({ kind: 'to', from: e.code })
      else if (capture.kind === 'to') {
        const keys = { ...cur.keys }
        if (e.code === capture.from) delete keys[capture.from]
        else keys[capture.from] = e.code
        useGameControls.getState().set(key, { ...cur, keys }, base)
        setCapture(null)
      } else {
        const now = playerMap(cur, capture.player) ?? (Object.fromEntries(PAD_BUTTONS.map((b) => [b, null])) as PadMap)
        useGameControls.getState().set(key, withPlayer(cur, capture.player, { ...now, [capture.button]: e.code }), base)
        setCapture(null)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [capture, key])

  const applyPreset = (p: PresetName) => save({ ...c, keys: { ...c.keys, ...PRESETS[p].keys } })
  const remaps = Object.entries(c.keys)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Controls for {name}</DialogTitle>
          <DialogDescription>
            {sandboxed
              ? 'This game runs in its own sandbox, so Shasta cannot change its keys. If it supports controllers, it reads yours directly.'
              : 'Saved on this device for this game. Nothing here leaves your browser.'}
          </DialogDescription>
        </DialogHeader>

        {!sandboxed && key && (
          <>
            <section aria-labelledby="ctl-keys">
              <h3 id="ctl-keys" className="mb-2 flex items-center gap-2 text-sm font-semibold"><Keyboard className="size-4" /> Keyboard</h3>
              {remaps.length === 0 && capture?.kind !== 'from' && capture?.kind !== 'to' && <p className="text-xs text-shasta-muted">Every key goes to the game as it is.</p>}
              <ul className="space-y-1.5">
                {remaps.map(([from, to]) => (
                  <li key={from} className="flex items-center gap-2">
                    <Kbd code={from} />
                    <ArrowRight className="size-3.5 text-shasta-muted" aria-hidden />
                    <Kbd code={to} />
                    <span className="flex-1" />
                    <Button size="icon-xs" variant="ghost" aria-label={`Remove ${keyLabel(from)} to ${keyLabel(to)}`} onClick={() => { const keys = { ...c.keys }; delete keys[from]; save({ ...c, keys }) }}>
                      <X />
                    </Button>
                  </li>
                ))}
                {(capture?.kind === 'from' || capture?.kind === 'to') && (
                  <li className="flex items-center gap-2 text-xs">
                    <Kbd code={capture.kind === 'to' ? capture.from : null} active={capture.kind === 'from'} />
                    <ArrowRight className="size-3.5 text-shasta-muted" aria-hidden />
                    <Kbd code={null} active={capture.kind === 'to'} />
                    <span className="text-shasta-muted">{capture.kind === 'from' ? 'Press the key you want to use' : 'Now press the key the game expects'} · Esc cancels</span>
                  </li>
                )}
              </ul>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="xs" variant="secondary" onClick={() => setCapture({ kind: 'from' })}><Plus /> Remap a key</Button>
                {(Object.keys(PRESETS) as PresetName[]).map((p) => (
                  <Button key={p} size="xs" variant="ghost" onClick={() => applyPreset(p)}>{PRESETS[p].label}</Button>
                ))}
              </div>
            </section>

            <section aria-labelledby="ctl-pad" className="border-t border-shasta-line pt-3">
              <h3 id="ctl-pad" className="mb-1 flex items-center gap-2 text-sm font-semibold"><Gamepad2 className="size-4" /> Controllers and players</h3>
              <p className="mb-2 text-xs text-shasta-muted" role="status">{pad ? `${pad} is connected. Press its buttons to see them light up here.` : 'Plug in a controller (or press one of its buttons to wake it up).'}</p>
              <label className="flex items-center justify-between gap-3 py-1 text-sm">
                <span>
                  Send controller buttons to the game as keys
                  <span className="block text-xs text-shasta-muted">Turn this off if the game already supports controllers, or every button counts twice. Phones always send keys.</span>
                </span>
                <Switch checked={c.padToKeys} onCheckedChange={(v) => save({ ...c, padToKeys: v })} aria-label="Send controller buttons as keys" className="data-checked:bg-shasta-accent" />
              </label>
              <label className="flex items-center justify-between gap-3 py-1 text-sm">
                <span>Left stick moves like the D-pad</span>
                <Switch checked={c.stickAsDpad} onCheckedChange={(v) => save({ ...c, stickAsDpad: v })} aria-label="Left stick moves like the D-pad" className="data-checked:bg-shasta-accent" />
              </label>
              <label className="flex items-center justify-between gap-3 py-1 text-sm">
                <span>
                  Phones join as real gamepads
                  <span className="block text-xs text-shasta-muted">For games that support controllers (emulators, 3–4 player games). A player with no keys below always joins as a gamepad.</span>
                </span>
                <Switch checked={c.phonesAsGamepads} onCheckedChange={(v) => save({ ...c, phonesAsGamepads: v })} aria-label="Phones join as real gamepads" className="data-checked:bg-shasta-accent" />
              </label>
              {/* one layout per player: two players share one keyboard, so each needs keys of their own */}
              <div role="tablist" aria-label="Player" className="mt-3 flex gap-1">
                {Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1).map((n) => {
                  const online = phones.some((p) => p.on && p.slot === n)
                  return (
                    <button key={n} role="tab" aria-selected={player === n} onClick={() => { setPlayer(n); setCapture(null) }} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', player === n ? 'bg-shasta-field ring-1 ring-shasta-line' : 'text-shasta-muted hover:bg-shasta-hover')}>
                      <span className="size-2 rounded-full" style={{ background: PLAYER_COLORS[n - 1], opacity: online ? 1 : 0.35 }} aria-hidden />
                      Player {n}{online ? ' · phone' : ''}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-shasta-muted">Layout:</span>
                {(Object.keys(LAYOUTS) as LayoutName[]).map((name) => (
                  <Button key={name} size="xs" variant="ghost" onClick={() => save(withPlayer(c, player, { ...LAYOUTS[name].pad }))}>{LAYOUTS[name].label}</Button>
                ))}
                {player > 1 && <Button size="xs" variant="ghost" onClick={() => save(withPlayer(c, player, null))}>No keys</Button>}
                {layout && (
                  <>
                    <span className="text-shasta-muted">· D-pad:</span>
                    <Button size="xs" variant="ghost" onClick={() => save(withPlayer(c, player, { ...layout, ...DPAD_PRESETS.arrows }))}>Arrows</Button>
                    <Button size="xs" variant="ghost" onClick={() => save(withPlayer(c, player, { ...layout, ...DPAD_PRESETS.wasd }))}>WASD</Button>
                  </>
                )}
              </div>
              {layout ? (
                <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  {PAD_BUTTONS.map((b) => (
                    <li key={b} className={cn('flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-sm', pressed.includes(b) && 'bg-shasta-accent/15')}>
                      <span className={cn('truncate', pressed.includes(b) && 'font-medium text-shasta-accent')}>{PAD_LABELS[b]}</span>
                      <span className="flex items-center gap-1">
                        <Kbd code={layout[b]} active={capture?.kind === 'pad' && capture.button === b && capture.player === player} onClick={() => setCapture({ kind: 'pad', button: b, player })} label={`Player ${player}, ${PAD_LABELS[b]}: ${keyLabel(layout[b])}. Change`} />
                        {layout[b] && (
                          <Button size="icon-xs" variant="ghost" aria-label={`Player ${player}, ${PAD_LABELS[b]}: no key`} onClick={() => save(withPlayer(c, player, { ...layout, [b]: null }))}>
                            <X />
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-shasta-muted">Player {player} has no keys in this game: their phone joins as a real gamepad. Pick a layout above if the game has a player {player} on the keyboard.</p>
              )}
            </section>
            <section aria-label="Phone controller" className="border-t border-shasta-line pt-3">
              <PhonePadCard />
              <p className="mt-1.5 text-xs text-shasta-muted">Each phone plays as the player it joined as, with that player's layout above.</p>
            </section>
            {hint && <p className="text-xs text-shasta-warn" role="alert">{hint}</p>}
          </>
        )}

        <DialogFooter>
          {!sandboxed && key && !!saved && (
            <Button variant="ghost" onClick={() => { setCapture(null); store.reset(key) }}><RotateCcw /> Reset to defaults</Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
