import { useEffect, useSyncExternalStore } from 'react'
import { useSettings } from '@/stores/settingsStore'

const subscribe = (query: string) => (cb: () => void) => {
  const mq = matchMedia(query)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

const useMedia = (query: string) =>
  useSyncExternalStore(subscribe(query), () => matchMedia(query).matches, () => false)

/** Applies theme, accent, density and motion preferences to <html>. Returns whether motion is reduced. */
export function useAppearance(): { dark: boolean; reducedMotion: boolean } {
  const { theme, accent, density, motion, uiScale, highContrast } = useSettings((s) => s.settings)
  const systemDark = useMedia('(prefers-color-scheme: dark)')
  const systemReduced = useMedia('(prefers-reduced-motion: reduce)')

  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const reducedMotion = motion === 'reduced' || (motion === 'system' && systemReduced)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    root.dataset.accent = accent
    root.dataset.density = density
    root.dataset.motion = reducedMotion ? 'reduced' : 'full'
    root.dataset.scale = uiScale
    root.dataset.contrast = highContrast ? 'high' : 'normal'
  }, [dark, accent, density, reducedMotion, uiScale, highContrast])

  return { dark, reducedMotion }
}
