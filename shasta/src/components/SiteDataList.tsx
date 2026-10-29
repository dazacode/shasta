import { useState } from 'react'
import { Button } from '@/components/ui/button'
import * as proxy from '@/proxy/scramjetAdapter'
import { useUi } from '@/stores/uiStore'

/** Per-site view of what websites stored (counts only, never values) with a Clear button each. Clearing cookies is how you sign out of a site. */
export function SiteDataList() {
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState<proxy.SiteDataEntry[]>([])
  const refresh = () => setSites(proxy.listSiteData())

  const clear = async (host: string) => {
    try {
      await proxy.clearSiteDataFor(host)
      useUi.getState().toast(`Cleared data for ${host}`, { tone: 'success' })
    } catch (e) {
      useUi.getState().toast(`Could not clear ${host}: ${e instanceof Error ? e.message : e}`, { tone: 'error' })
    }
    refresh()
  }

  return (
    <details className="mt-3" open={open} onToggle={(e) => { const o = e.currentTarget.open; setOpen(o); if (o) refresh() }}>
      <summary className="cursor-pointer text-sm font-medium">Data stored by individual sites</summary>
      <p className="mt-1 mb-2 text-xs text-shasta-muted">
        Clearing a site's cookies signs you out of it in Shasta. Some sites also keep you signed in on their own servers, so signing out on the site itself is the thorough way. Only counts are shown: Shasta never displays or reads cookie values. If a site is missing, it hasn't stored anything we can list; the "Cookies and site data" option above clears everything.
      </p>
      {sites.length === 0 ? (
        <p className="text-sm text-shasta-muted">No site data stored.</p>
      ) : (
        <ul className="grid gap-1">
          {sites.map((s) => (
            <li key={s.host} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-shasta-hover">
              <span className="min-w-0">
                <span className="block truncate text-sm">{s.host}</span>
                <span className="block text-xs text-shasta-muted">{s.cookies} cookie{s.cookies === 1 ? '' : 's'} · {s.storageKeys} stored item{s.storageKeys === 1 ? '' : 's'}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => void clear(s.host)}>Clear</Button>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
