import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { useSettings, defaultSettings, type NewTabBackground, type NewTabClock, type NewTabSection, type NewTabStyle } from '@/stores/settingsStore'
import { ChevronDown, ChevronUp, ImagePlus, Lock, Trash2 } from 'lucide-react'
import { PICTURE_ACCEPT, removePicture, savePicture } from '@/lib/newTabBackground'
import { useUi } from '@/stores/uiStore'
import { WALLPAPERS, isLockedWallpaper, wallpaperBackground, type WallpaperName } from '@/lib/wallpaper'
import { useSupporter } from '@/stores/supporterStore'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'
import { Row, Segmented, Toggle } from './settingsParts'

export function WallpaperPicker() {
  const wallpaper = useSettings((x) => x.settings.wallpaper)
  const update = useSettings((x) => x.update)
  const { perks } = useSupporter()
  return (
    <div role="radiogroup" aria-label="New tab wallpaper" className="flex flex-wrap gap-2">
      {(Object.keys(WALLPAPERS) as WallpaperName[]).map((w) => {
        const locked = isLockedWallpaper(w, perks)
        const label = locked ? `${WALLPAPERS[w].label} (Supporter perk, locked)` : WALLPAPERS[w].label
        return (
          <button
            key={w}
            role="radio"
            aria-checked={wallpaper === w}
            aria-label={label}
            title={locked ? `${WALLPAPERS[w].label}: a Supporter perk. Click to learn more.` : label}
            // a locked preset explains itself instead of being picked
            onClick={() => (locked ? useTabs.getState().openInternal('settings', 'supporter') : update({ wallpaper: w }))}
            className={cn('relative grid size-10 place-items-center overflow-hidden rounded-xl bg-shasta-field text-[10px] text-shasta-muted ring-offset-2 ring-offset-shasta-bg', wallpaper === w && 'ring-2 ring-shasta-fg')}
            style={{ background: wallpaperBackground(w), backgroundColor: 'var(--sh-field)' }}
          >
            {w === 'none' ? 'None' : null}
            {locked && (
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-white" aria-hidden>
                <span className="grid justify-items-center leading-none">
                  <Lock className="size-3" />
                  <span className="mt-0.5 text-[7px] font-medium">Supporter</span>
                </span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

const SWATCHES = ['#0f172a', '#1e293b', '#312e81', '#4c1d95', '#831843', '#7f1d1d', '#14532d', '#134e4a', '#f1f5f9', '#fef3c7']

const SECTION_LABELS: Record<NewTabSection, string> = { shortcuts: 'Shortcuts', apps: 'Your apps', live: "What's trending", bookmarks: 'Bookmarks', recent: 'Recently visited' }

function BackgroundPicker() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasPicture = s.newTabBgImage !== null

  const choose = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const { stamp } = await savePicture(file)
      update({ newTabBg: 'image', newTabBgImage: stamp })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That picture could not be used.')
    } finally {
      setBusy(false)
    }
  }
  const drop = async () => {
    try {
      await removePicture()
    } catch {
      /* nothing stored */
    }
    update({ newTabBg: 'preset', newTabBgImage: null, newTabBgBlur: 0 })
    useUi.getState().toast('Picture removed from this device.')
  }

  return (
    <div className="grid gap-3">
      <Segmented<NewTabBackground>
        label="New tab background"
        value={s.newTabBg}
        onChange={(newTabBg) => update({ newTabBg })}
        options={[{ value: 'preset', label: 'Built-in' }, { value: 'color', label: 'Color' }, { value: 'image', label: 'Your picture' }]}
      />
      {s.newTabBg === 'preset' && <WallpaperPicker />}
      {s.newTabBg === 'color' && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="color" aria-label="Background color" value={s.newTabBgColor} onChange={(e) => update({ newTabBgColor: e.target.value })} className="size-10 cursor-pointer rounded-xl border border-shasta-line bg-transparent p-0.5" />
          {SWATCHES.map((c) => (
            <button
              key={c}
              aria-label={`Use ${c}`}
              onClick={() => update({ newTabBgColor: c })}
              style={{ backgroundColor: c }}
              className={cn('size-8 rounded-full border border-shasta-line ring-offset-2 ring-offset-shasta-bg', s.newTabBgColor.toLowerCase() === c && 'ring-2 ring-shasta-fg')}
            />
          ))}
        </div>
      )}
      {s.newTabBg === 'image' && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className={cn('inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-shasta-line bg-shasta-field px-3 text-sm hover:bg-shasta-hover', busy && 'pointer-events-none opacity-60')}>
              <ImagePlus className="size-4" />
              {busy ? 'Working...' : hasPicture ? 'Choose another picture' : 'Choose a picture'}
              <input type="file" accept={PICTURE_ACCEPT} hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {hasPicture && (
              <Button variant="ghost" onClick={() => void drop()}>
                <Trash2 className="size-4" /> Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-shasta-muted">PNG, JPEG, WebP, AVIF or GIF. It is shrunk and kept on this device only: never uploaded, and not part of a profile export.</p>
          {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
        </div>
      )}
    </div>
  )
}

function Slider({ label, value, max, unit, onChange }: { label: string; value: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" aria-label={label} min={0} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-40 accent-shasta-accent" />
      <span className="w-12 text-right text-xs text-shasta-muted tabular-nums">{value}{unit}</span>
    </div>
  )
}

function SectionOrder() {
  const order = useSettings((x) => x.settings.newTabOrder)
  const update = useSettings((x) => x.update)
  const move = (from: number, to: number) => {
    const next = [...order]
    next.splice(to, 0, next.splice(from, 1)[0])
    update({ newTabOrder: next })
  }
  return (
    <ol className="grid w-56 gap-1">
      {order.map((k, i) => (
        <li key={k} className="flex items-center justify-between rounded-lg bg-shasta-field px-3 py-1.5 text-sm">
          {SECTION_LABELS[k]}
          <span className="flex gap-0.5">
            <button aria-label={`Move ${SECTION_LABELS[k]} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="grid size-6 place-items-center rounded text-shasta-muted hover:text-shasta-fg disabled:opacity-30">
              <ChevronUp className="size-4" />
            </button>
            <button aria-label={`Move ${SECTION_LABELS[k]} down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)} className="grid size-6 place-items-center rounded text-shasta-muted hover:text-shasta-fg disabled:opacity-30">
              <ChevronDown className="size-4" />
            </button>
          </span>
        </li>
      ))}
    </ol>
  )
}

const STYLE_HELP: Record<NewTabStyle, string> = {
  immersive: 'The full page: glowing logo, greeting, big search bar.',
  classic: 'The plain page: small logo, name and a simple search bar.',
  minimal: 'Only a search bar. Nothing else on the page.',
}

/** Every choice for the new tab page, used by the page's own Customize dialog and by Settings. */
export function NewTabCustomizer() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const minimal = s.newTabStyle === 'minimal'
  const d = defaultSettings()
  return (
    <>
      <Row title="Page style" desc={STYLE_HELP[s.newTabStyle]}>
        <Segmented<NewTabStyle>
          label="New tab page style"
          value={s.newTabStyle}
          onChange={(newTabStyle) => update({ newTabStyle })}
          options={[{ value: 'immersive', label: 'Immersive' }, { value: 'classic', label: 'Classic' }, { value: 'minimal', label: 'Minimal' }]}
        />
      </Row>
      <Row title="Background" desc="A built-in wallpaper (the ones with a lock are a thank-you for Supporters), a color, or a picture of your own. Nothing is uploaded.">
        <BackgroundPicker />
      </Row>
      {s.newTabBg !== 'preset' && (
        <Row title="Dim the background" desc="Darker makes the text easier to read.">
          <Slider label="Dim the background" value={s.newTabBgDim} max={80} unit="%" onChange={(newTabBgDim) => update({ newTabBgDim })} />
        </Row>
      )}
      {s.newTabBg === 'image' && s.newTabBgImage && (
        <Row title="Blur the picture">
          <Slider label="Blur the picture" value={s.newTabBgBlur} max={20} unit="px" onChange={(newTabBgBlur) => update({ newTabBgBlur })} />
        </Row>
      )}      {!minimal && (
        <>
          <Row title="Show the logo" htmlFor="nt-logo">
            <Toggle id="nt-logo" label="Show the logo" checked={s.newTabLogo} onChange={(newTabLogo) => update({ newTabLogo })} />
          </Row>
          <Row title="Show greeting and headline" htmlFor="nt-greet">
            <Toggle id="nt-greet" label="Show greeting and headline" checked={s.newTabGreeting} onChange={(newTabGreeting) => update({ newTabGreeting })} />
          </Row>
          {s.newTabStyle === 'immersive' && s.newTabGreeting && (
            <Row title="Your words" desc="Leave empty for the default greeting and headline.">
              <div className="grid w-64 gap-2">
                <Input aria-label="Greeting" maxLength={60} placeholder="Happy to see you at Shasta" value={s.newTabGreetingText} onChange={(e) => update({ newTabGreetingText: e.target.value })} />
                <Input aria-label="Headline" maxLength={60} placeholder="How can I help you?" value={s.newTabHeadlineText} onChange={(e) => update({ newTabHeadlineText: e.target.value })} />
              </div>
            </Row>
          )}
          <Row title="Clock" desc="The time and date above the search bar.">
            <Segmented<NewTabClock>
              label="Clock"
              value={s.newTabClock}
              onChange={(newTabClock) => update({ newTabClock })}
              options={[{ value: 'off', label: 'Off' }, { value: '12', label: '12-hour' }, { value: '24', label: '24-hour' }]}
            />
          </Row>
          <Row title="Show shortcuts" desc="Add, edit or remove them on the page itself." htmlFor="nt-short">
            <Toggle id="nt-short" label="Show shortcuts" checked={s.newTabShortcuts} onChange={(newTabShortcuts) => update({ newTabShortcuts })} />
          </Row>
          <Row title="Show your apps" desc="Installed Store apps, pinned first." htmlFor="ntapps">
            <Toggle id="ntapps" label="Show your apps" checked={s.newTabApps} onChange={(newTabApps) => update({ newTabApps })} />
          </Row>
          <Row title="Show what's trending" desc="How many people are online and the sites and apps they are opening." htmlFor="ntlive">
            <Toggle id="ntlive" label="Show what's trending" checked={s.newTabLive} onChange={(newTabLive) => update({ newTabLive })} />
          </Row>
          <Row title="Show bookmarks" htmlFor="ntbm">
            <Toggle id="ntbm" label="Show bookmarks" checked={s.newTabBookmarks} onChange={(newTabBookmarks) => update({ newTabBookmarks })} />
          </Row>
          <Row title="Show recently visited sites" desc="Needs history saving to be on." htmlFor="recent">
            <Toggle id="recent" label="Show recently visited sites" checked={s.newTabRecent} onChange={(newTabRecent) => update({ newTabRecent })} />
          </Row>
        </>
      )}
      {!minimal && (
        <Row title="Order of the sections" desc="Move the blocks under the search bar up or down. The switches above choose which ones show.">
          <SectionOrder />
        </Row>
      )}
      <Row title="Start over" desc="Back to the default page. Your shortcuts are kept; a picture you chose is removed from this device.">
        <Button
          variant="outline"
          onClick={() => {
            void removePicture().catch(() => {})
            update({
              newTabBg: d.newTabBg, newTabBgColor: d.newTabBgColor, newTabBgImage: null, newTabBgDim: 0, newTabBgBlur: 0, newTabClock: d.newTabClock, newTabOrder: d.newTabOrder,
              newTabStyle: d.newTabStyle, wallpaper: d.wallpaper, newTabLogo: d.newTabLogo, newTabGreeting: d.newTabGreeting, newTabShortcuts: d.newTabShortcuts,
              newTabGreetingText: '', newTabHeadlineText: '', newTabApps: d.newTabApps, newTabLive: d.newTabLive, newTabBookmarks: d.newTabBookmarks, newTabRecent: d.newTabRecent,
            })
          }}
        >
          Reset page
        </Button>
      </Row>
    </>
  )
}
