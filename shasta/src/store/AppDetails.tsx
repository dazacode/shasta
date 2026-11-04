import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, Flag, Heart, Share2, ShieldCheck, ShieldX, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTabs } from '@/stores/tabsStore'
import { cn } from '@/lib/utils'
import { formatBytes, formatDate, useApi } from './hooks'
import { useStore, installedMap } from './storeStore'
import { storePath, useStoreNav } from './nav'
import { CREDIT_LABEL } from './types'
import { UninstallDialog } from './UninstallDialog'
import { Chip, AppAction, AppIcon, AppTile, FollowButton, LoadError, Message, OfficialBadge, Section, Shelf, StoreAvatar, addressOf } from './components'
import type { AppDetail } from './types'
import { noteTaste } from './tasteStore'
import { MEDIA_CORS } from '@/lib/appApi'
import { openReport } from './ReportDialog'
import { appShareLink, shareLink } from '@/lib/shareLink'
import { useUi } from '@/stores/uiStore'

function Screenshots({ shots, name }: { shots: string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      <Shelf>
        {shots.map((s, i) => (
          <button key={s} onClick={() => setOpen(i)} aria-label={`Open screenshot ${i + 1} of ${shots.length}`} className="overflow-hidden rounded-xl ring-1 ring-shasta-line transition-shadow duration-150 ease-shasta hover:ring-shasta-fg/25">
            <img crossOrigin={MEDIA_CORS} src={s} alt={`${name} screenshot ${i + 1}`} loading="lazy" className="h-56 w-auto max-w-none bg-shasta-field object-cover" />
          </button>
        ))}
      </Shelf>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent
          className="max-h-[92vh] sm:max-w-4xl"
          aria-label={`${name} screenshot`}
          onKeyDown={(e) => {
            // arrow keys page through, like any image viewer
            if (e.key === 'ArrowRight') (e.preventDefault(), setOpen((o) => (o === null ? o : Math.min(o + 1, shots.length - 1))))
            else if (e.key === 'ArrowLeft') (e.preventDefault(), setOpen((o) => (o === null ? o : Math.max(o - 1, 0))))
          }}
        >
          <DialogTitle className="sr-only">{name} screenshot {open !== null ? open + 1 : ''}</DialogTitle>
          {open !== null && <img crossOrigin={MEDIA_CORS} src={shots[open]} alt={`${name} screenshot ${open + 1}`} className="max-h-[78vh] w-full rounded-lg object-contain" />}
          <div className="flex items-center justify-between">
            <Button variant="ghost" disabled={open === 0} onClick={() => setOpen((o) => (o ?? 1) - 1)}>Previous</Button>
            <span className="font-mono text-xs text-shasta-faint tabular-nums" aria-live="polite">{open !== null ? `${open + 1} of ${shots.length}` : ''}</span>
            <Button variant="ghost" disabled={open === shots.length - 1} onClick={() => setOpen((o) => (o ?? 0) + 1)}>Next</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-shasta-line py-2 text-sm last:border-0">
    <dt className="text-shasta-muted">{k}</dt>
    <dd className="text-right">{v}</dd>
  </div>
)

/** One column of the facts strip under the header: a small label, the value, an optional line under it. */
function Fact({ label, value, sub, onClick }: { label: string; value: React.ReactNode; sub?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="block self-stretch truncate text-xs text-shasta-faint">{label}</span>
      <span className="mt-1 block self-stretch truncate text-sm font-medium">{value}</span>
      {sub && <span className="block self-stretch truncate text-xs text-shasta-muted" title={sub}>{sub}</span>}
    </>
  )
  const cls = 'flex w-full min-w-0 flex-col items-start justify-start px-4 py-3 text-left'
  return (
    <li className="flex min-w-36 flex-1 border-l border-shasta-line first:border-l-0 [&:first-child>*]:pl-0">
      {onClick ? (
        <button type="button" onClick={onClick} className={cn(cls, 'rounded-lg transition-colors duration-150 ease-shasta outline-none hover:text-shasta-fg focus-visible:ring-2 focus-visible:ring-shasta-accent [&:hover>span:nth-child(2)]:underline')}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}

/** Listing placeholder in the page's own shape (icon, title lines, actions), so the layout does not jump when it loads. */
function DetailsSkeleton() {
  return (
    <div className="mx-auto max-w-4xl" aria-busy="true" aria-label="Loading">
      <div className="flex gap-6">
        <div className="size-28 shrink-0 animate-pulse rounded-[25px] bg-shasta-field" />
        <div className="flex-1 space-y-3 pt-1">
          <div className="h-8 w-1/2 animate-pulse rounded-lg bg-shasta-field" />
          <div className="h-4 w-1/4 animate-pulse rounded bg-shasta-field" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-shasta-field" />
          <div className="h-10 w-32 animate-pulse rounded-lg bg-shasta-field pt-2" />
        </div>
      </div>
      <div className="mt-8 h-16 animate-pulse rounded-xl bg-shasta-home" />
      <div className="mt-8 h-56 animate-pulse rounded-xl bg-shasta-home" />
    </div>
  )
}

export default function AppDetails({ slug }: { slug: string }) {
  const { go, tabId } = useStoreNav()
  const { data: app, loading, error, offline, reload } = useApi<AppDetail>(slug ? `/api/catalog/apps/${encodeURIComponent(slug)}` : null)
  const library = useStore((s) => s.library)
  const [uninstalling, setUninstalling] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const mine = app ? installedMap(library).get(app.id) : undefined
  const fav = !!app && !!library?.favorites.some((f) => f.id === app.id)
  // an https link that opens this listing in Shasta for whoever gets it (lib/shareLink.ts)
  const shareable = app ? appShareLink(app.slug) : null

  useEffect(() => {
    if (app) useTabs.getState().setInternalTitle(tabId, `${app.name} – Shasta Store`)
  }, [tabId, app?.name])
  // opening a listing is a (small) taste signal, kept on this device; private tabs leave no trace
  useEffect(() => {
    if (app && !useTabs.getState().tabs.find((t) => t.id === tabId)?.private) noteTaste(app, 'view')
  }, [tabId, app?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <button onClick={() => useTabs.getState().back(tabId)} className="mb-4 flex items-center gap-1.5 text-sm text-shasta-muted hover:text-shasta-fg">
      <ArrowLeft className="size-4" /> Back
    </button>
  )

  if (error && !app) {
    const gone = error.includes('not in the Store')
    return (
      <div className="pt-2">
        {back}
        {gone ? (
          <Message title="This app isn't in the Store" body="It may have been unpublished or removed, or the address is wrong." action={<Button onClick={() => go('/')}>Back to Discover</Button>} />
        ) : (
          <LoadError message={error} offline={offline} onRetry={reload} />
        )}
      </div>
    )
  }
  if (!app) return <div className="pt-2">{back}<DetailsSkeleton /></div>

  // a version only means something once the app has been updated (never for web apps)
  const credits = app.credits ?? []
  const latest = app.hasVersionHistory ? app.versions?.[0] : undefined
  const older = app.hasVersionHistory ? (app.versions ?? []).slice(1) : []
  const linkedHost = app.linkedUrl ? new URL(app.linkedUrl).hostname : null
  const report = () => openReport({ appId: app.id, name: app.name, official: !!app.storefront?.official, isGame: !!app.category?.isGame, kind: app.kind, appVersion: app.version })
  const genres = app.genres ?? []

  return (
    <article className="mx-auto max-w-4xl pt-2" aria-busy={loading}>
      {back}
      <header className="flex flex-wrap items-start gap-6">
        <AppIcon app={app} size={112} className="shadow-sm ring-1 ring-shasta-line" />
        <div className="min-w-0 flex-1">
          <h1 className="sh-title">{app.name}</h1>
          <p className="sh-meta mt-1 select-all">{addressOf(app)}</p>
          <p className="mt-2 text-sm">
            <button onClick={() => go(`/search?q=${encodeURIComponent(app.developer)}`)} className="text-shasta-fg underline-offset-4 hover:underline">{app.developer}</button>
            {app.category && <> <span className="text-shasta-faint">·</span> <button onClick={() => go(`/search?category=${app.category!.id}`)} className="text-shasta-muted hover:underline">{app.category.name}</button></>}
          </p>
          {app.storefront && (
            <div className="sh-theme mt-3 flex flex-wrap items-center gap-2" style={{ ['--sh-hue' as string]: app.storefront.accent }}>
              <button onClick={() => go(storePath(app.storefront!.slug))} className="flex h-9 items-center gap-2 rounded-lg bg-shasta-field pr-3 pl-1.5 text-sm transition-colors duration-150 ease-shasta hover:bg-shasta-hover" aria-label={`Open the ${app.storefront.name} storefront`}>
                <StoreAvatar store={app.storefront} size={24} />
                <span className="font-medium">{app.storefront.name}</span>
                {app.storefront.official && <OfficialBadge />}
              </button>
              {!app.storefront.isMine && <FollowButton quiet store={app.storefront} following={!!library?.following.some((f) => f.id === app.storefront!.id)} />}
            </div>
          )}
          <p className="mt-3 max-w-2xl text-sm text-shasta-muted">{app.summary}</p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <AppAction app={app} size="lg" />
            {mine && <Button variant="ghost" onClick={() => setUninstalling(true)}><Trash2 /> Uninstall</Button>}
            <Button variant="ghost" aria-pressed={fav} onClick={() => void useStore.getState().setFavorite(app.id, !fav)}>
              <Heart className={cn(fav && 'fill-shasta-danger text-shasta-danger')} /> {fav ? 'Favorited' : 'Favorite'}
            </Button>
            {shareable && (
              <Button variant="ghost" onClick={() => void shareLink(shareable, app.name, (msg) => useUi.getState().toast(msg))}>
                <Share2 /> Share
              </Button>
            )}
          </div>
          {mine?.updateAvailable && (
            <div className="mt-4 rounded-xl bg-shasta-home px-4 py-3 text-sm ring-1 ring-shasta-line">
              <p>
                Version {mine.latestVersion} is available. You have {mine.installedVersion || 'an older version'}.{' '}
                {mine.canStay ? 'The developer still offers your version, so updating is up to you.' : 'The developer retired your version, so it updates the next time you open it.'}
              </p>
              {mine.changelog.length > 0 && (
                <ul className="mt-2 grid gap-1.5 text-shasta-muted">
                  {mine.changelog.map((c) => (
                    <li key={c.version}><span className="font-mono text-shasta-fg">{c.version}</span>{c.notes ? <span className="whitespace-pre-line"> {c.notes}</span> : ' No notes.'}</li>
                  ))}
                </ul>
              )}
              {mine.canStay && <p className="mt-2 text-xs text-shasta-muted">Saved progress is kept separately for each version.</p>}
            </div>
          )}
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-shasta-faint">
            <span>No account needed. Your library is kept on this device.</span>
            {/* not one of the page's actions: a quiet link, so Install stays the one thing that stands out */}
            <button type="button" onClick={report} className="inline-flex items-center gap-1 text-shasta-muted underline-offset-4 hover:text-shasta-fg hover:underline">
              <Flag className="size-3.5" aria-hidden /> Report a problem
            </button>
          </p>
        </div>
      </header>

      {/* the facts at a glance, like a store's info strip: only what the Store really knows (no ratings exist) */}
      <ul className="mt-8 flex overflow-x-auto border-y border-shasta-line [scrollbar-width:none]" aria-label="At a glance">
        {genres.length > 0 ? (
          <Fact label={genres.length > 1 ? 'Genres' : 'Genre'} value={genres[0].name} sub={genres.length > 1 ? genres.slice(1, 3).map((g) => g.name).join(', ') : undefined} onClick={() => go(`/search?genre=${encodeURIComponent(genres[0].id)}`)} />
        ) : app.category ? (
          <Fact label="Category" value={app.category.name} onClick={() => go(`/search?category=${app.category!.id}`)} />
        ) : null}
        {app.developer && <Fact label="Made by" value={app.developer} onClick={() => go(`/search?q=${encodeURIComponent(`by ${app.developer}`)}`)} />}
        {app.kind === 'package' ? (
          <Fact label="Type" value="Download" sub="Runs from the Store, works offline" />
        ) : (
          <Fact label="Type" value="Web link" sub={linkedHost ? `Opens ${linkedHost}` : 'Opens its own site'} />
        )}
        {app.kind === 'package' && app.sizeBytes > 0 && <Fact label="Size" value={formatBytes(app.sizeBytes)} sub={`${app.fileCount} files`} />}
        {app.hasVersionHistory && app.updatedAt ? <Fact label="Updated" value={formatDate(app.updatedAt)} sub={app.version ? `Version ${app.version}` : undefined} /> : app.releasedAt ? <Fact label="Added" value={formatDate(app.releasedAt)} /> : null}
      </ul>

      {app.kind === 'linked' && (
        <p className="mt-6 flex items-start gap-2 rounded-xl bg-shasta-field px-4 py-3 text-sm">
          <ExternalLink className="mt-0.5 size-4 shrink-0 text-shasta-muted" aria-hidden />
          <span><strong>Linked web app.</strong> This opens {linkedHost ? <code>{linkedHost}</code> : 'a website'} in a normal Shasta tab through the proxy. It is not uploaded to Shasta, and it can change or go offline at any time.</span>
        </p>
      )}

      {app.screenshots.length > 0 && <Section title="Screenshots" className="mt-8"><Screenshots shots={app.screenshots} name={app.name} /></Section>}

      <Section title="About this app" className="mt-8">
        <p className="max-w-3xl text-sm leading-relaxed whitespace-pre-line">{app.description}</p>
        {(app.genres?.length ?? 0) > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Genres">
            {app.genres!.map((g) => <Chip key={g.id} onClick={() => go(`/search?genre=${encodeURIComponent(g.id)}`)}>{g.name}</Chip>)}
          </div>
        )}
        {app.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {app.tags.map((t) => <button key={t} onClick={() => go(`/search?q=${encodeURIComponent(t)}`)} className="rounded-md bg-shasta-field px-2 py-0.5 font-mono text-xs text-shasta-faint transition-colors duration-150 ease-shasta hover:text-shasta-fg">#{t}</button>)}
          </div>
        )}
      </Section>

      {(credits.length > 0 || app.storefront) && (
        <Section title="Credits" subtitle="The people and studios behind it, then where you found it">
          <ul className="max-w-3xl divide-y divide-shasta-line rounded-2xl bg-shasta-home ring-1 ring-shasta-line">
            {credits.map((c) => (
              <li key={`${c.role}-${c.name}`} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span className="text-shasta-muted">{CREDIT_LABEL[c.role]}</span>
                {c.url ? (
                  <button onClick={() => useTabs.getState().newTab(c.url!)} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline" title={c.url}>{c.name}<ExternalLink className="size-3" aria-hidden /></button>
                ) : (
                  <button onClick={() => go(`/search?q=${encodeURIComponent(c.name)}`)} className="font-medium hover:underline">{c.name}</button>
                )}
              </li>
            ))}
            {app.storefront && (
              <li className="sh-theme flex items-center justify-between gap-4 px-4 py-2.5 text-sm" style={{ ['--sh-hue' as string]: app.storefront.accent }}>
                <span className="text-shasta-muted">On the Store</span>
                <button onClick={() => go(storePath(app.storefront!.slug))} className="inline-flex items-center gap-2 font-medium hover:underline"><StoreAvatar store={app.storefront} size={20} />{app.storefront.name}{app.storefront.official && <OfficialBadge />}</button>
              </li>
            )}
          </ul>
        </Section>
      )}

      {latest && (
        <Section title="What's new" subtitle={`Version ${latest.version}${latest.publishedAt ? ` · ${formatDate(latest.publishedAt)}` : ''}`}>
          <p className="max-w-3xl text-sm whitespace-pre-line">{latest.notes || 'No release notes for this version.'}</p>
          {older.length > 0 && (
            <>
              <button onClick={() => setShowAll(!showAll)} className="mt-3 text-sm text-shasta-muted underline-offset-4 hover:text-shasta-fg hover:underline">{showAll ? 'Hide earlier versions' : `Version history (${older.length} earlier)`}</button>
              {showAll && (
                <ol className="mt-3 grid max-w-3xl gap-3">
                  {older.map((v) => (
                    <li key={v.version} className="rounded-xl bg-shasta-home px-4 py-3 ring-1 ring-shasta-line">
                      <p className="text-sm font-medium">Version {v.version} <span className="font-normal text-shasta-faint">· {formatDate(v.publishedAt)}</span></p>
                      <p className="mt-1 text-sm whitespace-pre-line text-shasta-muted">{v.notes || 'No release notes.'}</p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Section>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Information">
          <dl className="rounded-2xl bg-shasta-home px-4 py-1 ring-1 ring-shasta-line">
            {app.version && <Row k="Version" v={app.version} />}
            <Row k={app.hasVersionHistory ? 'Released' : 'Added'} v={formatDate(app.releasedAt)} />
            {app.hasVersionHistory && <Row k="Last updated" v={formatDate(app.updatedAt)} />}
            <Row k="Category" v={app.category?.name ?? '—'} />
            <Row k="Type" v={app.kind === 'package' ? 'Uploaded package' : 'Linked web app'} />
            {app.kind === 'package' && <Row k="Size" v={`${formatBytes(app.sizeBytes)} · ${app.fileCount} files`} />}
          </dl>
        </Section>
        <Section title="Compatibility & permissions">
          <div className="rounded-2xl bg-shasta-home p-4 text-sm ring-1 ring-shasta-line">
            <p className="text-shasta-muted">{app.runtime.summary}</p>
            <ul className="mt-3 grid gap-1.5">
              {app.runtime.can.map((c) => <li key={c} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-[#4cc38a]" aria-hidden /> {c}</li>)}
              {app.runtime.cannot.map((c) => <li key={c} className="flex gap-2 text-shasta-muted"><ShieldX className="mt-0.5 size-4 shrink-0" aria-hidden /> Cannot: {c.charAt(0).toLowerCase() + c.slice(1)}</li>)}
            </ul>
            <p className="mt-3 flex gap-2 border-t border-shasta-line pt-3 text-xs text-shasta-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> {app.runtime.compatibility}</p>
          </div>
        </Section>
      </div>

      {app.related.length > 0 && (
        <Section title="You might also like">
          <Shelf>{app.related.map((a) => <AppTile key={a.id} app={a} className="w-64" />)}</Shelf>
        </Section>
      )}

      <UninstallDialog app={app} open={uninstalling} onClose={() => setUninstalling(false)} />
    </article>
  )
}


