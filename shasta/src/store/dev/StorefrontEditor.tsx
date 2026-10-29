import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Circle, Eye, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '../api'
import { LoadError, StoreAvatar, TileSkeletons } from '../components'
import { useApi } from '../hooks'
import { storePath, useStoreNav } from '../nav'
import { StorefrontHeader } from '../StorefrontPage'
import type { MyStore } from '../types'
import { Card, Field, fail, ok, textareaClass } from './shared'

const HUES = [12, 40, 70, 110, 160, 195, 230, 265, 295, 330]
const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

/** The publisher's own storefront: identity, artwork, colour. Saved explicitly; the preview above is the real masthead. */
export function StorefrontEditor() {
  const { go } = useStoreNav()
  const { data, error, offline, reload } = useApi<MyStore>('/api/dev/store', { live: false })
  const [form, setForm] = useState({ name: '', tagline: '', description: '', accent: 230 })
  const [base, setBase] = useState(form)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'logo' | 'banner' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(base)

  useEffect(() => {
    if (!data) return
    const next = { name: data.name, tagline: data.tagline, description: data.description, accent: data.accent }
    setForm(next)
    setBase(next)
  }, [data?.id])

  if (error && !data) return <LoadError message={error} offline={offline} onRetry={reload} />
  if (!data) return <TileSkeletons n={2} />

  const save = async () => {
    setSaving(true)
    setProblem(null)
    try {
      await api.patch('/api/dev/store', form)
      setBase(form)
      ok('Storefront saved.')
      reload()
    } catch (e) {
      setProblem(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const upload = async (kind: 'logo' | 'banner', file?: File) => {
    if (!file) return
    const limit = kind === 'logo' ? 2 : 5
    if (file.size > limit * 1024 * 1024) return fail(new Error(`The ${kind} must be under ${limit} MB.`))
    setBusy(kind)
    try {
      await api.blob('PUT', `/api/dev/store/${kind}`, file)
      ok(kind === 'logo' ? 'Logo updated.' : 'Banner updated.')
      reload()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  const remove = async (kind: 'logo' | 'banner') => {
    setBusy(kind)
    try {
      await api.del(`/api/dev/store/${kind}`)
      reload()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const palette = HUES.includes(form.accent) ? HUES : [form.accent, ...HUES]
  const checklist: [string, boolean][] = [
    ['A name of your own', form.name.trim().length >= 2 && (data.official || data.configured)],
    ['A logo', !!data.logoUrl || data.official],
    ['A banner', !!data.bannerUrl],
    ['A tagline', form.tagline.trim().length > 0],
    ['An introduction', form.description.trim().length > 0],
  ]
  const done = checklist.filter(([, v]) => v).length
  const preview = { ...data, name: form.name.trim() || data.name, tagline: form.tagline, description: form.description, accent: form.accent }

  return (
    <div className="sh-theme mx-auto max-w-4xl py-2" style={{ ['--sh-hue' as string]: form.accent }}>
      <Button variant="ghost" size="sm" onClick={() => go('/develop')} className="mb-3 -ml-2"><ArrowLeft /> All apps</Button>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.official ? 'Official storefront' : 'Your storefront'}</h1>
          <p className="text-sm text-shasta-muted">{data.official ? 'The face of the Store. Everything the owner publishes appears here, marked Official.' : 'Your own page in the Store. Everything you publish appears on it, and people can follow it.'}</p>
        </div>
        <Button variant="secondary" onClick={() => go(storePath(data.slug))}><Eye /> View storefront</Button>
      </header>

      <section aria-label="Live preview" className="mb-6">
        <p className="mb-2 text-xs font-medium tracking-wide text-shasta-muted uppercase">Live preview</p>
        <StorefrontHeader store={preview} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
        <div className="grid gap-5">
          <Card title="Artwork" subtitle="A logo and a banner make your storefront recognisable.">
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center gap-4">
                <StoreAvatar store={preview} size={72} />
                <div>
                  <input ref={logoInput} type="file" accept={IMAGE_TYPES} className="sr-only" aria-label="Upload logo" onChange={(e) => (void upload('logo', e.target.files?.[0]), (e.target.value = ''))} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={busy === 'logo'} onClick={() => logoInput.current?.click()}>{busy === 'logo' ? <Loader2 className="sh-spin" /> : <ImagePlus />} {data.logoUrl ? 'Replace logo' : 'Upload logo'}</Button>
                    {data.logoUrl && <Button variant="ghost" disabled={busy === 'logo'} onClick={() => void remove('logo')} aria-label="Remove logo"><Trash2 /></Button>}
                  </div>
                  <p className="mt-1 text-xs text-shasta-muted">Square PNG, JPEG, WebP or GIF, up to 2 MB.{data.official ? ' Until you upload one, the Shasta mark is used.' : ' Without one, your colour and first letter are used.'}</p>
                </div>
              </div>
              <div>
                <input ref={bannerInput} type="file" accept={IMAGE_TYPES} className="sr-only" aria-label="Upload banner" onChange={(e) => (void upload('banner', e.target.files?.[0]), (e.target.value = ''))} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={busy === 'banner'} onClick={() => bannerInput.current?.click()}>{busy === 'banner' ? <Loader2 className="sh-spin" /> : <ImagePlus />} {data.bannerUrl ? 'Replace banner' : 'Upload banner'}</Button>
                  {data.bannerUrl && <Button variant="ghost" disabled={busy === 'banner'} onClick={() => void remove('banner')} aria-label="Remove banner"><Trash2 /></Button>}
                </div>
                <p className="mt-1 text-xs text-shasta-muted">Wide image, about 1600×400, up to 5 MB. Without one, a gradient made from your colour is used.</p>
              </div>
            </div>
          </Card>

          <Card title="Details">
            <div className="grid gap-4">
              <Field label="Storefront name" counter={`${form.name.length}/40`}>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} />
              </Field>
              <Field label="Tagline" hint="One line under the name." counter={`${form.tagline.length}/100`}>
                <Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} maxLength={100} />
              </Field>
              <Field label="About your storefront" counter={`${form.description.length}/2000`}>
                <textarea className={textareaClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Colour theme</legend>
                <div className="flex flex-wrap gap-2.5">
                  {palette.map((h) => (
                    <label key={h} className="cursor-pointer">
                      <input type="radio" name="accent" value={h} checked={form.accent === h} onChange={() => setForm({ ...form, accent: h })} className="peer sr-only" aria-label={`Colour ${h}`} />
                      <span style={{ background: `oklch(0.6 0.16 ${h})` }} className="block size-9 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-shasta-home transition peer-checked:ring-shasta-fg peer-focus-visible:ring-shasta-accent" />
                    </label>
                  ))}
                </div>
              </fieldset>
              {problem && <p role="alert" className="text-sm text-shasta-danger">{problem}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={!dirty || saving || form.name.trim().length < 2} onClick={() => void save()}>{saving ? 'Saving…' : 'Save storefront'}</Button>
                {dirty && <Button variant="ghost" onClick={() => setForm(base)}>Discard changes</Button>}
              </div>
            </div>
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          <Card title="Set-up" subtitle={`${done} of ${checklist.length} done`}>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-shasta-field" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={checklist.length} aria-label="Storefront set-up progress">
              <div className="h-full rounded-full bg-shasta-accent transition-all" style={{ width: `${(done / checklist.length) * 100}%` }} />
            </div>
            <ul className="grid gap-2 text-sm">
              {checklist.map(([label, v]) => (
                <li key={label} className={v ? 'flex items-center gap-2' : 'flex items-center gap-2 text-shasta-muted'}>
                  {v ? <Check className="size-4 text-emerald-500" aria-hidden /> : <Circle className="size-4" aria-hidden />} {label}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Address">
            <p className="text-xs text-shasta-muted">Share this with anyone using Shasta:</p>
            <code className="mt-1 block text-xs break-all">shasta://store#{storePath(data.slug)}</code>
          </Card>
        </aside>
      </div>
    </div>
  )
}
