// New-tab "live" pieces: how many Shasta windows are open right now (OnlineCount, at the top of the page), and what
// people are opening (sites many people visited since yesterday, and Store apps being installed). Public, anonymous
// numbers from /api/pulse.
import { useEffect, useState } from 'react'
import { Flame, MessagesSquare } from 'lucide-react'
import { api } from '@/store/api'
import { watchOnline } from '@/lib/pulse'
import { useStore } from '@/store/storeStore'
import { useTabs } from '@/stores/tabsStore'
import { trackEvent } from '@/lib/usage'
import { AppIcon } from '@/store/components'
import { Favicon } from '@/components/browser/Favicon'
import type { AppCard } from '@/store/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** "N online" pill pinned to the top of the new tab. The server sends the count as soon as the socket opens. Hovering
 *  (or clicking) it shows what is popular on Shasta since yesterday, fetched only the first time it opens. */
export function OnlineCount({ onOpenSite }: { onOpenSite: (url: string) => void }) {
  const launch = useStore((s) => s.launch)
  const openInternal = useTabs((s) => s.openInternal)
  const [online, setOnline] = useState<number | null>(null)
  const [data, setData] = useState<Pulse | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    // the window's pulse socket (lib/pulse.ts) is open for as long as the window is; this only listens to it
    return watchOnline(setOnline)
  }, [])
  const load = (open: boolean) => {
    if (!open || data) return
    trackEvent('newtab.online')
    api
      .get<Pulse>('/api/pulse')
      .then(setData)
      .catch(() => setFailed(true))
  }
  if (online === null) return null
  const apps = data?.apps.slice(0, 4) ?? []
  const sites = data?.sites.slice(0, 4) ?? []
  const row = 'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors duration-150 ease-shasta hover:bg-shasta-hover'
  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger openOnHover delay={150} closeDelay={200} className="nt-online" aria-label={`${online.toLocaleString()} online. See what people are opening`}>
        <span className="size-1.5 rounded-full bg-[#4cc38a]" aria-hidden />
        <span className="tabular-nums">{online.toLocaleString()}</span> online
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-2">
        <p className="px-2 pt-1 pb-2 text-xs text-shasta-muted">
          <span className="font-medium text-shasta-fg tabular-nums">{online.toLocaleString()}</span> Shasta {online === 1 ? 'window' : 'windows'} open right now
        </p>
        <button
          onClick={() => {
            trackEvent('newtab.chat')
            openInternal('chat')
          }}
          className={row}
        >
          <MessagesSquare className="size-5 text-shasta-muted" strokeWidth={1.5} />
          <span>Say hi in Community chat</span>
        </button>
        {!data && !failed && <p className="px-2 py-3 text-xs text-shasta-muted">Loading…</p>}
        {failed && <p className="px-2 py-3 text-xs text-shasta-muted">Could not load what is popular right now.</p>}
        {apps.length > 0 && (
          <>
            <p className="px-2 pt-3 pb-1 text-xs font-medium text-shasta-muted">Popular in the Store</p>
            {apps.map((a) => (
              <button key={a.id} onClick={() => void launch(a.id)} className={row}>
                <AppIcon app={a} size={22} />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
              </button>
            ))}
          </>
        )}
        {sites.length > 0 && (
          <>
            <p className="px-2 pt-3 pb-1 text-xs font-medium text-shasta-muted">Sites people opened since yesterday</p>
            {sites.map((x) => (
              <button key={x.name} onClick={() => onOpenSite(`https://${x.name}`)} className={row}>
                <Favicon url={`https://${x.name}`} className="size-5" />
                <span className="min-w-0 flex-1 truncate">{x.name}</span>
                <span className="text-xs text-shasta-muted tabular-nums">{x.count.toLocaleString()}</span>
              </button>
            ))}
          </>
        )}
        {data && apps.length === 0 && sites.length === 0 && <p className="px-2 py-3 text-xs text-shasta-muted">Popular sites and apps show up here as more people use Shasta.</p>}
      </PopoverContent>
    </Popover>
  )
}

interface Pulse {
  online: number
  sites: { name: string; count: number }[]
  apps: AppCard[]
}

/** `embedded`: inside a new tab widget, which draws its own heading. */
export function LivePulse({ onOpenSite, embedded = false }: { onOpenSite: (url: string) => void; embedded?: boolean }) {
  const launch = useStore((s) => s.launch)
  const openInternal = useTabs((s) => s.openInternal)
  const [data, setData] = useState<Pulse | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .get<Pulse>('/api/pulse')
        .then((p) => {
          if (!alive) return
          setData(p)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (!data) return embedded ? <p className="py-3 text-sm text-shasta-muted">Loading what is popular...</p> : null
  const sites = data.sites.slice(0, 5)
  const apps = data.apps.slice(0, 5)
  return (
    <section aria-label="Live on Shasta" className={embedded ? 'w-full' : 'mt-10 w-full'}>
      {!embedded && (
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-shasta-muted">
          <Flame className="size-4" /> Trending now
        </h2>
      )}
      <ul className="flex flex-wrap gap-2">
        <li>
          <button
            onClick={() => {
              trackEvent('newtab.chat')
              openInternal('chat')
            }}
            className="flex h-9 items-center gap-2 rounded-full bg-shasta-home pr-3.5 pl-2 text-sm text-shasta-fg ring-1 ring-shasta-line transition-colors duration-150 ease-shasta hover:bg-shasta-hover"
          >
            <MessagesSquare className="size-5 text-shasta-muted" strokeWidth={1.5} />
            <span>Community chat</span>
          </button>
        </li>
        {apps.map((a) => (
          <li key={a.id}>
            <button onClick={() => void launch(a.id)} className="flex h-9 items-center gap-2 rounded-full bg-shasta-home pr-3.5 pl-1.5 text-sm text-shasta-muted transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg">
              <AppIcon app={a} size={24} />
              <span className="max-w-40 truncate">{a.name}</span>
            </button>
          </li>
        ))}
        {sites.map((s) => (
          <li key={s.name}>
            <button onClick={() => onOpenSite(`https://${s.name}`)} className="flex h-9 items-center gap-2 rounded-full bg-shasta-home pr-3.5 pl-2 text-sm text-shasta-muted transition-colors duration-150 ease-shasta hover:bg-shasta-hover hover:text-shasta-fg">
              <Favicon url={`https://${s.name}`} className="size-5" />
              <span className="max-w-40 truncate">{s.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {sites.length === 0 && apps.length === 0 && <p className="mt-2 text-sm text-shasta-muted">Popular sites and apps show up here as more people use Shasta.</p>}
    </section>
  )
}
