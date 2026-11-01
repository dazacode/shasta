import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { useSettings, defaultSettings, type NewTabBackground, type NewTabClock, type NewTabStyle, type Settings } from '@/stores/settingsStore'
import { ImagePlus, LayoutGrid, Lock, Trash2 } from 'lucide-react'
import { PICTURE_ACCEPT, removePicture, savePicture } from '@/lib/newTabBackground'
import { useUi } from '@/stores/uiStore'
import { WALLPAPERS, isLockedWallpaper, isSeasonalWallpaper, isUnclaimedWallpaper, wallpaperBackground, type WallpaperName } from '@/lib/wallpaper'
import { claimSeasonWallpaper, eventWallpaper, useSeason } from '@/lib/seasonal'
import { PhotoCredit } from '@/components/seasonal/Season'
import { lastDay } from '@/lib/events'
import { useSupporter } from '@/stores/supporterStore'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'
import { Row, Segmented, Toggle } from './settingsParts'

export function WallpaperPicker() {
  const wallpaper = useSettings((x) => x.settings.wallpaper)
  const claimed = useSettings((x) => x.settings.claimedWallpapers)
  const update = useSettings((x) => x.update)
  const { perks } = useSupporter()
  const season = useSeason()
  const current = season && eventWallpaper(season)
  return (
    <>
    <div role="radiogroup" aria-label="New tab wallpaper" className="flex flex-wrap gap-2">
      {(Object.keys(WALLPAPERS) as WallpaperName[]).map((w) => {
        // a holiday photo shows only to people who claimed it, or while its event is on (picking it claims it)
        if (isUnclaimedWallpaper(w, claimed) && w !== current) return null
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
            onClick={() => (locked ? useTabs.getState().openInternal('settings', 'supporter') : season && w === current && isUnclaimedWallpaper(w, claimed) ? claimSeasonWallpaper(season) : update({ wallpaper: w }))}
            className={cn('relative grid size-10 place-items-center overflow-hidden rounded-xl bg-shasta-field text-[11px] text-shasta-muted ring-offset-2 ring-offset-shasta-bg', wallpaper === w && 'ring-2 ring-shasta-fg')}
            style={{ background: wallpaperBackground(w), backgroundColor: 'var(--sh-field)' }}
          >
            {w === 'none' ? 'None' : null}
            {locked && (
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-white" aria-hidden>
                <Lock className="size-3.5" />
              </span>
            )}
          </button>
        )
      })}
    </div>
    {isSeasonalWallpaper(wallpaper) && <PhotoCredit id={wallpaper} className="mt-2" />}
    </>
  )
}

const SWATCHES = ['#0f172a', '#1e293b', '#312e81', '#4c1d95', '#831843', '#7f1d1d', '#14532d', '#134e4a', '#f1f5f9', '#fef3c7']

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
    <div className="grid w-full min-w-0 gap-3">
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

interface Look {
  id: string
  name: string
  patch: Partial<Settings>
}

/** One click for a whole look: page style + background. The pickers below fine-tune it. */
const LOOKS: Look[] = [
  { id: 'night', name: 'Night', patch: { newTabStyle: 'immersive', newTabBg: 'preset', wallpaper: 'none' } },
  { id: 'ribbons', name: 'Ribbons', patch: { newTabStyle: 'immersive', newTabBg: 'preset', wallpaper: 'ribbon' } },
  { id: 'alpine', name: 'Alpine', patch: { newTabStyle: 'classic', newTabBg: 'preset', wallpaper: 'alpine' } },
  { id: 'forest', name: 'Forest', patch: { newTabStyle: 'classic', newTabBg: 'preset', wallpaper: 'forest' } },
  { id: 'dusk', name: 'Dusk', patch: { newTabStyle: 'classic', newTabBg: 'preset', wallpaper: 'dusk' } },
  { id: 'paper', name: 'Paper', patch: { newTabStyle: 'classic', newTabBg: 'color', newTabBgColor: '#f1f5f9', newTabBgDim: 0 } },
  { id: 'focus', name: 'Just search', patch: { newTabStyle: 'minimal', newTabBg: 'preset', wallpaper: 'none' } },
]

const NIGHT_PREVIEW = 'radial-gradient(60% 60% at 50% 0%, rgb(68 74 140 / 0.7), transparent 70%), #090b10'

function LookPicker() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const current = LOOKS.find((l) => Object.entries(l.patch).every(([k, v]) => s[k as keyof Settings] === v))?.id
  return (
    <div role="radiogroup" aria-label="Looks" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {LOOKS.map((l) => {
        const p = l.patch
        const bg = p.newTabBg === 'color' ? p.newTabBgColor : p.newTabStyle === 'immersive' ? (p.wallpaper === 'ribbon' ? wallpaperBackground('ribbon') : NIGHT_PREVIEW) : wallpaperBackground(p.wallpaper ?? 'none')
        const dark = p.newTabStyle === 'immersive'
        return (
          <button key={l.id} role="radio" aria-checked={current === l.id} onClick={() => update(l.patch)} className="grid gap-1 text-center text-xs text-shasta-muted hover:text-shasta-fg">
            <span
              className={cn('relative grid aspect-[4/3] place-items-center overflow-hidden rounded-lg ring-1 ring-shasta-line ring-offset-2 ring-offset-shasta-bg', current === l.id && 'ring-2 ring-shasta-fg')}
              style={{ background: bg, backgroundColor: dark ? '#090b10' : 'var(--sh-page)' }}
              aria-hidden
            >
              <span className={cn('h-1.5 w-3/5 rounded-full', dark ? 'bg-white/25' : 'bg-black/15')} />
            </span>
            {l.name}
          </button>
        )
      })}
    </div>
  )
}

const STYLE_HELP: Record<NewTabStyle, string> = {
  immersive: 'The full page: glowing logo, greeting, big search bar.',
  classic: 'The plain page: small logo, name and a simple search bar.',
  minimal: 'Only a search bar. Nothing else on the page.',
}

/** A group of rows in the Customize dialog. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="text-[13px] leading-5 text-shasta-muted">{title}</h3>
      <div>{children}</div>
    </section>
  )
}

/** Every choice for the new tab page, used by the page's own Customize dialog and by Settings. */
export function NewTabCustomizer({ onEditPage }: { onEditPage?: () => void } = {}) {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const minimal = s.newTabStyle === 'minimal'
  const season = useSeason()
  const d = defaultSettings()
  return (
    <div className="min-w-0">
      <Group title="Look">
        <Row title="Looks" desc="A whole look in one click. Fine-tune it below." stack>
          <LookPicker />
        </Row>
        <Row title="Page style" desc={STYLE_HELP[s.newTabStyle]} stack>
          <Segmented<NewTabStyle>
            label="New tab page style"
            value={s.newTabStyle}
            onChange={(newTabStyle) => update({ newTabStyle })}
            options={[{ value: 'immersive', label: 'Immersive' }, { value: 'classic', label: 'Classic' }, { value: 'minimal', label: 'Minimal' }]}
          />
        </Row>
        <Row title="Background" desc="Built-in (locked ones are a thank-you for Supporters), a colour, or your own picture. Nothing is uploaded." stack>
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
        )}
        {season && (
          <Row title="Holiday looks" desc={`A ${season.event.name} photo here and holiday colours in the Store and Watch, until ${lastDay(season.window)}.`} htmlFor="nt-season">
            <Toggle id="nt-season" label="Holiday looks" checked={s.seasonalLooks} onChange={(seasonalLooks) => update({ seasonalLooks })} />
          </Row>
        )}
      </Group>

      {!minimal && (
        <Group title="On the page">
          <Row title="Search bar" desc="The address bar at the top still searches." htmlFor="nt-search">
            <Toggle id="nt-search" label="Show the search bar" checked={s.newTabSearch} onChange={(newTabSearch) => update({ newTabSearch })} />
          </Row>
          <Row title="Logo" htmlFor="nt-logo">
            <Toggle id="nt-logo" label="Show the logo" checked={s.newTabLogo} onChange={(newTabLogo) => update({ newTabLogo })} />
          </Row>
          <Row title="Greeting and headline" htmlFor="nt-greet">
            <Toggle id="nt-greet" label="Show greeting and headline" checked={s.newTabGreeting} onChange={(newTabGreeting) => update({ newTabGreeting })} />
          </Row>
          {s.newTabStyle === 'immersive' && s.newTabGreeting && (
            <Row title="Your words" desc="Leave empty for the default." stack>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                <Input aria-label="Greeting" maxLength={60} placeholder="Happy to see you at Shasta" value={s.newTabGreetingText} onChange={(e) => update({ newTabGreetingText: e.target.value })} />
                <Input aria-label="Headline" maxLength={60} placeholder="How can I help you?" value={s.newTabHeadlineText} onChange={(e) => update({ newTabHeadlineText: e.target.value })} />
              </div>
            </Row>
          )}
          <Row title="Clock" desc="Above the greeting.">
            <Segmented<NewTabClock>
              label="Clock"
              value={s.newTabClock}
              onChange={(newTabClock) => update({ newTabClock })}
              options={[{ value: 'off', label: 'Off' }, { value: '12', label: '12-hour' }, { value: '24', label: '24-hour' }]}
            />
          </Row>
          <Row title="Widgets" desc="Schedule, focus timer, notes, to-dos and more. Add, move and resize them on the page.">
            {onEditPage ? (
              <Button variant="outline" onClick={onEditPage} className="gap-1.5">
                <LayoutGrid className="size-4" /> Edit page
              </Button>
            ) : (
              <Button variant="outline" onClick={() => useTabs.getState().newTab()} className="gap-1.5">
                <LayoutGrid className="size-4" /> Open a new tab
              </Button>
            )}
          </Row>
        </Group>
      )}

      <Group title="Start over">
        <Row title="Reset the look" desc="Your widgets and shortcuts stay. A picture you chose is removed from this device.">
          <Button
            variant="outline"
            onClick={() => {
              void removePicture().catch(() => {})
              update({
                newTabBg: d.newTabBg, newTabBgColor: d.newTabBgColor, newTabBgImage: null, newTabBgDim: 0, newTabBgBlur: 0, newTabClock: d.newTabClock, newTabOrder: d.newTabOrder,
                newTabStyle: d.newTabStyle, wallpaper: d.wallpaper, newTabLogo: d.newTabLogo, newTabSearch: d.newTabSearch, newTabGreeting: d.newTabGreeting, newTabShortcuts: d.newTabShortcuts,
                newTabGreetingText: '', newTabHeadlineText: '', newTabApps: d.newTabApps, newTabLive: d.newTabLive, newTabBookmarks: d.newTabBookmarks, newTabRecent: d.newTabRecent,
              })
            }}
          >
            Reset
          </Button>
        </Row>
      </Group>
    </div>
  )
}
