import { useEffect, useState } from 'react'

/** Shasta's own light/dark switch is the `dark` class on <html> (hooks/useAppearance.ts): the What's new demos follow it. */
export function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const obs = new MutationObserver(() => setDark(root.classList.contains('dark')))
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => {
      obs.disconnect()
    }
  }, [])
  return dark
}
