import { useRef, useState } from 'react'
import { FileArchive, Trash2, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { api, errorMessage, uploadWithProgress } from '../api'
import { formatBytes } from '../hooks'
import { StatusBadge } from '../components'
import type { DevApp, DevVersion, PackageReport } from '../types'
import { Card, Field, ProblemList, fail, ok, textareaClass } from './shared'

function Report({ r }: { r: PackageReport }) {
  return (
    <div className="grid gap-2" aria-live="polite">
      <ProblemList title="This package can't be used yet" items={r.errors} />
      <ProblemList tone="warn" title="Worth a look" items={r.warnings} />
      {r.ok && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Package accepted: {r.fileCount} files, {formatBytes(r.totalBytes)} unpacked, entry point <code>{r.entry}</code>.
        </p>
      )}
    </div>
  )
}

function Dropzone({ vid, onDone }: { vid: string; onDone: (app: DevApp, report: PackageReport) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<(() => void) | null>(null)

  const upload = async (file?: File) => {
    if (!file) return
    setError(null)
    if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) return setError('Choose a .zip file.')
    setProgress(0)
    const up = uploadWithProgress<{ report: PackageReport; app: DevApp }>(`/api/dev/versions/${vid}/package`, file, setProgress)
    abort.current = up.abort
    try {
      const r = await up.promise
      onDone(r.app, r.report)
    } catch (e) {
      if (!(e instanceof DOMException)) setError(errorMessage(e))
    } finally {
      setProgress(null)
      abort.current = null
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => (e.preventDefault(), setDrag(false), void upload(e.dataTransfer.files[0]))}
        className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm focus-within:ring-2 focus-within:ring-shasta-accent', drag ? 'border-shasta-accent bg-shasta-accent/10' : 'border-shasta-line hover:bg-shasta-hover')}
      >
        <input ref={input} type="file" accept=".zip,application/zip" className="sr-only" aria-label="Choose a ZIP package" disabled={progress !== null} onChange={(e) => (void upload(e.target.files?.[0]), (e.target.value = ''))} />
        <UploadCloud className="size-6 text-shasta-muted" aria-hidden />
        <span className="font-medium">Drop a ZIP here or click to choose one</span>
        <span className="text-xs text-shasta-muted">It needs an index.html at the top level. Up to 100 MB. Scripts for servers and executables are rejected.</span>
      </label>
      {progress !== null && (
        <div className="mt-3 flex items-center gap-3" role="status">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-shasta-field" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <div className="h-full bg-shasta-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="w-24 text-xs text-shasta-muted tabular-nums">{progress >= 1 ? 'Validating…' : `${Math.round(progress * 100)}%`}</span>
          <Button size="sm" variant="ghost" aria-label="Cancel upload" onClick={() => abort.current?.()}><X /> Cancel</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-shasta-danger">{error}</p>}
    </div>
  )
}

function NewVersion({ app, onApp }: { app: DevApp; onApp: (a: DevApp) => void }) {
  const last = app.versions[0]?.version
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = app.status === 'published'

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      onApp(await api.post<DevApp>(`/api/dev/apps/${app.id}/versions`, { version: version.trim(), notes, ...(app.kind === 'linked' ? { linkedUrl: url.trim() } : {}) }))
      ok('Draft version created.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), void create())}>
      {live && (
        <p className="rounded-xl bg-shasta-field p-3 text-sm text-shasta-muted">
          Version {app.version} stays live while you work on the next one. Your update replaces it only once it is published{app.canPublishDirectly ? '' : ' (after the Store owner approves it)'}. From then on {app.version} stops working and people move to the new version, unless you choose to keep {app.version} available when you publish.
        </p>
      )}
      <Field label="Version number" hint={last ? `Must be higher than ${last}. Use numbers separated by dots, like 1.1 or 2.0.3.` : 'Use numbers separated by dots, like 1.0.'}>
        <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={last ? 'e.g. 1.1' : '1.0'} className="max-w-40" required />
      </Field>
      {app.kind === 'linked' && (
        <Field label="Web address of the app" hint="Hosted by you, not uploaded to Shasta. People open it in a Shasta tab through the proxy; it can change or go offline at any time.">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/app" inputMode="url" spellCheck={false} required />
        </Field>
      )}
      <Field label="Release notes" hint="Shown to people as “What’s new”.">
        <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder={last ? 'What changed in this version?' : 'Initial release.'} />
      </Field>
      {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
      <Button type="submit" className="w-fit" disabled={busy || !version.trim()}>{busy ? 'Creating…' : 'Create draft version'}</Button>
    </form>
  )
}

function DraftEditor({ app, v, onApp }: { app: DevApp; v: DevVersion; onApp: (a: DevApp) => void }) {
  const [notes, setNotes] = useState(v.notes)
  const [url, setUrl] = useState(v.linkedUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [report, setReport] = useState<PackageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = notes !== v.notes || url !== (v.linkedUrl ?? '')
  // the last failed upload is remembered by the server, so it still shows after a reload
  const shown = report ?? (v.validation && !v.validation.ok ? v.validation : v.validation?.ok ? v.validation : null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onApp(await api.patch<DevApp>(`/api/dev/versions/${v.id}`, { notes, ...(app.kind === 'linked' ? { linkedUrl: url.trim() } : {}) }))
      ok('Version saved.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const discard = async () => {
    if (!confirm(`Delete the draft of version ${v.version}? Its uploaded files are removed.`)) return
    try {
      onApp(await api.del<DevApp>(`/api/dev/versions/${v.id}`))
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileArchive className="size-4 text-shasta-muted" aria-hidden />
        <span className="font-medium">Version {v.version}</span>
        <StatusBadge status="draft" />
        <span className="flex-1" />
        <Button size="sm" variant="destructive" onClick={() => void discard()}><Trash2 /> Delete draft</Button>
      </div>
      {app.kind === 'package' ? (
        <>
          {v.hasPackage && <p className="text-sm text-shasta-muted">A package is attached ({v.fileCount} files, {formatBytes(v.sizeBytes)}). Uploading another ZIP replaces it while this version is still a draft.</p>}
          <Dropzone vid={v.id} onDone={(a, r) => (setReport(r), onApp(a), r.ok && ok('Package validated and stored.'))} />
          {shown && <Report r={shown} />}
        </>
      ) : (
        <Field label="Web address of the app" hint="Hosted by you; opens through Shasta's proxy.">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" spellCheck={false} />
        </Field>
      )}
      <Field label="Release notes">
        <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      {error && <p role="alert" className="text-sm text-shasta-danger">{error}</p>}
      <Button className="w-fit" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save version'}</Button>
    </div>
  )
}

export function VersionPanel({ app, onApp }: { app: DevApp; onApp: (a: DevApp) => void }) {
  const draft = app.versions.find((v) => v.state === 'draft')
  const pending = app.versions.find((v) => v.state === 'pending')
  return (
    <Card id="version" title="3 · Version & package" subtitle={app.kind === 'package' ? 'Upload your HTML5 app as a ZIP. It is validated before anything is stored.' : 'A linked app points at a website you host; nothing is uploaded.'}>
      {app.status === 'removed' ? (
        <p className="text-sm text-shasta-muted">This app was removed, so it can't take new versions.</p>
      ) : draft ? (
        <DraftEditor key={draft.id} app={app} v={draft} onApp={onApp} />
      ) : pending ? (
        <p className="text-sm text-shasta-muted">Version {pending.version} is waiting for review. Withdraw it in the next step to keep editing.</p>
      ) : (
        <NewVersion app={app} onApp={onApp} />
      )}
    </Card>
  )
}
