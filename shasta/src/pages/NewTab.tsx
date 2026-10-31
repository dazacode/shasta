import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark as BookmarkIcon, Film, Mic, Pencil, Plus, Search, SlidersHorizontal, Square, Store, Trash2 } from 'lucide-react'
import { RibbonWallpaper } from '@/components/RibbonWallpaper'
import { WALLPAPERS, effectiveWallpaper, wallpaperBackground } from '@/lib/wallpaper'
import { useSupporter } from '@/stores/supporterStore'
import { Logo } from '@/components/Logo'
import { NewTabCustomizer } from './NewTabCustomizer'
import { cn } from '@/lib/utils'
import { MountainTile } from '@/components/MountainTile'
import { useAssistant } from '@/ai/assistantStore'
import { ai, useAi } from '@/ai/engine'
import { AI_APP_SLUG, snapshot as aiSnapshot } from '@/ai/bridge'
import { useUi } from '@/stores/uiStore'
import { Favicon } from '@/components/browser/Favicon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useTabs } from '@/stores/tabsStore'
import { useLibrary, childrenOf } from '@/stores/libraryStore'
import { useSettings, type NewTabSection, type Shortcut } from '@/stores/settingsStore'
import { hexLuma, usePicture } from '@/lib/newTabBackground'
import { SEARCH_ENGINES, displayUrl, hostOf, originOf, resolveInput } from '@/lib/url'
import { uid } from '@/lib/tabModel'
import { useIsPrivateTab } from '@/hooks/usePrivateTab'
import { useStore } from '@/store/storeStore'
import { useStoreBoot } from '@/store/hooks'
import { AppIcon } from '@/store/components'
import { LivePulse, OnlineCount } from '@/components/LivePulse'
import { AdSlot } from '@/components/ads/AdSlot'

function ShortcutTile({ s, onEdit, onRemove, onOpen }: { s: Shortcut; onEdit: () => void; onRemove: () => void; onOpen: () => void }) {
  return (
    <div className="group relative flex w-28 flex-col items-center gap-2">
      <button onClick={onOpen} className="flex w-full flex-col items-center gap-2 rounded-2xl p-2 text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg" title={s.url}>
        <span className="grid size-14 place-items-center rounded-2xl bg-shasta-home">
          <Favicon url={s.url} className="size-7" />
        </span>
        <span className="w-full truncate text-center">{s.title}</span>
      </button>
      <div className="absolute top-0 right-0 flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <button aria-label={`Edit ${s.title}`} onClick={onEdit} className="grid size-6 place-items-center rounded-full bg-shasta-field text-shasta-muted hover:text-shasta-fg">
          <Pencil className="size-3" />
        </button>
        <button aria-label={`Remove ${s.title}`} onClick={onRemove} className="grid size-6 place-items-center rounded-full bg-shasta-field text-shasta-muted hover:text-shasta-danger">
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  )
}

function ShortcutDialog({ editing, onClose }: { editing: Shortcut | 'new' | null; onClose: () => void }) {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [seed, setSeed] = useState<unknown>(null)
  if (editing !== seed) {
    setSeed(editing)
    setTitle(editing && editing !== 'new' ? editing.title : '')
    setUrl(editing && editing !== 'new' ? editing.url : '')
    setError('')
  }

  const save = () => {
    const r = resolveInput(url, settings.searchEngine)
    if (r.kind !== 'url') return setError('Enter a web address such as example.com')
    const entry: Shortcut = { id: editing && editing !== 'new' ? editing.id : uid(), title: title.trim() || hostOf(r.url), url: r.url }
    update({ shortcuts: editing === 'new' ? [...settings.shortcuts, entry] : settings.shortcuts.map((s) => (s.id === entry.id ? entry : s)) })
    onClose()
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing === 'new' ? 'Add shortcut' : 'Edit shortcut'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="grid gap-1 text-xs text-muted-foreground">
            Name
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Example" maxLength={30} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Address
            <Input value={url} onChange={(e) => { setUrl(e.target.value); setError('') }} placeholder="https://example.com" aria-invalid={!!error} spellCheck={false} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The user's installed Store apps: pinned first, then most recently used. Hidden until there is something to show. */
function InstalledApps() {
  useStoreBoot()
  const library = useStore((s) => s.library)
  const launch = useStore((s) => s.launch)
  const openInternal = useTabs((s) => s.openInternal)
  const items = useMemo(() => {
    const ok = (library?.installed ?? []).filter((i) => i.available)
    return [...ok].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastLaunchedAt ?? b.installedAt) - (a.lastLaunchedAt ?? a.installedAt)).slice(0, 8)
  }, [library])
  if (!items.length) return null
  return (
    <section aria-label="Your apps" className="mt-10 w-full">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-shasta-muted">
          <Store className="size-4" /> Your apps
        </h2>
        <button onClick={() => openInternal('library')} className="text-xs text-shasta-accent hover:underline">Library</button>
      </div>
      <ul className="flex flex-wrap gap-x-1 gap-y-2">
        {items.map((i) => (
          <li key={i.app.id} className="w-24">
            <button onClick={() => void launch(i.app.id)} className="relative flex w-full flex-col items-center gap-1.5 rounded-2xl p-2 text-xs text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg" title={i.updateAvailable ? `${i.app.name} (update available)` : i.app.name}>
              <AppIcon app={i.app} size={52} />
              {i.updateAvailable && <span className="absolute top-1 right-3 size-2.5 rounded-full bg-shasta-accent ring-2 ring-shasta-bg" aria-label="Update available" />}
              <span className="w-full truncate text-center">{i.app.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

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
      <p className="text-6xl font-light tracking-tight tabular-nums text-shasta-fg">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 })}</p>
      <p className="mt-1 text-sm text-shasta-muted">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>
  )
}

export function NewTab({ tabId }: { tabId: string }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Shortcut | 'new' | null>(null)
  const settings = useSettings((s) => s.settings)
  const { perks } = useSupporter()
  const update = useSettings((s) => s.update)
  const bookmarks = useLibrary((s) => s.bookmarks)
  const history = useLibrary((s) => s.history)
  const isPrivate = useIsPrivateTab()
  const submit = useTabs((s) => s.submit)
  const navigateTo = useTabs((s) => s.navigateTo)
  const openInternal = useTabs((s) => s.openInternal)

  const topBookmarks = useMemo(() => childrenOf(bookmarks, null).filter((b) => b.type === 'bookmark').slice(0, 8), [bookmarks])
  const recent = useMemo(() => {
    const seen = new Set<string>()
    const out = []
    for (const h of history) {
      const o = originOf(h.url)
      if (!o || seen.has(o)) continue
      seen.add(o)
      out.push(h)
      if (out.length === 6) break
    }
    return out
  }, [history])

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
  // a saved supporter wallpaper shows as the default while perks are off; the saved choice is kept
  const picture = usePicture(settings.newTabBg === 'image' ? settings.newTabBgImage : null)
  const customImage = settings.newTabBg === 'image' && picture
  const customColor = settings.newTabBg === 'color'
  const custom = customImage || customColor
  const wallpaper = custom ? 'none' : effectiveWallpaper(settings.wallpaper, perks)
  // text colour follows what is behind it, after the dimming
  const luma = customImage ? picture.luma : customColor ? hexLuma(settings.newTabBgColor) : 1
  const customDark = luma * (1 - settings.newTabBgDim / 100) < 0.5
  const dark = immersive || (custom ? customDark : !!WALLPAPERS[wallpaper].dark)
  const greeting = settings.newTabGreetingText.trim() || (isPrivate ? 'Private tab at Shasta' : 'Happy to see you at Shasta')
  const headline = settings.newTabHeadlineText.trim() || 'How can I help you?'
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
      <input aria-label={searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search now" spellCheck={false} autoComplete="off" className="nt-input" />
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
    <form className="flex h-14 w-full max-w-2xl items-center gap-3 rounded-full bg-shasta-home px-5 shadow-sm ring-1 ring-shasta-line focus-within:ring-2 focus-within:ring-shasta-accent/60" role="search" onSubmit={onSearch}>
      <Search className="size-5 shrink-0 text-shasta-muted" />
      <input aria-label={searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchLabel} spellCheck={false} autoComplete="off" className="min-w-0 flex-1 bg-transparent text-base text-shasta-fg outline-none placeholder:text-shasta-muted" />
    </form>
  )

  const sections: Record<NewTabSection, React.ReactNode> = {
    shortcuts: !minimal && settings.newTabShortcuts && (
      <section aria-label="Shortcuts" className="mt-10 flex flex-wrap justify-center gap-x-2 gap-y-3">
        {settings.shortcuts.map((s) => (
          <ShortcutTile key={s.id} s={s} onOpen={() => navigateTo(tabId, s.url)} onEdit={() => setEditing(s)} onRemove={() => update({ shortcuts: settings.shortcuts.filter((x) => x.id !== s.id) })} />
        ))}
        <button onClick={() => openInternal('store')} className="flex w-28 flex-col items-center gap-2 rounded-2xl p-2 text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
          <span className="grid size-14 place-items-center rounded-2xl bg-shasta-accent/15">
            <Store className="size-7 text-shasta-accent" />
          </span>
          Store
        </button>
        <button onClick={() => openInternal('watch')} className="flex w-28 flex-col items-center gap-2 rounded-2xl p-2 text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
          <span className="grid size-14 place-items-center rounded-2xl bg-shasta-accent/15">
            <Film className="size-7 text-shasta-accent" />
          </span>
          Watch
        </button>
        {settings.shortcuts.length < 12 && (
          <button onClick={() => setEditing('new')} className="flex w-28 flex-col items-center gap-2 rounded-2xl p-2 text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
            <span className="grid size-14 place-items-center rounded-2xl border border-dashed border-shasta-line">
              <Plus className="size-6" />
            </span>
            Add shortcut
          </button>
        )}
      </section>
    ),

    apps: !minimal && settings.newTabApps && <InstalledApps />,
    live: !minimal && !isPrivate && settings.newTabLive && <LivePulse onOpenSite={(url) => navigateTo(tabId, url)} />,

    bookmarks: !minimal && settings.newTabBookmarks && topBookmarks.length > 0 && (
      <section aria-label="Bookmarks" className="mt-10 w-full">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-shasta-muted">
            <BookmarkIcon className="size-4" /> Bookmarks
          </h2>
          <button onClick={() => openInternal('bookmarks')} className="text-xs text-shasta-accent hover:underline">View all</button>
        </div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {topBookmarks.map((b) =>
            b.type === 'bookmark' ? (
              <li key={b.id}>
                <button onClick={() => navigateTo(tabId, b.url)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-shasta-hover">
                  <Favicon url={b.url} />
                  <span className="min-w-0 flex-1 truncate">{b.title}</span>
                </button>
              </li>
            ) : null,
          )}
        </ul>
      </section>
    ),
    recent: !minimal && !isPrivate && settings.newTabRecent && recent.length > 0 && (
      <section aria-label="Recently visited" className="mt-8 w-full">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-shasta-muted">Recently visited</h2>
          <button onClick={() => openInternal('history')} className="text-xs text-shasta-accent hover:underline">History</button>
        </div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {recent.map((h) => (
            <li key={h.id}>
              <button onClick={() => navigateTo(tabId, h.url)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-shasta-hover">
                <Favicon url={h.url} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{h.title}</span>
                  <span className="block truncate text-xs text-shasta-muted">{displayUrl(h.url)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
  }

  const privateNote = isPrivate && (
    <p role="note" className="mt-8 max-w-md text-center text-xs text-shasta-muted">
      Private tab: Shasta won't save its history, bookmarks or session. Websites can still keep cookies, and the network, the proxy and the sites you visit can still see your activity.
    </p>
  )

  const extras = (
    <div className="nt-extra">
      {settings.newTabOrder.map((k) => (
        <Fragment key={k}>{sections[k]}</Fragment>
      ))}
      <AdSlot className="mt-10" />
      {privateNote}
    </div>
  )

  return (
    <div className={cn(immersive ? 'nt' : 'nt-plain', dark && 'dark', 'text-shasta-fg')} data-wallpaper={wallpaper} data-style={style}>
      {wallpaper === 'ribbon' ? (
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
        {immersive && (
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
            {fancySearch}
            <p className="nt-hint" aria-live="polite">{aiRoute ? 'Questions go to Shasta AI, on this device. Web addresses open as usual.' : `Searches ${engine}. Type a web address to go straight there.`}</p>
          </>
        ) : (
          <>
            {!minimal && settings.newTabLogo && (
              <div className="mb-4 grid size-24 place-items-center rounded-[1.75rem] bg-shasta-home">
                <Logo className="size-12 text-shasta-accent" />
              </div>
            )}
            {!minimal && settings.newTabGreeting && (
              <>
                <h1 className="text-4xl font-semibold tracking-tight">Shasta</h1>
                <p className="mt-1 mb-8 text-shasta-muted">Your web. Your way.</p>
              </>
            )}
            {plainSearch}
          </>
        )}
        {extras}
      </div>
      <button onClick={() => setCustomizing(true)} className="nt-customize" aria-label="Customize this page" title="Customize this page">
        <SlidersHorizontal className="size-4" /> <span>Customize</span>
      </button>
      <Dialog open={customizing} onOpenChange={setCustomizing}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Customize this page</DialogTitle>
          </DialogHeader>
          <NewTabCustomizer />
        </DialogContent>
      </Dialog>
      <ShortcutDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
