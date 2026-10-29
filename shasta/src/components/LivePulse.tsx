// New-tab "live" strip: how many Shasta windows are open right now, and what people are opening (sites many
// people visited since yesterday, and Store apps being installed). Public, anonymous numbers from /api/pulse.
import { useEffect, useState } from 'react'
import { Flame, MessagesSquare } from 'lucide-react'
import { api } from '@/store/api'
import { openLiveSocket } from '@/lib/liveSocket'
import { useStore } from '@/store/storeStore'
import { useTabs } from '@/stores/tabsStore'
import { trackEvent } from '@/lib/usage'
import { AppIcon } from '@/store/components'
import { Favicon } from '@/components/browser/Favicon'
import type { AppCard } from '@/store/types'

interface Pulse {
  online: number
  sites: { name: string; count: number }[]
  apps: AppCard[]
}

export function LivePulse({ onOpenSite }: { onOpenSite: (url: string) => void }) {
  const launch = useStore((s) => s.launch)
  const openInternal = useTabs((s) => s.openInternal)
  const [data, setData] = useState<Pulse | null>(null)
  const [online, setOnline] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .get<Pulse>('/api/pulse')
        .then((p) => {
          if (!alive) return
          setData(p)
          setOnline((n) => n ?? p.online)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 60_000)
    const sock = openLiveSocket(
      '/api/pulse/ws',
      (raw) => {
        try {
          const m = JSON.parse(raw)
          if (m.type === 'online' && typeof m.online === 'number') setOnline(m.online)
        } catch {
          /* ignore */
        }
      },
      () => undefined,
    )
    return () => {
      alive = false
      clearInterval(timer)
      sock.close()
    }
  }, [])

  if (!data) return null
  const sites = data.sites.slice(0, 5)
  const apps = data.apps.slice(0, 5)
  const shown = online ?? data.online
  return (
    <section aria-label="Live on Shasta" className="mt-10 w-full">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-shasta-muted">
          <Flame className="size-4" /> Trending now
        </h2>
        <span className="flex items-center gap-1.5 rounded-full bg-shasta-field px-2.5 py-1 text-xs text-shasta-muted" title="Shasta windows open right now">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="tabular-nums">{shown.toLocaleString()}</span> online
        </span>
      </div>
      <ul className="flex flex-wrap gap-2">
        <li>
          <button
            onClick={() => {
              trackEvent('newtab.chat')
              openInternal('chat')
            }}
            className="flex items-center gap-2 rounded-full bg-shasta-accent/15 py-1.5 pr-3.5 pl-2 text-sm text-shasta-fg hover:bg-shasta-accent/25"
          >
            <MessagesSquare className="size-5 text-shasta-accent" />
            <span>Community chat</span>
          </button>
        </li>
        {apps.map((a) => (
          <li key={a.id}>
            <button onClick={() => void launch(a.id)} className="flex items-center gap-2 rounded-full bg-shasta-home py-1.5 pr-3.5 pl-1.5 text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
              <AppIcon app={a} size={24} />
              <span className="max-w-40 truncate">{a.name}</span>
            </button>
          </li>
        ))}
        {sites.map((s) => (
          <li key={s.name}>
            <button onClick={() => onOpenSite(`https://${s.name}`)} className="flex items-center gap-2 rounded-full bg-shasta-home py-1.5 pr-3.5 pl-2 text-sm text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
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
