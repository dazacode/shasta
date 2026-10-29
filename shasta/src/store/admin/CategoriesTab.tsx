import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { useApi } from '../hooks'
import { LoadError } from '../components'
import { Card, ConfirmDialog, ListSkeleton, useAction } from './common'

interface Cat {
  id: string
  name: string
  isGame: number
  sort: number
  apps: number
}

function CategoryRow({ c, onChanged }: { c: Cat; onChanged: () => void }) {
  const [name, setName] = useState(c.name)
  const [deleting, setDeleting] = useState(false)
  const { busy, run } = useAction()
  const dirty = name.trim() !== c.name && !!name.trim()
  return (
    <Card className="flex flex-wrap items-center gap-3 !p-3">
      <form
        className="flex min-w-0 flex-1 basis-56 items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (dirty && (await run('rename', () => api.patch(`/api/admin/categories/${c.id}`, { name: name.trim() }), 'Category renamed.'))) onChanged()
        }}
      >
        <Input aria-label={`Name of ${c.name}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        {dirty && (
          <Button type="submit" size="sm" disabled={busy === 'rename'}>
            Save
          </Button>
        )}
      </form>
      <span className="text-xs text-shasta-muted tabular-nums">
        {c.apps} app{c.apps === 1 ? '' : 's'}
      </span>
      <label className="flex items-center gap-2 text-xs text-shasta-muted">
        <Switch size="sm" checked={!!c.isGame} disabled={busy === 'game'} aria-label={`${c.name} is a games category`} onCheckedChange={async (v) => (await run('game', () => api.patch(`/api/admin/categories/${c.id}`, { isGame: v }))) && onChanged()} />
        Counts as Games
      </label>
      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(true)}>
        <Trash2 />
      </Button>
      <ConfirmDialog
        open={deleting}
        title={`Delete “${c.name}”?`}
        body={c.apps ? `${c.apps} app${c.apps === 1 ? ' uses' : 's use'} this category, so the server will refuse. Move them first.` : 'Nothing uses this category.'}
        confirmLabel="Delete category"
        destructive
        busy={busy === 'delete'}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          const ok = await run('delete', () => api.del(`/api/admin/categories/${c.id}`), 'Category deleted.')
          setDeleting(false)
          if (ok) onChanged()
        }}
      />
    </Card>
  )
}

export function CategoriesTab() {
  const q = useApi<{ categories: Cat[] }>('/api/admin/categories')
  const [name, setName] = useState('')
  const [isGame, setIsGame] = useState(false)
  const { busy, run } = useAction()
  return (
    <div className="grid gap-6">
      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await run('add', () => api.post('/api/admin/categories', { name: name.trim(), isGame }), 'Category added.')) {
              setName('')
              setIsGame(false)
              q.reload()
            }
          }}
        >
          <label className="grid flex-1 basis-56 gap-1 text-xs font-medium">
            New category
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Puzzle" maxLength={40} />
          </label>
          <label className="flex items-center gap-2 pb-1 text-sm">
            <Switch checked={isGame} onCheckedChange={setIsGame} aria-label="Counts as Games" /> Counts as Games
          </label>
          <Button type="submit" disabled={!name.trim() || busy === 'add'}>
            <Plus /> Add
          </Button>
        </form>
        <p className="mt-2 text-xs text-shasta-muted">Categories marked “Counts as Games” show under Games in the sidebar; the others under Apps.</p>
      </Card>
      {q.error && !q.data ? <LoadError message={q.error} offline={q.offline} onRetry={q.reload} /> : !q.data ? <ListSkeleton /> : <div className="grid gap-2">{q.data.categories.map((c) => <CategoryRow key={c.id} c={c} onChanged={q.reload} />)}</div>}
    </div>
  )
}
