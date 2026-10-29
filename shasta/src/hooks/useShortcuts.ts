import { useEffect } from 'react'
import { focusActiveFrame, handleKeydown } from '@/lib/shortcuts'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { setGameControl } from '@/lib/gameControl'

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * Registers browser shortcuts while focus is in Shasta's own UI. Keys typed inside a proxied page
 * reach the same handler through the adapter's `key` event.
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleKeydown(e)) return
      // Escape stops a loading page, but never steals it from inputs, menus or dialogs
      if (e.key === 'Escape' && !e.defaultPrevented && !isEditable(e.target)) {
        const s = useTabs.getState()
        if (s.tabs.find((t) => t.id === s.activeId)?.loading) {
          e.preventDefault()
          s.stop()
        }
      }
    }
    // Chromium: in full screen, Keyboard Lock hands Shasta the keys the browser normally reserves (Ctrl+T/W/N, Tab…)
    const kb = (navigator as Navigator & { keyboard?: { lock(codes?: string[]): Promise<void>; unlock(): void } }).keyboard
    const reserved = ['KeyT', 'KeyW', 'KeyN', 'KeyL', 'KeyR', 'Tab', 'F5']
    // game mode asks for every key; otherwise only the ones Shasta's own shortcuts need
    const lockKeys = () => void kb?.lock(useUi.getState().gameMode ? undefined : reserved).catch(() => undefined)
    const onFullscreen = () => {
      const on = !!document.fullscreenElement
      useUi.getState().setFullscreen(on)
      if (on) lockKeys()
      else kb?.unlock()
    }
    // a page that grabs the mouse (pointer lock: shooters, 3D games) switches game mode on by itself and off again on release
    let autoGame = false
    const onPointerLock = () => {
      const locked = document.pointerLockElement instanceof HTMLIFrameElement
      const ui = useUi.getState()
      if (locked && !ui.gameMode) {
        autoGame = true
        ui.setGameMode(true)
      } else if (!locked && autoGame) {
        autoGame = false
        ui.setGameMode(false)
      }
    }
    // a game:// tab (a Store game) is in game mode while it is in front; leaving it turns game mode off again
    let tabGame = false
    // the game tab in which the person turned game mode off themselves: left alone until another tab is in front
    let dismissedFor: string | null = null
    const onTabs = () => {
      const t = useTabs.getState()
      const isGame = t.tabs.find((x) => x.id === t.activeId)?.app?.scheme === 'game'
      if (dismissedFor !== t.activeId) dismissedFor = null
      const ui = useUi.getState()
      if (isGame && !ui.gameMode && !dismissedFor) {
        tabGame = true
        ui.setGameMode(true)
      } else if (!isGame && tabGame) {
        tabGame = false
        if (ui.gameMode) ui.setGameMode(false)
      }
    }
    onTabs()
    const unsubTabs = useTabs.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId || s.tabs !== prev.tabs) onTabs()
    })
    // in game mode + full screen the page may have every key, including Esc-less combos the browser reserves
    setGameControl(useUi.getState().gameMode)
    const unsubGame = useUi.subscribe((s, prev) => {
      if (s.gameMode === prev.gameMode) return
      setGameControl(s.gameMode)
      if (!s.gameMode && tabGame) {
        tabGame = false
        dismissedFor = useTabs.getState().activeId
      }
      if (!s.gameMode) autoGame = false
      if (document.fullscreenElement) lockKeys()
      if (s.gameMode) focusActiveFrame()
    })
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerlockchange', onPointerLock)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('pointerlockchange', onPointerLock)
      unsubGame()
      unsubTabs()
    }
  }, [])
}
