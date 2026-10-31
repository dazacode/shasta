import { useEffect, useState, type ReactNode } from 'react'
import { Activity, CloudDownload, Download, Gauge, Globe, HardDrive, Heart, LayoutGrid, Lock, Palette, Sparkles, Upload } from 'lucide-react'
import { PageShell } from './PageShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettings, ACCENTS, DEFAULT_SHORTCUTS, defaultSettings, type AccentName } from '@/stores/settingsStore'
import { useTabs } from '@/stores/tabsStore'
import { useLibrary } from '@/stores/libraryStore'
import { useDownloads } from '@/stores/downloadsStore'
import { useConnection } from '@/stores/connectionStore'
import { useLog } from '@/stores/logStore'
import { useUi } from '@/stores/uiStore'
import { SEARCH_ENGINES, internalSection, resolveInput, type SearchEngine } from '@/lib/url'
import { tabUrl } from '@/lib/tabModel'
import * as proxy from '@/proxy/scramjetAdapter'
import * as direct from '@/proxy/directFrame'
import { useResources } from '@/lib/resourceGuard'
import * as db from '@/lib/db'
import { NewTabCustomizer } from './NewTabCustomizer'
import { downloadProfile, parseProfile, summarize, type Profile } from '@/lib/profile'
import { fromManifest, mergeLocal, emptyLocal } from '@/store/localLibrary'
import { useStore } from '@/store/storeStore'
import { clearTaste } from '@/store/tasteStore'
import { cn } from '@/lib/utils'
import { BASE } from '@/lib/edition'
import { ProxyDisclosureBody } from '@/components/ProxyDisclosure'
import { SiteDataList } from '@/components/SiteDataList'
import { Row, Toggle, Segmented, selectCls } from './settingsParts'
import { AiSection } from './AiSettings'
import { SupporterSection } from './SupporterSettings'
import { OfflineSection } from './OfflineSettings'
import { ConsoleSection } from './ConsoleSection'
import { SupporterBadge } from '@/components/SupporterBadge'
import { useSupporter } from '@/stores/supporterStore'

/** where this build's source is offered (AGPL section 13); required for a public host, see NOTICE.md */
const SOURCE_URL = (import.meta.env.VITE_SOURCE_URL as string | undefined)?.startsWith('https://') ? (import.meta.env.VITE_SOURCE_URL as string) : ''

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'browsing', label: 'Browsing', icon: Globe },
  { id: 'newtab', label: 'New tab page', icon: LayoutGrid },
  { id: 'profile', label: 'Profile & data', icon: HardDrive },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'offline', label: 'Updates & offline', icon: CloudDownload },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'advanced', label: 'Advanced', icon: Activity },
  { id: 'supporter', label: 'Supporter', icon: Heart },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

// ---- sections -------------------------------------------------------------------------

function Appearance() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  return (
    <>
      <Row title="Theme" desc="Match your device or pick one.">
        <Segmented label="Theme" value={s.theme} onChange={(theme) => update({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Row>
      <Row title="Accent colour" desc="Used for focus rings, loading indicators and highlights.">
        <div role="radiogroup" aria-label="Accent colour" className="flex gap-2">
          {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
            <button key={a} role="radio" aria-checked={s.accent === a} aria-label={ACCENTS[a].label} title={ACCENTS[a].label} onClick={() => update({ accent: a })} className={cn('size-7 rounded-full ring-offset-2 ring-offset-shasta-bg', s.accent === a && 'ring-2 ring-shasta-fg')} style={{ background: ACCENTS[a].swatch }} />
          ))}
        </div>
      </Row>
      <Row title="Interface density" desc="Compact makes the tab strip and toolbar smaller.">
        <Segmented label="Interface density" value={s.density} onChange={(density) => update({ density })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
      </Row>
      <Row title="Animations" desc="Reduced turns off transitions and movement. “System” follows your device setting.">
        <Segmented label="Animations" value={s.motion} onChange={(motion) => update({ motion })} options={[{ value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduced' }, { value: 'full', label: 'Full' }]} />
      </Row>
      <Row title="Show bookmarks bar" htmlFor="bm-bar">
        <Toggle id="bm-bar" label="Show bookmarks bar" checked={s.showBookmarksBar} onChange={(showBookmarksBar) => update({ showBookmarksBar })} />
      </Row>
      <Row title="Interface size" desc="Makes text and controls larger throughout Shasta.">
        <Segmented label="Interface size" value={s.uiScale} onChange={(uiScale) => update({ uiScale })} options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }, { value: 'larger', label: 'Larger' }]} />
      </Row>
      <Row title="High contrast" desc="Stronger borders and text colours in Shasta's own interface." htmlFor="hc">
        <Toggle id="hc" label="High contrast" checked={s.highContrast} onChange={(highContrast) => update({ highContrast })} />
      </Row>
    </>
  )
}

function Browsing() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const [home, setHome] = useState(s.homepage)
  const [error, setError] = useState('')
  const saveHome = () => {
    if (!home.trim()) {
      update({ homepage: '', newTabOpensHomepage: false })
      return setError('')
    }
    const r = resolveInput(home, s.searchEngine)
    if (r.kind !== 'url') return setError('Enter a web address such as example.com')
    update({ homepage: r.url })
    setHome(r.url)
    setError('')
  }
  return (
    <>
      <Row title="Search engine" desc="Used for anything you type in the address bar that isn't a web address." htmlFor="engine">
        <select id="engine" className={selectCls} value={s.searchEngine} onChange={(e) => update({ searchEngine: e.target.value as SearchEngine })}>
          {Object.entries(SEARCH_ENGINES).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </Row>
      <Row title="Address bar suggestions" desc="Suggest your bookmarks, history and search predictions as you type. Predictions need the text you type to go to the Shasta server, which asks your search engine for ideas (so the engine sees the server, not you). Nothing is stored. Turn off to keep typing fully on this device." htmlFor="sugg">
        <Toggle id="sugg" label="Address bar suggestions" checked={s.searchSuggestions} onChange={(searchSuggestions) => update({ searchSuggestions })} />
      </Row>
      <Row title="Homepage" desc="Where the Home button goes. Leave empty to use the new tab page." htmlFor="home">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveHome() }}>
          <Input id="home" value={home} onChange={(e) => { setHome(e.target.value); setError('') }} placeholder="New tab page" aria-invalid={!!error} className="w-64" spellCheck={false} />
          <Button type="submit" variant="outline" disabled={home === s.homepage}>Save</Button>
        </form>
        {error && <p className="basis-full text-sm text-shasta-danger">{error}</p>}
      </Row>
      <Row title="Open the homepage in new tabs" desc={s.homepage ? undefined : 'Set a homepage first.'} htmlFor="nthome">
        <Toggle id="nthome" label="Open the homepage in new tabs" checked={s.newTabOpensHomepage} onChange={(newTabOpensHomepage) => update({ newTabOpensHomepage })} />
      </Row>
      <Row title="Restore tabs on startup" desc="Reopen the tabs you had when you last used Shasta. Only the visible tab loads right away." htmlFor="restore">
        <Toggle id="restore" label="Restore tabs on startup" checked={s.restoreSession} onChange={(restoreSession) => update({ restoreSession })} />
      </Row>
    </>
  )
}

function NewTabSettings() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  return (
    <>
      <NewTabCustomizer />
      <Row title="Shortcuts" desc={`${s.shortcuts.length} shortcut${s.shortcuts.length === 1 ? '' : 's'}. Add, edit or remove them directly on the new tab page.`}>
        <Button variant="outline" onClick={() => update({ shortcuts: DEFAULT_SHORTCUTS })}>Restore defaults</Button>
        <Button variant="outline" onClick={() => useTabs.getState().newTab()}>Open a new tab</Button>
      </Row>
    </>
  )
}

function ProfileData() {
  const settings = useSettings((x) => x.settings)
  const bookmarks = useLibrary((x) => x.bookmarks)
  const local = useStore((x) => x.local)
  const [pending, setPending] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const toast = useUi.getState().toast
  const count = bookmarks.filter((b) => b.type === 'bookmark').length

  const exportProfile = () => {
    downloadProfile(settings, bookmarks, local ?? emptyLocal())
    toast('Profile exported. It contains no cookies, passwords or history.', { tone: 'success' })
  }
  const pick = async (file: File | undefined) => {
    setError('')
    setPending(null)
    if (!file) return
    const r = parseProfile(await file.text())
    if (r.ok) setPending(r.profile)
    else setError(r.error)
  }
  const apply = async (mode: 'merge' | 'replace') => {
    if (!pending) return
    if (mode === 'replace' && !confirm('Replace your settings, bookmarks and installed-app list with this profile? What you have now will be lost.')) return
    const lib = fromManifest(pending.library)
    // a replace keeps what never travels in a profile: the connection and this device's supporter pass
    useSettings.getState().update(mode === 'replace' ? { ...defaultSettings(), wispUrl: settings.wispUrl, wispUrls: settings.wispUrls, transport: settings.transport, supporter: settings.supporter, earlyPreviews: settings.earlyPreviews, ...pending.settings } : pending.settings)
    useLibrary.getState().setBookmarks(pending.bookmarks, mode)
    await useStore.getState().replaceLibrary(mode === 'replace' ? lib : mergeLocal(local ?? emptyLocal(), lib))
    setPending(null)
    toast(mode === 'replace' ? 'Profile restored.' : 'Profile merged into this device.', { tone: 'success' })
  }
  const sum = pending && summarize(pending)

  return (
    <>
      <Row title="Where your profile lives" desc="Shasta has no accounts. Your settings, bookmarks, history and installed apps are saved in this browser only, and nothing about them is sent to a server. Clearing this browser's site data, using a private window, or switching to another browser or device starts you from scratch, so export a profile if you want to keep or move it." />
      <Row title="On this device" desc={`${count} bookmark${count === 1 ? '' : 's'}, ${local?.installs.length ?? 0} installed app${local?.installs.length === 1 ? '' : 's'}, ${local?.favorites.length ?? 0} favorite${local?.favorites.length === 1 ? '' : 's'}, ${local?.following.length ?? 0} followed storefront${local?.following.length === 1 ? '' : 's'}.`} />
      <Row title="Export profile" desc="Saves your appearance and browsing preferences, new tab shortcuts, bookmarks and the list of apps you installed (not the apps' own saved data). Never included: cookies, website logins, passwords, tokens, history, downloads.">
        <Button variant="outline" onClick={exportProfile}><Download /> Export profile</Button>
      </Row>
      <Row title="Import profile" desc="Choose a profile file made by Shasta. You'll see what's in it before anything changes.">
        <label className="inline-flex">
          <span className="sr-only">Profile file</span>
          <input type="file" accept="application/json,.json" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-shasta-field file:px-3 file:py-1.5 file:text-sm file:text-shasta-fg" />
        </label>
      </Row>
      {error && <p role="alert" className="py-2 text-sm text-shasta-danger">{error}</p>}
      {pending && sum && (
        <section aria-label="Profile preview" className="my-3 grid gap-3 rounded-2xl bg-shasta-field p-4 text-sm">
          <p><strong>This profile contains:</strong> {sum.settings} setting{sum.settings === 1 ? '' : 's'}, {sum.bookmarks} bookmark{sum.bookmarks === 1 ? '' : 's'}, {sum.apps} installed app{sum.apps === 1 ? '' : 's'}, {sum.favorites} favorite{sum.favorites === 1 ? '' : 's'}.{pending.exportedAt && ` Exported ${new Date(pending.exportedAt).toLocaleDateString()}.`}</p>
          <p className="text-shasta-muted">Apps in the list are added to your Library; they are fetched from the Store when you open them.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void apply('merge')}><Upload /> Add to what I have</Button>
            <Button variant="outline" onClick={() => void apply('replace')}>Replace what I have</Button>
            <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </section>
      )}
    </>
  )
}

type Clearable = 'history' | 'bookmarks' | 'downloads' | 'siteData' | 'session'
const CLEARABLES: { id: Clearable; label: string; desc: string }[] = [
  { id: 'history', label: 'Browsing history', desc: 'Pages you visited, plus cached site icons.' },
  { id: 'downloads', label: 'Download list', desc: 'The list in Shasta. Files already saved stay where they are.' },
  { id: 'siteData', label: 'Site data', desc: 'Cookies, localStorage and IndexedDB that sites stored through the proxy.' },
  { id: 'session', label: 'Saved tabs and recently closed', desc: 'The session used to restore tabs.' },
  { id: 'bookmarks', label: 'Bookmarks', desc: 'All bookmarks and folders. This cannot be undone.' },
]

/** Ads are on for everyone but supporters (owner decision 2026-10-31): there is no free off switch, so this row
 *  explains them and points at the one way to turn them off. */
function AdsRow() {
  const sup = useSupporter()
  const open = useTabs.getState().openInternal
  return (
    <Row
      title="Ads"
      desc={
        sup.perks
          ? "You're a Supporter, so Shasta shows you no ads anywhere. Thank you for keeping it running!"
          : "Shasta shows ads on its own pages (the new tab, the Store, Watch, a strip along the bottom, and pop-unders) to pay for its servers. They never appear inside the sites you open. The ad network (Adsterra) sees your IP address, can set its own cookies and may follow you across the web to choose what to show. Supporters see no ads at all."
      }
    >
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => open('privacy')}>Privacy policy</Button>
        {!sup.perks && <Button size="sm" onClick={() => open('support')}>Remove ads</Button>}
      </div>
    </Row>
  )
}

function Privacy() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const [picked, setPicked] = useState<Set<Clearable>>(new Set(['history', 'siteData']))
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      if (picked.has('history')) {
        await useLibrary.getState().clearHistory('all')
        await useLibrary.getState().clearFavicons()
      }
      if (picked.has('downloads')) await useDownloads.getState().clearAll()
      if (picked.has('siteData')) await proxy.clearSiteData()
      if (picked.has('bookmarks')) await useLibrary.getState().clearBookmarks()
      if (picked.has('session')) useTabs.setState({ closed: [] })
      useUi.getState().toast('Selected data cleared', { tone: 'success' })
    } catch (e) {
      useUi.getState().toast(`Could not clear everything: ${e instanceof Error ? e.message : e}`, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="border-b border-shasta-line py-4" aria-labelledby="proxy-how">
        <h3 id="proxy-how" className="mb-2 text-sm font-medium">How browsing through Shasta works</h3>
        <ProxyDisclosureBody />
      </section>
      <Row title="Save browsing history" desc="When off, new pages are not added to history. Existing history stays until you clear it." htmlFor="savehist">
        <Toggle id="savehist" label="Save browsing history" checked={s.saveHistory} onChange={(saveHistory) => update({ saveHistory })} />
      </Row>
      <Row title="Block ads and trackers" desc="Requests to known ad networks and trackers get an empty answer and never leave the device. A site that needs one of them may break; turn this off for it. Applies to pages loaded after the change." htmlFor="blockads">
        <Toggle id="blockads" label="Block ads and trackers" checked={s.blockAds} onChange={(blockAds) => update({ blockAds })} />
      </Row>
      <AdsRow />
      <Row title="Share anonymous usage counts" desc="Counts which Shasta features and pages are used and the hostname of each site opened (for example example.com, never the page, search or anything you type) so the owner can see what is popular. They go to Shasta's own stats server (Umami, run by the owner, no ad or analytics company), which also sees your browser, device type and rough location, and groups one browser's visits with a code that changes every month; your IP address is not stored. Private tabs are never counted." htmlFor="usagestats">
        <Toggle id="usagestats" label="Share anonymous usage counts" checked={s.usageStats} onChange={(usageStats) => update({ usageStats })} />
      </Row>
      <Row title="Recommendations in the Store" desc="Shows “Picked for you” on the Store's home page, worked out in this browser from the genres and developers of what you open and install here. It never leaves this device: nothing is sent to Shasta's server, synced or put in a profile export, and private tabs are not counted. Turning it off also wipes it." htmlFor="storeforyou">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => (clearTaste(), useUi.getState().toast('Your Store recommendations were reset.'))}>Reset</Button>
          <Toggle id="storeforyou" label="Recommendations in the Store" checked={s.storeForYou} onChange={(storeForYou) => (update({ storeForYou }), !storeForYou && clearTaste())} />
        </div>
      </Row>
      <Row title="Block pop-ups" desc="New tabs a page opens without you clicking are refused. You can still open a blocked one from the notice." htmlFor="blockpopups">
        <Toggle id="blockpopups" label="Block pop-ups" checked={s.blockPopups} onChange={(blockPopups) => update({ blockPopups })} />
      </Row>
      <Row title="Play Watch through Shasta" desc="Watch (anime, TV and films) sends the video through Shasta's own server, so a school filter that blocks the streaming host still lets it play, the CDN's referer rules are met and its ads are stripped by Shasta's ad blocker. Turn it off to fetch video straight from the source (a little faster on an open network, but a filter or CORS can then stop it)." htmlFor="watchproxy">
        <Toggle id="watchproxy" label="Play Watch through Shasta" checked={s.watchProxy} onChange={(watchProxy) => update({ watchProxy })} />
      </Row>
      <Row title="Direct phone connection" desc="A phone you use as a game controller connects straight to this window when the network allows it, so buttons arrive in a few milliseconds instead of going through Shasta's server. To find each other, the phone and this computer learn each other's network address, and Cloudflare's address server (the company that already serves Shasta) sees them too. Turn it off to send every button through Shasta's server: a little slower, and the phone never sees this computer's address." htmlFor="phonedirect">
        <Toggle id="phonedirect" label="Direct phone connection" checked={s.phoneDirect} onChange={(phoneDirect) => update({ phoneDirect })} />
      </Row>
      <fieldset className="border-b border-shasta-line py-4">
        <legend className="text-sm font-medium">Features sites may ask for</legend>
        <p className="mt-0.5 mb-3 text-sm text-shasta-muted">
          Off means blocked outright. On only lets a site ask: your browser still shows its own prompt and nothing is granted automatically. Heads up: every site opened in Shasta shares Shasta's own address, so a permission you grant to one site applies to all of them. Applies to pages loaded after the change.
        </p>
        {([['camera', 'Camera'], ['microphone', 'Microphone'], ['location', 'Location'], ['clipboard', 'Clipboard'], ['devices', 'USB, serial, HID, Bluetooth and MIDI devices']] as const).map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-shasta-hover">
            <span className="text-sm">{label}</span>
            <Toggle id={`access-${key}`} label={label} checked={s.pageAccess[key]} onChange={(v) => update({ pageAccess: { ...s.pageAccess, [key]: v } })} />
          </label>
        ))}
      </fieldset>
      <fieldset className="py-4">
        <legend className="text-sm font-medium">Clear browsing data</legend>
        <p className="mt-0.5 mb-3 text-sm text-shasta-muted">Removes data stored by Shasta on this device.</p>
        <div className="grid gap-1">
          {CLEARABLES.map((c) => (
            <label key={c.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-shasta-hover">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--sh-accent)]" checked={picked.has(c.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })} />
              <span>
                <span className="block text-sm">{c.label}</span>
                <span className="block text-xs text-shasta-muted">{c.desc}</span>
              </span>
            </label>
          ))}
        </div>
        <Button variant="destructive" className="mt-3" disabled={!picked.size || busy} onClick={() => void run()}>
          {busy ? 'Clearing…' : 'Clear selected data'}
        </Button>
        <p className="mt-3 text-xs text-shasta-muted">
          Shasta can only clear what it stored. Your host browser's own cookies, cache and downloads are separate and managed in its settings. Shasta never stores your passwords; sites you sign in to keep their session cookies in the “site data” above.
        </p>
        <SiteDataList />
      </fieldset>
    </>
  )
}

function ResourceMeter() {
  const r = useResources()
  const label = { ok: 'Healthy', high: 'Heavy', critical: 'Critical' }[r.pressure]
  const color = { ok: 'bg-emerald-500', high: 'bg-amber-400', critical: 'bg-red-500' }[r.pressure]
  return (
    <div className="text-right text-sm" role="status" aria-live="polite">
      <span className="flex items-center justify-end gap-2"><span className={cn('size-2.5 rounded-full', color)} aria-hidden />{label}</span>
      <span className="block text-xs text-shasta-muted">
        {r.usedMB != null ? `${r.usedMB} of ${r.limitMB} MB memory · ` : ''}{r.fps != null ? `${r.fps} fps · ` : ''}{r.cpu ? `CPU ${r.cpu} · ` : ''}{r.live}/{r.cap} pages loaded
      </span>
    </div>
  )
}

function Performance() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const tabs = useTabs((x) => x.tabs)
  const live = tabs.filter((t) => t.frame).length
  const suspended = tabs.filter((t) => t.suspended).length
  return (
    <>
      <Row title="Suspend background tabs" desc="Tabs you haven't used for a while release their page to save memory and CPU. They reload when you return to them, so unsaved form input in them is lost." htmlFor="susp">
        <Toggle id="susp" label="Suspend background tabs" checked={s.suspendTabs} onChange={(suspendTabs) => update({ suspendTabs })} />
      </Row>
      <Row title="Protect my device" desc="Watches memory and frame rate. When things get heavy it warns you, and when memory is nearly full it pauses background tabs automatically so the device doesn't freeze or crash. It also limits how many pages stay loaded based on your device's memory." htmlFor="guard">
        <Toggle id="guard" label="Protect my device" checked={s.resourceGuard} onChange={(resourceGuard) => update({ resourceGuard })} />
      </Row>
      <Row title="Automatic cleanup" desc="While your browser is idle, Shasta removes history older than 90 days, site icons you no longer use and old download records. Bookmarks, cookies and open tabs are never touched." htmlFor="cleanup">
        <Toggle id="cleanup" label="Automatic cleanup" checked={s.autoCleanup} onChange={(autoCleanup) => update({ autoCleanup })} />
      </Row>
      <Row title="Resource use" desc="Browsers don't let websites read graphics memory (VRAM), so slowdowns are detected through frame rate and memory pressure instead.">
        <ResourceMeter />
      </Row>
      <Row title="Suspend after" htmlFor="suspmin">
        <select id="suspmin" disabled={!s.suspendTabs} className={cn(selectCls, 'disabled:opacity-50')} value={s.suspendAfterMinutes} onChange={(e) => update({ suspendAfterMinutes: Number(e.target.value) })}>
          {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </select>
      </Row>
      <Row title="Animations" desc="Reduced motion is in Appearance. Background tabs are always hidden and never repainted.">
        <Button variant="outline" onClick={() => update({ motion: s.motion === 'reduced' ? 'full' : 'reduced' })}>{s.motion === 'reduced' ? 'Turn animations on' : 'Reduce animations'}</Button>
      </Row>
      <Row title="Right now" desc={`${tabs.length} tab${tabs.length === 1 ? '' : 's'}: ${live} with a loaded page, ${suspended} suspended.`} />
    </>
  )
}

/** What the host browser really offers to pages (proxied pages run in this same browser, so they get the same). */
function useGraphics() {
  const [info, setInfo] = useState({ webgl: 'checking…', webgpu: 'checking…', isolated: self.crossOriginIsolated ? 'yes' : 'no' })
  useEffect(() => {
    let live = true
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
    const webgl = gl ? String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'available') : 'unavailable'
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null> } }).gpu
    const done = (webgpu: string) => live && setInfo((i) => ({ ...i, webgl, webgpu }))
    if (!gpu) done(window.isSecureContext ? 'not supported by this browser' : 'needs HTTPS')
    else gpu.requestAdapter().then((a) => done(a ? `available${a.info?.vendor ? ` (${a.info.vendor} ${a.info.architecture ?? ''})`.trimEnd() : ''}` : 'no adapter (GPU disabled?)'), () => done('unavailable'))
    return () => {
      live = false
    }
  }, [])
  return info
}

function Advanced() {
  const gfx = useGraphics()
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const info = useConnection((x) => x.info)
  const apply = useConnection((x) => x.applySettings)
  const reconnect = useConnection((x) => x.reconnect)
  const entries = useLog((x) => x.entries)
  const [wisp, setWisp] = useState(s.wispUrl)
  const [transport, setTransport] = useState(s.transport)
  const onDevice = proxy.canRunLocalRelay()
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [storage, setStorage] = useState('')
  const dirty = wisp !== s.wispUrl || transport !== s.transport

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => e.usage != null && setStorage(`${(e.usage / 1048576).toFixed(1)} MB used`))
  }, [])

  const save = async () => {
    try {
      const url = proxy.normalizeWispUrl(wisp)
      update({ wispUrl: url, transport })
      setWisp(url)
      setError('')
      await apply()
      useUi.getState().toast('Connection settings applied')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const stateLabel = { idle: 'Not started', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', disconnected: 'Disconnected', error: 'Failed' }[info.state]
  const dot = info.state === 'connected' ? 'bg-emerald-500' : info.state === 'connecting' || info.state === 'reconnecting' ? 'bg-amber-400' : 'bg-red-500'

  const copyLog = () => {
    const text = entries.map((e) => `${new Date(e.at).toISOString()} ${e.level.toUpperCase()} ${e.message}`).join('\n')
    void navigator.clipboard.writeText(text).then(
      () => useUi.getState().toast('Log copied'),
      () => useUi.getState().toast('Could not copy the log', { tone: 'error' }),
    )
  }

  return (
    <>
      <Row title="Proxy connection" desc={info.detail || undefined}>
        <span className="flex items-center gap-2 text-sm"><span className={cn('size-2.5 rounded-full', dot)} aria-hidden />{stateLabel}{info.latency != null && <span className="text-shasta-muted"> · {info.latency} ms</span>}</span>
        <Button variant="outline" disabled={testing} onClick={async () => { setTesting(true); await reconnect(); setTesting(false) }}>{testing ? 'Checking…' : 'Reconnect'}</Button>
      </Row>
      {direct.available() && (
        <Row title="Page engine" desc="Direct loads each site as itself, so every site works, and private tabs keep their own cookies. Proxy runs sites through Shasta's engine and the on-device relay; some sites (those that build code at run time) do not work there. Open tabs reload in the engine you pick.">
          <Segmented label="Page engine" value={s.pageEngine} onChange={(pageEngine) => update({ pageEngine })} options={[{ value: 'direct', label: 'Direct' }, { value: 'proxy', label: 'Proxy' }]} />
        </Row>
      )}
      <Row title="Transport" desc={onDevice ? 'How the proxy talks to websites. On-device opens connections from this computer, with no relay server; the Wisp servers below are only a fallback. Libcurl and Epoxy always use a Wisp server.' : 'How the proxy talks to websites. Libcurl is the default; Epoxy is an alternative if a site misbehaves.'} htmlFor="transport">
        <select id="transport" className={selectCls} value={transport} onChange={(e) => setTransport(e.target.value as proxy.TransportName)}>
          {onDevice && <option value="local">On-device (no relay)</option>}
          <option value="libcurl">Libcurl</option>
          <option value="epoxy">Epoxy</option>
          {!onDevice && transport === 'local' && <option value="local" disabled>On-device (only in the installed app)</option>}
        </select>
      </Row>
      <Row title="Wisp server URL" desc="Applies immediately; open tabs keep their pages." htmlFor="wisp">
        <Input id="wisp" value={wisp} onChange={(e) => { setWisp(e.target.value); setError('') }} className="w-72" spellCheck={false} aria-invalid={!!error} />
      </Row>
      {error && <p className="-mt-2 mb-2 text-sm text-shasta-danger">{error}</p>}
      <div className="flex justify-end gap-2 pb-4">
        <Button variant="ghost" onClick={() => { setWisp(proxy.defaultWispUrl()); setTransport(defaultSettings().transport) }}>Reset to default</Button>
        <Button disabled={!dirty} onClick={() => void save()}>Apply</Button>
      </div>

      <ConsoleSection />

      <section className="border-t border-shasta-line py-4" aria-label="Diagnostic log">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">Diagnostic log</h2>
            <p className="text-xs text-shasta-muted">Kept in memory only. Addresses are recorded without query strings.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!entries.length} onClick={copyLog}>Copy</Button>
            <Button variant="outline" size="sm" disabled={!entries.length} onClick={() => useLog.getState().clear()}>Clear</Button>
          </div>
        </div>
        <pre className="max-h-56 overflow-auto rounded-xl bg-shasta-field p-3 font-mono text-xs leading-relaxed" tabIndex={0}>
          {entries.length ? entries.map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.level.padEnd(5)}  ${e.message}`).join('\n') : 'Nothing logged yet.'}
        </pre>
      </section>

      <section className="border-t border-shasta-line py-4" aria-label="About">
        <h2 className="mb-2 text-sm font-medium">About</h2>
        <p className="mb-3 max-w-2xl text-sm text-shasta-muted">
          Shasta's browsing runs on{' '}
          <a className="text-shasta-accent hover:underline" href="https://github.com/MercuryWorkshop/scramjet" target="_blank" rel="noreferrer noopener">Scramjet</a>
          , the open-source interception proxy by the{' '}
          <a className="text-shasta-accent hover:underline" href="https://github.com/MercuryWorkshop" target="_blank" rel="noreferrer noopener">Mercury Workshop</a>
          {' '}team, together with their Wisp protocol and the libcurl and epoxy transports. Shasta is a browser interface built on top of that work, and is released under the same AGPL-3.0 license.
        </p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-shasta-muted">Shasta</dt><dd>{__APP_VERSION__}</dd>
          <dt className="text-shasta-muted">License</dt>
          <dd>
            GNU AGPL-3.0 (<a className="text-shasta-accent hover:underline" href={`${BASE}licenses/NOTICE.md`} target="_blank" rel="noreferrer noopener">notices</a>)
            {SOURCE_URL && <> · <a className="text-shasta-accent hover:underline" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">Source code</a></>}
          </dd>
          <dt className="text-shasta-muted">Scramjet engine</dt><dd>{proxy.engineVersion()}</dd>
          <dt className="text-shasta-muted">Service worker</dt><dd>{proxy.serviceWorkerStatus()}</dd>
          <dt className="text-shasta-muted">WebGL renderer</dt><dd className="break-all">{gfx.webgl}</dd>
          <dt className="text-shasta-muted">WebGPU</dt><dd>{gfx.webgpu}</dd>
          <dt className="text-shasta-muted">Cross-origin isolated</dt><dd>{gfx.isolated}{gfx.isolated === 'no' ? ' (some games and apps need this; the server enables it unless CROSS_ORIGIN_ISOLATION=0)' : ''}</dd>
          <dt className="text-shasta-muted">Storage</dt><dd>{storage || 'unknown'}</dd>
          <dt className="text-shasta-muted">Browser</dt><dd className="break-all">{navigator.userAgent}</dd>
        </dl>
        <Button
          variant="destructive"
          className="mt-4"
          onClick={async () => {
            if (!confirm('Reset Shasta? This deletes settings, tabs, bookmarks, history, downloads and site data on this device.')) return
            await proxy.clearSiteData().catch(() => undefined)
            await db.deleteDb()
            localStorage.clear()
            sessionStorage.clear()
            location.reload()
          }}
        >
          Reset Shasta…
        </Button>
      </section>
    </>
  )
}

const BODY: Record<SectionId, () => ReactNode> = {
  appearance: Appearance,
  browsing: Browsing,
  newtab: NewTabSettings,
  profile: ProfileData,
  privacy: Privacy,
  ai: AiSection,
  offline: OfflineSection,
  performance: Performance,
  advanced: Advanced,
  supporter: SupporterSection,
}

export default function SettingsPage() {
  const active = useTabs((s) => s.tabs.find((t) => t.id === s.activeId))
  const hash = active ? internalSection(tabUrl(active)) : ''
  const [picked, setPicked] = useState<SectionId | null>(null)
  const [seenHash, setSeenHash] = useState(hash)
  // a deep link (shasta://settings#privacy) wins over the last click until the link changes again
  if (hash !== seenHash) {
    setSeenHash(hash)
    setPicked(null)
  }
  const section: SectionId = picked ?? (SECTIONS.find((s) => s.id === hash)?.id ?? 'appearance')
  const Body = BODY[section]

  return (
    <PageShell title="Settings" actions={<SupporterBadge />}>
      <div className="grid gap-8 md:grid-cols-[13rem_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setPicked(id)} className={cn('flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm', section === id ? 'bg-shasta-accent/15 font-medium text-shasta-fg' : 'text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg')}>
              <Icon className={cn('size-4', section === id && 'text-shasta-accent')} /> {label}
            </button>
          ))}
        </nav>
        <section aria-labelledby="settings-heading" className="min-w-0">
          <h2 id="settings-heading" className="mb-1 text-lg font-semibold">{SECTIONS.find((s) => s.id === section)!.label}</h2>
          <Body />
        </section>
      </div>
    </PageShell>
  )
}
