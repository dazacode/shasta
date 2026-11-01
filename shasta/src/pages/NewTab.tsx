import { useEffect, useRef, useState } from 'react'
import { LayoutGrid, Mic, Search, SlidersHorizontal, Square } from 'lucide-react'
import { RibbonWallpaper } from '@/components/RibbonWallpaper'
import { WALLPAPERS, effectiveWallpaper, isSeasonalWallpaper, wallpaperBackground } from '@/lib/wallpaper'
import { useSupporter } from '@/stores/supporterStore'
import { Logo } from '@/components/Logo'
import { NewTabCustomizer } from './NewTabCustomizer'
import { cn } from '@/lib/utils'
import { MountainTile } from '@/components/MountainTile'
import { useAssistant } from '@/ai/assistantStore'
import { ai, useAi } from '@/ai/engine'
import { AI_APP_SLUG, snapshot as aiSnapshot } from '@/ai/bridge'
import { useUi } from '@/stores/uiStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTabs } from '@/stores/tabsStore'
import { useSettings } from '@/stores/settingsStore'
import { hexLuma, usePicture } from '@/lib/newTabBackground'
import { SEARCH_ENGINES, resolveInput } from '@/lib/url'
import { useIsPrivateTab } from '@/hooks/usePrivateTab'
import { useStore } from '@/store/storeStore'
import { useStoreBoot } from '@/store/hooks'
import { OnlineCount } from '@/components/LivePulse'
import { Home } from '@/components/home/Home'
import { AdSlot } from '@/components/ads/AdSlot'
import { claimSeasonWallpaper, eventWallpaper, turnOffSeason, useSeason } from '@/lib/seasonal'
import { EVENT_ICON, SeasonPhoto } from '@/components/seasonal/Season'
import { lastDay } from '@/lib/events'

/** Time and date in the person's own locale; the minute is enough, so it ticks every few seconds. */
function Clock({ hour12 }: { hour12: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000)
    return () => {
      clearInterval(t)
    }
  }, [])
  return (
    <div className="mb-6 text-center" aria-label="Current time">
      <p className="text-6xl font-normal tracking-[-0.03em] tabular-nums text-shasta-fg">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 })}</p>
      <p className="mt-1 text-sm text-shasta-muted">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>
  )
}

export function NewTab({ tabId }: { tabId: string }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const settings = useSettings((s) => s.settings)
  const { perks } = useSupporter()
  const isPrivate = useIsPrivateTab()
  const submit = useTabs((s) => s.submit)
  const navigateTo = useTabs((s) => s.navigateTo)

  const [customizing, setCustomizing] = useState(false)
  useStoreBoot()
  const library = useStore((s) => s.library)
  const aiModels = useAi((s) => s.models)
  const [aiReady, setAiReady] = useState(false)
  const hasAiApp = !!library?.installed.some((i) => i.app.slug === AI_APP_SLUG && i.app.store?.official && i.available)
  // Questions go to the Shasta AI app only when it is installed and its on-device models are already downloaded
  useEffect(() => {
    if (!hasAiApp || !settings.ai.enabled) {
      setAiReady(false)
      return
    }
    let stale = false
    void (async () => {
      try {
        await ai.init()
        await ai.refreshCached()
        if (!stale) setAiReady(aiSnapshot().ready)
      } catch {
        if (!stale) setAiReady(false)
      }
    })()
    return () => {
      stale = true
    }
  }, [hasAiApp, settings.ai.enabled, aiModels])
  const aiRoute = settings.newTabStyle === 'immersive' && aiReady
  const fileRef = useRef<HTMLInputElement>(null)
  const style = settings.newTabStyle
  const immersive = style === 'immersive'
  const minimal = style === 'minimal'
  // the minimal page is only the search bar, so it always keeps it
  const showSearch = minimal || settings.newTabSearch
  // a saved supporter wallpaper shows as the default while perks are off; the saved choice is kept
  const picture = usePicture(settings.newTabBg === 'image' ? settings.newTabBgImage : null)
  const customImage = settings.newTabBg === 'image' && picture
  const customColor = settings.newTabBg === 'color'
  const custom = customImage || customColor
  const wallpaper = custom ? 'none' : effectiveWallpaper(settings.wallpaper, perks, settings.claimedWallpapers)
  // the holiday photo replaces the wallpaper while its event is on (lib/events.ts) unless holiday looks are off, and
  // stays for people who claimed it; the person's own picture or colour always wins
  const season = useSeason()
  const seasonLook = season && settings.seasonalLooks && !custom ? season : null
  const photo = seasonLook ? eventWallpaper(seasonLook) : isSeasonalWallpaper(wallpaper) ? wallpaper : null
  const offerClaim = seasonLook && !isPrivate && !settings.claimedWallpapers.includes(eventWallpaper(seasonLook)) ? seasonLook : null
  const ClaimIcon = offerClaim ? EVENT_ICON[offerClaim.event.id] : null
  // text colour follows what is behind it, after the dimming
  const luma = customImage ? picture.luma : customColor ? hexLuma(settings.newTabBgColor) : 1
  const customDark = luma * (1 - settings.newTabBgDim / 100) < 0.5
  const dark = immersive || !!photo || (custom ? customDark : !!WALLPAPERS[wallpaper].dark)
  const greeting = settings.newTabGreetingText.trim() || (isPrivate ? 'Private tab at Shasta' : seasonLook ? seasonLook.greeting : 'Happy to see you at Shasta')
  const headline = settings.newTabHeadlineText.trim() || (seasonLook && !isPrivate ? seasonLook.headline : 'How can I help you?')
  const recording = useAssistant((s) => s.recording)
  const transcribing = useAssistant((s) => s.transcribing)
  const engine = SEARCH_ENGINES[settings.searchEngine].label

  // The picture goes to the on-device assistant: Shasta never uploads it anywhere.
  const pickPicture = (file: File | undefined) => {
    if (!file) return
    if (!settings.ai.enabled) return useUi.getState().toast('Turn on Shasta AI in Settings to search with a picture. It runs on this device.')
    useUi.getState().openAssistant({ text: 'What is in this picture?', image: file, label: 'What is in this picture?' })
  }

  // Dictation runs on the device (Whisper), never through the browser's cloud speech service.
  const toggleMic = async () => {
    if (!settings.ai.enabled) return useUi.getState().toast('Turn on Shasta AI in Settings to speak your search. Your voice stays on this device.')
    if (!navigator.mediaDevices?.getUserMedia) return useUi.getState().toast('This browser cannot reach the microphone here.', { tone: 'error' })
    const ai = useAssistant.getState()
    if (!recording) return void ai.startDictation()
    const text = await ai.stopDictation()
    if (text) setQuery(text)
  }

  // The big search bar: plain questions go to Shasta AI when it can answer on this device. Web addresses, app://
  // links and Shasta pages, and every other case, go through the normal address handling.
  const onFancySearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = query.trim()
    if (!text) return
    if (aiRoute && resolveInput(text, settings.searchEngine).kind === 'search') {
      useUi.getState().setPendingAiPrompt(text.slice(0, 8000))
      await useStore.getState().launchAddress({ slug: AI_APP_SLUG, path: '' })
      setQuery('')
      return
    }
    submit(tabId, query)
  }
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    submit(tabId, query)
  }
  const searchLabel = `Search ${engine} or enter a web address`

  const fancySearch = (
    <form className="nt-search" role="search" onSubmit={(e) => void onFancySearch(e)}>
      <span className="nt-caret" aria-hidden />
      <input aria-label={searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or type a web address" spellCheck={false} autoComplete="off" className="nt-input" />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickPicture(e.target.files?.[0]); e.target.value = '' }} />
      <button type="button" className="nt-eye" aria-label="Search with a picture" title="Search with a picture" onClick={() => fileRef.current?.click()}>
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 11V8a4 4 0 0 1 4-4h3M21 4h3a4 4 0 0 1 4 4v3M28 21v3a4 4 0 0 1-4 4h-3M11 28H8a4 4 0 0 1-4-4v-3" />
          <circle cx="16" cy="16" r="4.6" />
        </svg>
      </button>
      <button type="button" className="nt-mic" data-live={recording} disabled={transcribing} aria-label={recording ? 'Stop and use what I said' : 'Speak your search'} aria-pressed={recording} onClick={() => void toggleMic()}>
        {recording ? <Square fill="currentColor" strokeWidth={0} /> : <Mic strokeWidth={1.5} />}
      </button>
    </form>
  )

  const plainSearch = (
    <form className="flex h-14 w-full max-w-2xl items-center gap-3 rounded-full bg-shasta-home px-5 shadow-sm ring-1 ring-shasta-line transition-shadow duration-150 ease-shasta focus-within:ring-2 focus-within:ring-shasta-accent/60" role="search" onSubmit={onSearch}>
      <Search className="size-5 shrink-0 text-shasta-muted" />
      <input aria-label={searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchLabel} spellCheck={false} autoComplete="off" className="min-w-0 flex-1 bg-transparent text-base text-shasta-fg outline-none placeholder:text-shasta-muted" />
    </form>
  )

  const privateNote = isPrivate && (
    <p role="note" className="mt-8 max-w-md text-center text-xs text-shasta-muted">
      Private tab: Shasta won't save its history, bookmarks or session. Websites can still keep cookies, and the network, the proxy and the sites you visit can still see your activity.
    </p>
  )

  const extras = (
    <div className="nt-extra">
      {!minimal && <Home tabId={tabId} isPrivate={isPrivate} editing={editing} setEditing={setEditing} />}
      <AdSlot className="mt-10" />
      {privateNote}
    </div>
  )

  return (
    <div className={cn(immersive ? 'nt' : 'nt-plain', dark && 'dark', 'text-shasta-fg')} data-wallpaper={wallpaper} data-style={style}>
      {photo ? (
        <SeasonPhoto id={photo} />
      ) : wallpaper === 'ribbon' ? (
        <RibbonWallpaper />
      ) : customImage ? (
        <div
          className="nt-wall nt-wall-photo"
          style={{ backgroundImage: `url("${picture.url}")`, filter: settings.newTabBgBlur ? `blur(${settings.newTabBgBlur}px)` : undefined, inset: settings.newTabBgBlur ? `-${settings.newTabBgBlur * 2}px` : 0 }}
          aria-hidden
        />
      ) : (
        <div className="nt-wall" style={{ background: customColor ? settings.newTabBgColor : wallpaperBackground(wallpaper) }} aria-hidden />
      )}
      {custom && settings.newTabBgDim > 0 && <div className="nt-wall" style={{ background: `rgb(0 0 0 / ${settings.newTabBgDim / 100})` }} aria-hidden />}
      {!minimal && !isPrivate && settings.newTabLive && <OnlineCount onOpenSite={(url) => navigateTo(tabId, url)} />}
      <div className="nt-hero">
        {!minimal && settings.newTabClock !== 'off' && <Clock hour12={settings.newTabClock === '12'} />}
        {immersive && !photo && (
          <svg className="nt-ridge" viewBox="0 0 1600 260" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="nt-ridge-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#262c52" stopOpacity="0.5" />
                <stop offset="1" stopColor="#090b10" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 260 V190 L180 150 L300 176 L470 120 L560 148 L700 96 L800 40 L850 22 L890 44 L930 82 L1040 128 L1190 104 L1320 160 L1460 134 L1600 178 V260 Z" fill="url(#nt-ridge-fill)" />
          </svg>
        )}
        {immersive ? (
          <>
            {settings.newTabLogo && <MountainTile className="nt-logo" />}
            {settings.newTabGreeting && (
              <>
                <p className="nt-greet">{greeting}</p>
                <h1 className="nt-title">{headline}</h1>
              </>
            )}
            {showSearch && (
              <>
                {fancySearch}
                <p className="nt-hint" aria-live="polite">{aiRoute ? 'Questions go to Shasta AI, on this device. Web addresses open as usual.' : `Searches ${engine}. Type a web address to go straight there.`}</p>
              </>
            )}
          </>
        ) : (
          <>
            {!minimal && settings.newTabLogo && (
              <div className="mb-4 grid size-24 place-items-center rounded-3xl bg-shasta-home ring-1 ring-shasta-line">
                <Logo className="size-12 text-shasta-fg" />
              </div>
            )}
            {!minimal && settings.newTabGreeting && (
              <>
                <h1 className="text-4xl font-medium tracking-[-0.03em]">Shasta</h1>
                <p className="mt-2 mb-8 text-shasta-muted">The whole web, in one tab</p>
              </>
            )}
            {showSearch && plainSearch}
          </>
        )}
        {extras}
      </div>
      {offerClaim && ClaimIcon && (
        <div className="nt-claim" role="region" aria-label={`${offerClaim.event.name} background`}>
          <ClaimIcon className="mt-0.5 size-5 shrink-0 text-white/80" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Keep this background?</p>
            <p className="mt-0.5 text-xs text-white/65">Keep it after {offerClaim.event.name}. The offer ends {lastDay(offerClaim.window)}.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => claimSeasonWallpaper(offerClaim)} className="sh-press h-7 rounded-lg bg-white px-3 text-xs font-medium text-black hover:bg-white/85">Keep it</button>
              <button onClick={() => turnOffSeason(offerClaim)} className="sh-press h-7 rounded-lg px-3 text-xs text-white/70 ring-1 ring-white/15 hover:bg-white/10 hover:text-white">Turn off holiday looks</button>
            </div>
          </div>
        </div>
      )}
      {!editing && (
        <div className="nt-corner">
          {!minimal && (
            <button onClick={() => setEditing(true)} className="nt-customize" title="Add, move and resize widgets">
              <LayoutGrid className="size-4" /> <span>Edit page</span>
            </button>
          )}
          <button onClick={() => setCustomizing(true)} className="nt-customize" aria-label="Customize this page" title="Background, style and greeting">
            <SlidersHorizontal className="size-4" /> <span>Customize</span>
          </button>
        </div>
      )}
      <Dialog open={customizing} onOpenChange={setCustomizing}>
        <DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Customize this page</DialogTitle>
          </DialogHeader>
          <NewTabCustomizer
            onEditPage={() => {
              setCustomizing(false)
              setEditing(true)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
