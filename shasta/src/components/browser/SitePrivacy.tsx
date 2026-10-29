import { useState } from 'react'
import * as proxy from '@/proxy/scramjetAdapter'
import { useSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { Switch } from '@/components/ui/switch'

const FEATURES = [['camera', 'Camera'], ['microphone', 'Microphone'], ['location', 'Location'], ['clipboard', 'Clipboard'], ['devices', 'USB / Bluetooth']] as const

/** Cookies (names and flags only, never values) and the features pages may ask for, for the site being viewed. */
export function SitePrivacy({ host }: { host: string }) {
  const access = useSettings((s) => s.settings.pageAccess)
  const update = useSettings((s) => s.update)
  const [cookies, setCookies] = useState(() => proxy.listCookies(host))
  if (!host) return null

  const clear = async () => {
    await proxy.clearSiteDataFor(host)
    setCookies(proxy.listCookies(host))
    useUi.getState().toast(`Cleared cookies and stored data for ${host}. Reload the page to see the effect.`, { tone: 'success' })
  }

  return (
    <div className="mt-2 grid gap-0.5 border-t border-shasta-line pt-2 text-xs">
      <details className="group">
        <summary className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1.5 text-sm hover:bg-shasta-hover">
          Cookies <span className="text-muted-foreground">{cookies.length}</span>
        </summary>
        <div className="px-1 pb-1">
          {cookies.length === 0 ? (
            <p className="text-muted-foreground">None set by this site.</p>
          ) : (
            <ul className="max-h-32 overflow-auto">
              {cookies.map((c, i) => (
                <li key={`${c.domain}${c.name}${i}`} className="truncate py-0.5" title={`${c.domain}${c.secure ? ' · secure' : ''}${c.httpOnly ? ' · hidden from page scripts' : ''}`}>
                  <code>{c.name}</code>
                  <span className="text-muted-foreground"> · {c.expires ? `expires ${new Date(c.expires).toLocaleDateString()}` : 'session'}</span>
                </li>
              ))}
            </ul>
          )}
          <button className="mt-1 text-shasta-accent hover:underline" onClick={() => void clear()}>Clear cookies and data for this site</button>
        </div>
      </details>
      <details>
        <summary className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1.5 text-sm hover:bg-shasta-hover">
          Permissions <span className="text-muted-foreground">{FEATURES.filter(([k]) => access[k]).length} allowed</span>
        </summary>
        <div className="px-1 pb-1">
          <p className="mb-1 text-muted-foreground">Applies to all sites in Shasta. On only lets a site ask; your browser still prompts.</p>
          {FEATURES.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between py-0.5">
              {label}
              <Switch size="sm" aria-label={label} checked={access[key]} onCheckedChange={(v) => update({ pageAccess: { ...access, [key]: v } })} />
            </label>
          ))}
        </div>
      </details>
    </div>
  )
}
