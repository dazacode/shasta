// Components the desktop's friends page and Settings share: the social query provider and the "what I'm playing"
// switch (PATCH me/settings, the same setting the phone has). Helpers are in social.ts.
import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { errorText, social } from '@/social/api'
import { useSocial } from '@/social/store'
import { useUi } from '@/stores/uiStore'
import { Toggle } from '../settingsParts'
import { socialQueryClient } from './social'

export function SocialQueries({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={socialQueryClient()}>{children}</QueryClientProvider>
}

/** "What I'm playing": off by default, friends only, Store games only. */
export function PresenceToggle({ id = 'social-presence' }: { id?: string }) {
  const on = useSocial((s) => !!s.me?.settings.presence)
  const [busy, setBusy] = useState(false)
  const change = async (presence: boolean) => {
    setBusy(true)
    try {
      const settings = await social.settings({ presence })
      const me = useSocial.getState().me
      if (me) useSocial.getState().setMe({ ...me, settings: { ...me.settings, ...settings } })
    } catch (e) {
      useUi.getState().toast(errorText(e), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return <Toggle id={id} label="Show friends what I'm playing" checked={on} disabled={busy} onChange={(v) => void change(v)} />
}
