import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, errorMessage } from '../api'
import { AppIcon } from '../components'
import type { DevApp } from '../types'
import { Card, fail } from './shared'

const TYPES = 'image/png,image/jpeg,image/webp,image/gif'
const MAX_ICON = 256 * 1024
const MAX_SHOT = 5 * 1024 * 1024
const MAX_SHOTS = 8

const fmt = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

function check(file: File, max: number): string | null {
  if (!TYPES.split(',').includes(file.type)) return `${file.name} is not a PNG, JPEG, WebP or GIF image.`
  if (file.size > max) return `${file.name} is ${fmt(file.size)}; the limit is ${fmt(max)}.`
  return null
}

export function ArtworkPanel({ app, onApp }: { app: DevApp; onApp: (a: DevApp) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const iconInput = useRef<HTMLInputElement>(null)
  const shotInput = useRef<HTMLInputElement>(null)

  const run = async (label: string, fn: () => Promise<DevApp>) => {
    setBusy(label)
    setError(null)
    try {
      onApp(await fn())
    } catch (e) {
      setError(errorMessage(e))
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const setIcon = (file?: File) => {
    if (!file) return
    const p = check(file, MAX_ICON)
    if (p) return setError(p)
    void run('icon', () => api.blob('PUT', `/api/dev/apps/${app.id}/icon`, file))
  }

  const addShots = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_SHOTS - app.screenshots.length
    const list = [...files].slice(0, room)
    for (const f of list) {
      const p = check(f, MAX_SHOT)
      if (p) return setError(p)
    }
    setBusy('shots')
    setError(null)
    try {
      let latest = app
      for (const f of list) latest = await api.blob<DevApp>('POST', `/api/dev/apps/${app.id}/screenshots`, f)
      onApp(latest)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card id="artwork" title="2 · Artwork" subtitle="An icon is required to publish. Screenshots help people decide to install.">
      <div className="flex flex-wrap items-center gap-4">
        <AppIcon app={app} size={88} />
        <div className="grid gap-1.5">
          <input ref={iconInput} type="file" accept={TYPES} className="sr-only" aria-label="Upload icon" onChange={(e) => (setIcon(e.target.files?.[0]), (e.target.value = ''))} />
          <Button variant="secondary" disabled={busy === 'icon'} onClick={() => iconInput.current?.click()}>
            <ImagePlus /> {busy === 'icon' ? 'Uploading…' : app.iconUrl ? 'Replace icon' : 'Upload icon'}
          </Button>
          <p className="text-xs text-shasta-muted">Square PNG, JPEG, WebP or GIF, up to 256 KB (about 256×256 pixels is plenty).</p>
        </div>
      </div>

      <h3 className="mt-6 mb-2 text-sm font-medium">Screenshots <span className="text-shasta-muted">({app.screenshots.length}/{MAX_SHOTS})</span></h3>
      <ul className="flex flex-wrap gap-3">
        {app.screenshots.map((s) => (
          <li key={s.file} className="group relative">
            <img src={s.url} alt="Screenshot" className="h-28 rounded-xl object-cover ring-1 ring-shasta-line" />
            <button
              aria-label="Remove screenshot"
              disabled={!!busy}
              onClick={() => void run('rm', () => api.del<DevApp>(`/api/dev/apps/${app.id}/screenshots/${s.file}`))}
              className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/70 text-white opacity-80 hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
        {app.screenshots.length < MAX_SHOTS && (
          <li>
            <input ref={shotInput} type="file" accept={TYPES} multiple className="sr-only" aria-label="Add screenshots" onChange={(e) => (void addShots(e.target.files), (e.target.value = ''))} />
            <button onClick={() => shotInput.current?.click()} disabled={busy === 'shots'} className="grid h-28 w-40 place-items-center rounded-xl border border-dashed border-shasta-line text-sm text-shasta-muted hover:bg-shasta-hover">
              <span className="flex items-center gap-1.5"><ImagePlus className="size-4" /> {busy === 'shots' ? 'Uploading…' : 'Add screenshots'}</span>
            </button>
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-shasta-muted">PNG, JPEG, WebP or GIF, up to 5 MB each.</p>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-shasta-danger">{error}</p>
    </Card>
  )
}
