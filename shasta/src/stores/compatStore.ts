import { create } from 'zustand'
import type { MissingFeature } from '@/lib/browserSupport'

/** Per tab: the feature its current page crashed for want of; cleared when the tab loads another page. Memory only. */
interface CompatState {
  byTab: Record<string, MissingFeature>
  report: (tabId: string, feature: MissingFeature) => void
  clear: (tabId: string) => void
}

export const useCompat = create<CompatState>((set) => ({
  byTab: {},
  report: (tabId, feature) => set((s) => ({ byTab: { ...s.byTab, [tabId]: feature } })),
  clear: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.byTab
      return { byTab: rest }
    }),
}))
