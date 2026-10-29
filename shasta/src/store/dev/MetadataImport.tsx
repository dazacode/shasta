import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, Search, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { api, errorMessage } from '../api'
import { useApi, useDebounced } from '../hooks'
import { Chip } from '../components'
import type { DevApp, DevVersion, ImportedMetadata, MetadataCandidate, MetadataField, MetadataProviderInfo } from '../types'
import { Card, fail } from './shared'

const FIELD_LABEL: Record<MetadataField, string> = { name: 'Name', credits: 'Credits', summary: 'Short summary', description: 'Description', tags: 'Tags', category: 'Category', icon: 'Icon', screenshots: 'Screenshots' }
const web = (u?: string) => !!u && /^https?:\/\//i.test(u)

function available(m: ImportedMetadata): MetadataField[] {
  const f: MetadataField[] = []
  if (m.name) f.push('name')
  if (m.credits?.length || m.developer) f.push('credits')
  if (m.summary) f.push('summary')
  if (m.description) f.push('description')
  if (m.tags.length) f.push('tags')
  if (m.category) f.push('category')
  if (m.iconUrl) f.push('icon')
  if (m.screenshotUrls.length) f.push('screenshots')
  return f
}

/** Only fields the app has no value for yet start ticked, so nothing is overwritten by accident. */
function defaults(m: ImportedMetadata, app: DevApp): Set<MetadataField> {
  const empty: Record<MetadataField, boolean> = { name: !app.name, credits: (app.credits ?? []).length === 0, summary: !app.summary, description: !app.description, tags: app.tags.length === 0, category: !app.category, icon: !app.iconUrl, screenshots: app.screenshots.length === 0 }
  return new Set(available(m).filter((f) => empty[f]))
}

export function MetadataImport({ app, draft, onApplied }: { app: DevApp; draft: DevVersion | null; onApplied: (app: DevApp) => void }) {
  const providers = useApi<{ providers: MetadataProviderInfo[] }>('/api/dev/metadata/providers', { live: false })
  const list = (providers.data?.providers ?? []).filter((p) => app.kind === 'package' || p.input !== 'package')
  const [pid, setPid] = useState<string | null>(null)
  const provider = list.find((p) => p.id === pid) ?? null
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 300)
  const [results, setResults] = useState<MetadataCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ id: string; data: ImportedMetadata } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [picked, setPicked] = useState<Set<MetadataField>>(new Set())
  const [applying, setApplying] = useState(false)
  const [outcome, setOutcome] = useState<{ applied: string[]; skipped: string[] } | null>(null)
  const seq = useRef(0)

  const reset = () => (setMeta(null), setResults(null), setErr(null), setOutcome(null))
  const choose = (id: string) => (setPid(id === pid ? null : id), setText(''), reset())

  useEffect(() => {
    if (provider?.input !== 'search') return
    const mine = ++seq.current
    if (q.length < 2) return setResults(null), setSearching(false)
    setSearching(true)
    setErr(null)
    api
      .get<{ results: MetadataCandidate[] }>(`/api/dev/metadata/search?provider=${provider.id}&q=${encodeURIComponent(q)}`)
      .then((r) => mine === seq.current && setResults(r.results))
      .catch((e) => mine === seq.current && (setErr(errorMessage(e)), setResults(null)))
      .finally(() => mine === seq.current && setSearching(false))
  }, [q, provider?.id, provider?.input])

  const preview = async (id: string) => {
    if (!provider) return
    setLoadingPreview(true)
    setErr(null)
    setOutcome(null)
    try {
      const r = await api.get<{ metadata: ImportedMetadata }>(`/api/dev/metadata/preview?provider=${provider.id}&id=${encodeURIComponent(id)}`)
      setMeta({ id, data: r.metadata })
      setPicked(defaults(r.metadata, app))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setLoadingPreview(false)
    }
  }

  const apply = async () => {
    if (!provider || !meta) return
    setApplying(true)
    try {
      const r = await api.post<{ applied: string[]; skipped: string[]; app: DevApp }>(`/api/dev/apps/${app.id}/import`, { provider: provider.id, id: meta.id, fields: [...picked] })
      setOutcome({ applied: r.applied, skipped: r.skipped })
      onApplied(r.app)
      setMeta(null)
    } catch (e) {
      fail(e)
    } finally {
      setApplying(false)
    }
  }

  const packageReady = !!draft?.hasPackage
  return (
    <Card title="Fill in from…" subtitle="Import the name, description, icon and screenshots instead of copying them from another tab.">
      {providers.loading && <p className="text-sm text-shasta-muted">Loading sources…</p>}
      {providers.error && <p className="text-sm text-shasta-danger">{providers.error}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Metadata sources">
        {list.map((p) => (
          <Chip key={p.id} active={p.id === pid} onClick={() => choose(p.id)} disabled={p.input === 'package' && !packageReady} title={p.input === 'package' && !packageReady ? 'Upload a package first' : p.hint}>
            {p.label}
          </Chip>
        ))}
      </div>

      {provider && (
        <div className="mt-4 grid gap-3">
          <p className="text-xs text-shasta-muted">{provider.hint}</p>
          {provider.input === 'search' && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-shasta-muted" aria-hidden />
              <Input aria-label={`Search ${provider.label}`} placeholder={`Search ${provider.label}…`} value={text} onChange={(e) => setText(e.target.value)} className="pl-8" autoComplete="off" />
            </div>
          )}
          {provider.input === 'url' && (
            <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), text.trim() && void preview(text.trim()))}>
              <Input aria-label="Website address" placeholder="https://example.com/my-app" value={text} onChange={(e) => setText(e.target.value)} inputMode="url" spellCheck={false} />
              <Button type="submit" disabled={!text.trim() || loadingPreview}>Read page</Button>
            </form>
          )}
          {provider.input === 'package' && (
            <Button className="w-fit" disabled={!draft || loadingPreview} onClick={() => draft && void preview(draft.id)}>
              <Wand2 /> Read the uploaded package
            </Button>
          )}

          <div aria-live="polite">
            {(searching || loadingPreview) && (
              <p className="flex items-center gap-2 text-sm text-shasta-muted"><Loader2 className="size-4 sh-spin" /> {loadingPreview ? 'Fetching details…' : 'Searching…'}</p>
            )}
            {err && <p role="alert" className="text-sm text-shasta-danger">{err}</p>}
            {provider.input === 'search' && results && !searching && results.length === 0 && <p className="text-sm text-shasta-muted">No results for “{q}”.</p>}
          </div>

          {provider.input === 'search' && results && results.length > 0 && !meta && (
            <ul className="grid gap-1" aria-label="Results">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void preview(c.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-shasta-hover">
                    {web(c.iconUrl) ? <img src={c.iconUrl} alt="" className="size-10 shrink-0 rounded-lg bg-shasta-field object-cover" /> : <span className="size-10 shrink-0 rounded-lg bg-shasta-field" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      {c.subtitle && <span className="block truncate text-xs text-shasta-muted">{c.subtitle}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {meta && (
            <div className="rounded-xl bg-shasta-field p-4">
              <div className="flex items-start gap-3">
                {web(meta.data.iconUrl) && <img src={meta.data.iconUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{meta.data.name}</p>
                  {meta.data.developer && <p className="text-xs text-shasta-muted">{meta.data.developer}</p>}
                  {meta.data.sourceUrl && (
                    <a href={meta.data.sourceUrl} target="_blank" rel="noreferrer noopener" className="mt-0.5 inline-flex items-center gap-1 text-xs text-shasta-accent hover:underline">
                      Source <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </div>
              </div>
              <fieldset className="mt-3 grid gap-2">
                <legend className="mb-1 text-xs font-medium text-shasta-muted">Choose what to import (empty fields are ticked for you)</legend>
                {available(meta.data).map((f) => (
                  <label key={f} className="flex items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-[var(--sh-accent)]"
                      checked={picked.has(f)}
                      onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(f) : n.delete(f); return n })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{FIELD_LABEL[f]}</span>
                      <FieldPreview f={f} m={meta.data} />
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="mt-4 flex gap-2">
                <Button disabled={!picked.size || applying} onClick={() => void apply()}>{applying ? 'Applying…' : 'Apply selected'}</Button>
                <Button variant="ghost" onClick={reset}>Cancel</Button>
              </div>
            </div>
          )}

          {outcome && (
            <p role="status" className={cn('text-sm', outcome.applied.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-shasta-warn')}>
              {outcome.applied.length ? `Imported: ${outcome.applied.join(', ')}.` : 'Nothing was imported.'}
              {outcome.skipped.length > 0 && ` Could not import: ${outcome.skipped.join(', ')}.`}
            </p>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-shasta-muted">
        Sources are free public services (Apple App Store search, Steam, FreeToGame, Wikipedia and website metadata). Imported text and artwork belong to their owners: you are responsible for having the right to use them.
      </p>
    </Card>
  )
}

function FieldPreview({ f, m }: { f: MetadataField; m: ImportedMetadata }) {
  const cls = 'block text-xs text-shasta-muted'
  switch (f) {
    case 'name': return <span className={cls}>{m.name}</span>
    case 'credits': return <span className={cls}>{m.credits?.length ? m.credits.map((c) => `${c.name} (${c.role})`).join(', ') : m.developer}</span>
    case 'summary': return <span className={cls}>{m.summary}</span>
    case 'description': return <span className={cn(cls, 'line-clamp-3')}>{m.description}</span>
    case 'tags': return <span className={cls}>{m.tags.join(', ')}</span>
    case 'category': return <span className={cls}>{m.category}</span>
    case 'icon': return <span className={cls}>{web(m.iconUrl) ? 'Downloaded when applied' : 'From the package'}</span>
    case 'screenshots':
      return (
        <span className="mt-1 flex gap-1.5 overflow-x-auto">
          {m.screenshotUrls.filter(web).slice(0, 5).map((u) => <img key={u} src={u} alt="" className="h-14 rounded-md object-cover" />)}
          {m.screenshotUrls.every((u) => !web(u)) && <span className={cls}>{m.screenshotUrls.length} from the package</span>}
        </span>
      )
  }
}
