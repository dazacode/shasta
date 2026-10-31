// Keeps every tab's controls in step with the saved profiles (the proxy reads them per tab, lib/gameInput.ts) and runs
// the controller service: buttons go to the front tab while it is a game:// tab or game mode is on.
import { useEffect } from 'react'
import * as proxy from '@/proxy/scramjetAdapter'
import { controlsKey, defaultControls, detectEngine, setTabControls, type GameControls } from '@/lib/gameInput'
import { focusedFrame, startGamepads } from '@/lib/gamepad'
import { tabUrl, type Tab } from '@/lib/tabModel'
import { hostOf, isInternalUrl } from '@/lib/url'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { openControls, useGameControls } from '@/stores/gameControlsStore'
import { onPhonePadEvent, phonePadsConnected, setPhonePadGame } from '@/lib/phonePad'
import { tabTitle } from '@/lib/tabModel'

export const tabControlsKey = (t: Tab): string | null => {
  const url = tabUrl(t)
  return controlsKey(t, isInternalUrl(url) ? '' : hostOf(url))
}

/** A tab's game defaults: its engine (from the page address) and the Store's curated layout, if any. */
export function tabBaseControls(t: Tab): GameControls {
  const url = t.app?.kind === 'linked' && isInternalUrl(tabUrl(t)) ? t.app.home : tabUrl(t)
  return defaultControls(detectEngine(url), t.app ? useGameControls.getState().hints[t.app.slug] : null)
}

/** What a tab's controller and phones do right now. */
export const tabControls = (t: Tab): GameControls => useGameControls.getState().get(tabControlsKey(t), tabBaseControls(t))

const isGameTab = (t: Tab | undefined) => t?.app?.scheme === 'game'

export function useGameInput() {
  useEffect(() => {
    const sync = () => {
      const { tabs } = useTabs.getState()
      const store = useGameControls.getState()
      for (const t of tabs) {
        const key = tabControlsKey(t)
        setTabControls(t.id, key && store.profiles[key] ? tabControls(t) : null)
      }
    }
    sync()
    const unsubTabs = useTabs.subscribe((s, prev) => {
      if (s.tabs !== prev.tabs) sync()
    })
    const unsubProfiles = useGameControls.subscribe((s, prev) => {
      if (s.profiles !== prev.profiles || s.hints !== prev.hints) sync()
    })

    const stop = startGamepads({
      target: () => {
        const s = useTabs.getState()
        const tab = s.tabs.find((t) => t.id === s.activeId)
        // a phone that joined is a clear "I want to play this": it drives the front page even outside game mode
        if (!tab || (!isGameTab(tab) && !useUi.getState().gameMode && !phonePadsConnected())) return null
        // only proxied pages can be given keys; an uploaded game runs on its own origin and reads the controller itself
        const frame = proxy.byTab.get(tab.id)?.iframe
        const win = frame?.contentWindow
        if (!frame || !win || useGameControls.getState().dialogTab) return null
        return { tabId: tab.id, win: focusedFrame(win), frame, controls: tabControls(tab) }
      },
      onConnect: () => {
        const s = useTabs.getState()
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab || (!isGameTab(tab) && !useUi.getState().gameMode)) return
        const own = tab.app?.kind === 'package'
        useUi.getState().toast(own ? 'Controller connected. This game reads it directly if it supports one.' : `Controller connected: its buttons go to ${tab.app?.name ?? 'the game'} as keys.`, {
          ms: 6000,
          action: own ? undefined : { label: 'Set up', run: () => openControls(tab.id) },
        })
      },
    })
    // phones show what they are controlling, and the window says who joined
    const showGame = () => {
      const s = useTabs.getState()
      const tab = s.tabs.find((t) => t.id === s.activeId)
      setPhonePadGame(tab ? tabTitle(tab) : '')
    }
    showGame()
    const unsubActive = useTabs.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId || s.tabs !== prev.tabs) showGame()
    })
    const offPhones = onPhonePadEvent((e) => {
      // a phone that just joined wants to play: the Controls dialog (where it was scanned) holds every key back, so close it
      if (e.type === 'join' && useGameControls.getState().dialogTab) useGameControls.getState().closeDialog()
      useUi.getState().toast(e.type === 'join' ? `Player ${e.slot}'s phone is connected.` : `Player ${e.slot}'s phone disconnected. It reconnects when its screen is back on.`, { ms: 4000 })
    })
    return () => {
      unsubActive()
      offPhones()
      unsubTabs()
      unsubProfiles()
      stop()
    }
  }, [])
}
