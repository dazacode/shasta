import { useEffect, useMemo, type ReactNode } from 'react'
import { ArrowLeft, BadgeCheck, Link2, PackageOpen, Pencil, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { internalUrl } from '@/lib/url'
import { shareLink, shareLinkFor } from '@/lib/shareLink'
import { formatDate, useApi } from './hooks'
import { Hero } from './Hero'
import { useStoreNav } from './nav'
import { AppTile, FollowButton, LoadError, Message, OfficialBadge, Section, Shelf, StoreAvatar, StoreCover, StoreTile, TileSkeletons } from './components'
import type { SearchResult, StoreCard, StoreDetail } from './types'

/** The storefront masthead: cover, logo, name, badges, stats. Shared by the page and the editor's live preview. */
export function StorefrontHeader({ store, actions }: { store: Pick<StoreDetail, 'name' | 'tagline' | 'description' | 'accent' | 'logoUrl' | 'bannerUrl' | 'official' | 'apps' | 'followers'>; actions?: ReactNode }) {
  return (
    <header className="overflow-hidden rounded-2xl ring-1 ring-shasta-line">
      <div className="relative">
        <StoreCover store={store} className="h-40 sm:h-56" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" aria-hidden />
        {store.official && (
          <span className="absolute top-4 left-5 inline-flex items-center gap-1.5 rounded-md bg-black/40 px-2 py-1 text-xs text-white sm:left-8">
            <BadgeCheck className="size-4" aria-hidden /> Official Shasta storefront
          </span>
        )}
      </div>
      <div className="bg-shasta-home px-5 pb-6 sm:px-8">
        <div className="-mt-12 flex flex-wrap items-end gap-x-5 gap-y-3">
          <StoreAvatar store={store} size={96} className="relative z-10 shadow-md ring-4 ring-shasta-home" />
          <div className="min-w-0 flex-1 pt-12">
            <h1 className="sh-title flex flex-wrap items-center gap-2">{store.name}{store.official && <OfficialBadge />}</h1>
            {store.tagline && <p className="mt-1 text-sm text-shasta-muted sm:text-base">{store.tagline}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>}
        </div>
        <dl className="mt-6 flex flex-wrap gap-8 text-sm">
          <div><dt className="text-xs text-shasta-muted">Apps</dt><dd className="mt-1 text-xl font-medium tabular-nums">{store.apps}</dd></div>
          <div><dt className="text-xs text-shasta-muted">Followers</dt><dd className="mt-1 text-xl font-medium tabular-nums">{store.followers}</dd></div>
        </dl>
      </div>
    </header>
  )
}

/** One publisher's storefront: their own page in the Store, in their own colour, laid out like a shop. */
export function Storefront({ slug }: { slug: string }) {
  const { go, tabId } = useStoreNav()
  const store = useApi<StoreDetail>(`/api/catalog/stores/${encodeURIComponent(slug)}`)
  const apps = useApi<SearchResult>(`/api/catalog/apps?store=${encodeURIComponent(slug)}&limit=60&sort=newest`)
  const hero = useApi<SearchResult>(`/api/catalog/apps?store=${encodeURIComponent(slug)}&featured=1&sort=featured&limit=8`)
  const s = store.data
  const items = apps.data?.items ?? []

  useEffect(() => {
    if (s) useTabs.getState().setInternalTitle(tabId, `${s.name} – Shasta Store`)
  }, [tabId, s?.name])

  const featured = hero.data?.items ?? []
  const updated = useMemo(() => [...items].filter((a) => a.updatedAt && a.releasedAt && a.updatedAt - a.releasedAt > 60_000).sort((a, b) => b.updatedAt! - a.updatedAt!).slice(0, 8), [items])
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; apps: typeof items }>()
    for (const a of items) {
      const k = a.category?.id ?? 'other'
      if (!m.has(k)) m.set(k, { name: a.category?.name ?? 'Other', apps: [] })
      m.get(k)!.apps.push(a)
    }
    return [...m].map(([id, g]) => ({ id, ...g }))
  }, [items])

  const back = (
    <button onClick={() => useTabs.getState().back(tabId)} className="mb-3 flex items-center gap-1.5 text-sm text-shasta-muted hover:text-shasta-fg">
      <ArrowLeft className="size-4" /> Back
    </button>
  )

  if (store.error && !s) {
    const gone = store.error.includes('does not exist')
    return (
      <div className="pt-2">
        {back}
        {gone ? <Message title="That storefront doesn't exist" body="The address may be wrong, or the publisher changed it." action={<Button onClick={() => go('/stores')}>Browse storefronts</Button>} /> : <LoadError message={store.error} offline={store.offline} onRetry={store.reload} />}
      </div>
    )
  }
  if (!s) return <div className="pt-2">{back}<div className="h-72 animate-pulse rounded-2xl bg-shasta-home" /></div>

  const link = internalUrl('store', `/storefront/${s.slug}`)
  const small = items.length <= 6
  return (
    <div className="sh-theme pt-2 pb-6" style={{ ['--sh-hue' as string]: s.accent }}>
      {back}
      <StorefrontHeader
        store={s}
        actions={
          <>
            <Button variant="ghost" aria-label="Share storefront link" onClick={() => void shareLink(shareLinkFor(link) ?? link, s.name, (msg) => useUi.getState().toast(msg))}>
              <Link2 /> Share
            </Button>
            {s.isMine ? <Button variant="secondary" onClick={() => go('/develop/storefront')}><Pencil /> Edit storefront</Button> : <FollowButton store={s} following={s.following} onChange={store.reload} />}
          </>
        }
      />

      <div className="mt-8">
        {apps.error && !apps.data ? (
          <LoadError message={apps.error} offline={apps.offline} onRetry={apps.reload} />
        ) : !apps.data ? (
          <TileSkeletons n={3} />
        ) : items.length === 0 ? (
          <Message
            icon={<PackageOpen className="size-5" />}
            title="Nothing published here yet"
            body={s.isMine ? 'Upload a game or app from Develop and it will appear on your storefront once it is published.' : 'This storefront has no published apps right now.'}
            action={s.isMine ? <Button onClick={() => go('/develop')}>Open Develop</Button> : undefined}
          />
        ) : (
          <>
            {featured.length > 0 && <Hero apps={featured} />}
            {small ? (
              <Section title={featured.length ? 'All apps' : 'Apps'}>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">{items.map((a) => <AppTile key={a.id} app={a} />)}</div>
              </Section>
            ) : (
              <>
                <Section title="New releases"><Shelf>{items.slice(0, 8).map((a) => <AppTile key={a.id} app={a} className="w-64" />)}</Shelf></Section>
                {updated.length > 0 && <Section title="Recently updated"><Shelf>{updated.map((a) => <AppTile key={a.id} app={a} className="w-64" />)}</Shelf></Section>}
                {groups.map((g) => (
                  <Section key={g.id} title={g.name} subtitle={`${g.apps.length} app${g.apps.length === 1 ? '' : 's'}`}>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">{g.apps.map((a) => <AppTile key={a.id} app={a} />)}</div>
                  </Section>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <Section title={`About ${s.name}`} className="mt-2">
        <div className="max-w-3xl rounded-2xl bg-shasta-home p-5 ring-1 ring-shasta-line">
          {s.description ? <p className="text-sm leading-relaxed whitespace-pre-line">{s.description}</p> : <p className="text-sm text-shasta-muted">This publisher hasn't written an introduction yet.</p>}
          <dl className="mt-4 grid gap-x-8 gap-y-2 border-t border-shasta-line pt-4 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4"><dt className="text-shasta-muted">On the Store since</dt><dd>{formatDate(s.createdAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-shasta-muted">Published apps</dt><dd>{s.apps}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-shasta-muted">Publisher</dt><dd>{s.official ? 'The Shasta team' : 'Approved contributor'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-shasta-muted">Address</dt><dd><code className="sh-meta select-all">{link}</code></dd></div>
          </dl>
          <p className="mt-4 flex gap-2 text-xs text-shasta-faint"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Apps from this storefront run in Shasta's isolated sandbox. They can't see your Shasta account, bookmarks or history.</p>
        </div>
      </Section>
    </div>
  )
}

/** Browse every storefront. */
export function StoresDirectory() {
  const { data, error, offline, reload } = useApi<{ stores: StoreCard[] }>('/api/catalog/stores')
  return (
    <div className="pt-2">
      <h1 className="sh-title">Storefronts</h1>
      <p className="mt-1 mb-6 text-sm text-shasta-muted">Every publisher has their own storefront. Follow the ones you like to hear about new releases.</p>
      {error && !data ? (
        <LoadError message={error} offline={offline} onRetry={reload} />
      ) : !data ? (
        <TileSkeletons n={4} />
      ) : data.stores.length === 0 ? (
        <Message title="No storefronts yet" body="A storefront appears here once its publisher has published something." />
      ) : (
        <>
          {data.stores.filter((s) => s.official).map((s) => <OfficialFeature key={s.id} store={s} />)}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">{data.stores.filter((s) => !s.official).map((s) => <StoreTile key={s.id} store={s} />)}</div>
        </>
      )}
    </div>
  )
}

/** The official storefront gets a wide card at the top of the directory. */
function OfficialFeature({ store }: { store: StoreCard }) {
  const { go } = useStoreNav()
  return (
    <button onClick={() => go(`/storefront/${store.slug}`)} aria-label={`${store.name} official storefront`} className="sh-theme relative mb-6 block w-full overflow-hidden rounded-2xl text-left ring-1 ring-shasta-line transition-shadow duration-150 ease-shasta hover:ring-shasta-fg/25" style={{ ['--sh-hue' as string]: store.accent }}>
      <StoreCover store={store} className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" aria-hidden />
      <div className="relative flex flex-wrap items-center gap-5 p-6 text-white sm:p-8">
        <StoreAvatar store={store} size={84} className="shadow-md ring-1 ring-white/15" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-2xl font-medium tracking-[-0.015em]">{store.name}<span className="inline-flex items-center gap-1 text-xs font-normal tracking-normal text-white/70"><BadgeCheck className="size-3.5" aria-hidden /> Official</span></p>
          <p className="mt-1 max-w-xl text-sm text-white/80">{store.tagline}</p>
          <p className="mt-2 text-xs text-white/60 tabular-nums">{store.apps} app{store.apps === 1 ? '' : 's'}{store.followers > 0 && ` · ${store.followers} follower${store.followers === 1 ? '' : 's'}`}</p>
        </div>
        <span className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Visit storefront</span>
      </div>
    </button>
  )
}
