import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CREDIT_LABEL, type Credit, type CreditRole } from '../types'
import { selectClass } from './shared'

const ROLES = Object.keys(CREDIT_LABEL) as CreditRole[]

/**
 * Who is behind the app. List the original makers first (developer, publisher, artists...), then whoever hosts it.
 * The first developer(s) become the name shown under the app everywhere in the Store.
 */
export function CreditsEditor({ value, onChange }: { value: Credit[]; onChange: (next: Credit[]) => void }) {
  const set = (i: number, patch: Partial<Credit>) => onChange(value.map((c, k) => (k === i ? { ...c, ...patch } : c)))
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Credits</legend>
      <p className="-mt-1 mb-1 text-xs text-shasta-muted">Credit the people and studios who made it, not only where it is hosted. Original developers are shown first; a host or your own storefront comes last.</p>
      {value.length === 0 && <p className="rounded-lg bg-shasta-field px-3 py-2 text-xs text-shasta-muted">No credits yet. The app will show your storefront's name until you add the developer.</p>}
      {value.map((c, i) => (
        <div key={i} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-2 sm:grid-cols-[8.5rem_1fr_1fr_auto]">
          <select aria-label={`Role of credit ${i + 1}`} className={selectClass} value={c.role} onChange={(e) => set(i, { role: e.target.value as CreditRole })}>
            {ROLES.map((r) => <option key={r} value={r}>{CREDIT_LABEL[r]}</option>)}
          </select>
          <Input aria-label={`Name of credit ${i + 1}`} placeholder="Name or studio" value={c.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} />
          <Input aria-label={`Link of credit ${i + 1}`} placeholder="https://… (optional)" className="col-span-2 sm:col-span-1" inputMode="url" spellCheck={false} value={c.url ?? ''} onChange={(e) => set(i, { url: e.target.value })} />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove credit ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 /></Button>
        </div>
      ))}
      {value.length < 12 && (
        <Button type="button" variant="secondary" className="w-fit" onClick={() => onChange([...value, { role: value.some((c) => c.role === 'developer') ? 'publisher' : 'developer', name: '' }])}><Plus /> Add credit</Button>
      )}
    </fieldset>
  )
}
