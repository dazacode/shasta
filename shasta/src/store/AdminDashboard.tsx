import { Suspense, lazy, type ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApi } from './hooks'
import { useStoreNav } from './nav'
import { Message } from './components'
import { useStore } from './storeStore'

const QueueTab = lazy(() => import('./admin/QueueTab').then((m) => ({ default: m.QueueTab })))
const AppsTab = lazy(() => import('./admin/AppsTab').then((m) => ({ default: m.AppsTab })))
const PeopleTab = lazy(() => import('./admin/PeopleTab').then((m) => ({ default: m.PeopleTab })))
const ApplicationsTab = lazy(() => import('./admin/ApplicationsTab').then((m) => ({ default: m.ApplicationsTab })))
const CurationTab = lazy(() => import('./admin/CurationTab').then((m) => ({ default: m.CurationTab })))
const CategoriesTab = lazy(() => import('./admin/CategoriesTab').then((m) => ({ default: m.CategoriesTab })))
const ReportsTab = lazy(() => import('./admin/ReportsTab').then((m) => ({ default: m.ReportsTab })))
const ActivityTab = lazy(() => import('./admin/ActivityTab').then((m) => ({ default: m.ActivityTab })))

const TABS = [
  { id: 'queue', label: 'Review queue' },
  { id: 'apps', label: 'All apps' },
  { id: 'applications', label: 'Applications' },
  { id: 'people', label: 'Contributors' },
  { id: 'curation', label: 'Featured & collections' },
  { id: 'categories', label: 'Categories' },
  { id: 'reports', label: 'Reports' },
  { id: 'activity', label: 'Activity' },
] as const

type TabId = (typeof TABS)[number]['id']

function Content({ tab }: { tab: TabId }): ReactNode {
  switch (tab) {
    case 'queue':
      return <QueueTab />
    case 'apps':
      return <AppsTab />
    case 'applications':
      return <ApplicationsTab />
    case 'people':
      return <PeopleTab />
    case 'curation':
      return <CurationTab />
    case 'categories':
      return <CategoriesTab />
    case 'reports':
      return <ReportsTab />
    case 'activity':
      return <ActivityTab />
  }
}

export default function AdminDashboard() {
  const { route, go } = useStoreNav()
  const user = useStore((s) => s.user)
  const owner = user?.role === 'owner'
  // cheap counts for the tab strip; only requested for the owner
  const queue = useApi<{ items: unknown[] }>(owner ? '/api/admin/queue' : null)
  const reports = useApi<{ reports: unknown[] }>(owner ? '/api/admin/reports?status=open' : null)
  const applications = useApi<{ applications: unknown[] }>(owner ? '/api/admin/applications?status=pending' : null)

  if (!owner)
    return (
      <Message
        icon={<ShieldAlert className="size-5" />}
        title="This area is for the Store owner"
        body={user ? 'Your account does not have owner access. Contributors manage their own apps under Develop.' : 'Open Account and enter your owner code to manage the Store.'}
      />
    )

  const active: TabId = TABS.some((t) => t.id === route.segments[1]) ? (route.segments[1] as TabId) : 'queue'
  const counts: Partial<Record<TabId, number | undefined>> = { queue: queue.data?.items.length, applications: applications.data?.applications.length, reports: reports.data?.reports.length }

  return (
    <div className="mx-auto w-full max-w-5xl py-2">
      <h1 className="sh-title">Manage the Store</h1>
      <p className="mb-4 text-sm text-shasta-muted">Review submissions, answer applications, manage contributors and keep the catalog tidy.</p>
      <div role="tablist" aria-label="Management sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-shasta-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => go(`/admin/${t.id}`)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active === t.id ? 'border-shasta-fg text-shasta-fg' : 'border-transparent text-shasta-muted hover:text-shasta-fg',
            )}
          >
            {t.label}
            {!!counts[t.id] && <span className="sh-meta text-shasta-muted">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === active)?.label}>
        <Suspense fallback={<p className="py-10 text-center text-sm text-shasta-muted">Loading…</p>}>
          <Content tab={active} />
        </Suspense>
      </div>
    </div>
  )
}
