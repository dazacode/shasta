import { create } from 'zustand'

import type { ContextInfo } from '@/lib/contextMenu'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error' | 'success'
  action?: { label: string; run: () => void }
}

let seq = 0

/** Something to hand to the AI assistant: opened from the right-click menu or a toolbar action. */
export interface AssistantRequest {
  id: number
  /** what to ask */
  text: string
  /** include the page in the active tab as source material */
  withPage?: boolean
  /** text the person selected on a page */
  selection?: string
  /** a picture to describe */
  image?: Blob
  /** shown in the conversation instead of `text` (long prompts are written for the model, not for people) */
  label?: string
}

interface UiState {
  toasts: Toast[]
  /** bumped to ask the omnibox to focus and select its contents */
  focusOmnibox: number
  fullscreen: boolean
  /** toolbar and tab strip folded away (the yellow window button) */
  chromeHidden: boolean
  shortcutsOpen: boolean
  /** the one-time "what a private tab is" dialog */
  privateExplainer: boolean
  setPrivateExplainer: (v: boolean) => void
  /** game mode: Shasta's shortcuts are paused so every key and mouse move goes to the page */
  gameMode: boolean
  /** bumped to open the bookmark editor for the active tab */
  bookmarkEditor: number
  /** the open right-click menu: where, what was clicked, and which tab */
  contextMenu: { tabId: string; info: ContextInfo } | null
  openContextMenu: (tabId: string, info: ContextInfo) => void
  closeContextMenu: () => void
  /** bumped per app id when its files changed and an open tab should reload */
  appReloads: Record<string, number>
  bumpAppReload: (appId: string) => void
  assistantOpen: boolean
  /** a question for the Shasta AI app, waiting for it to pick up (memory only, never stored) */
  pendingAiPrompt: string | null
  setPendingAiPrompt: (text: string | null) => void
  assistantRequest: AssistantRequest | null
  openAssistant: (request?: Omit<AssistantRequest, 'id'>) => void
  closeAssistant: () => void
  toggleAssistant: () => void
  consumeAssistantRequest: () => void
  toast: (message: string, opts?: { tone?: Toast['tone']; action?: Toast['action']; ms?: number }) => void
  dismissToast: (id: number) => void
  requestOmniboxFocus: () => void
  setFullscreen: (v: boolean) => void
  setChromeHidden: (v: boolean) => void
  setShortcutsOpen: (v: boolean) => void
  setGameMode: (v: boolean) => void
  openBookmarkEditor: () => void
}

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  focusOmnibox: 0,
  fullscreen: false,
  chromeHidden: false,
  shortcutsOpen: false,
  privateExplainer: false,
  setPrivateExplainer: (privateExplainer) => set({ privateExplainer }),
  gameMode: false,
  bookmarkEditor: 0,
  contextMenu: null,
  openContextMenu: (tabId, info) => set({ contextMenu: { tabId, info } }),
  closeContextMenu: () => set((s) => (s.contextMenu ? { contextMenu: null } : s)),
  appReloads: {},
  bumpAppReload: (appId) => set((s) => ({ appReloads: { ...s.appReloads, [appId]: (s.appReloads[appId] ?? 0) + 1 } })),
  assistantOpen: false,
  assistantRequest: null,
  pendingAiPrompt: null,
  setPendingAiPrompt: (pendingAiPrompt) => set({ pendingAiPrompt }),
  openAssistant: (request) => set({ assistantOpen: true, assistantRequest: request ? { ...request, id: ++seq } : null }),
  closeAssistant: () => set({ assistantOpen: false }),
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  consumeAssistantRequest: () => set({ assistantRequest: null }),
  toast: (message, { tone = 'info', action, ms = 5000 } = {}) => {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }))
    setTimeout(() => get().dismissToast(id), ms)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  requestOmniboxFocus: () => set((s) => ({ focusOmnibox: s.focusOmnibox + 1 })),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  setChromeHidden: (chromeHidden) => set({ chromeHidden }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setGameMode: (gameMode) => set({ gameMode }),
  openBookmarkEditor: () => set((s) => ({ bookmarkEditor: s.bookmarkEditor + 1 })),
}))
