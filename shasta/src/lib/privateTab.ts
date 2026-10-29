import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'

const KEY = 'shasta-private-explained'

export const privateExplained = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const markPrivateExplained = () => {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* storage blocked: the explainer will simply show again */
  }
}

/** Opens a Private tab, after a one-time explanation of what that does and does not mean. */
export function requestPrivateTab() {
  if (!privateExplained()) return useUi.getState().setPrivateExplainer(true)
  useTabs.getState().newPrivateTab()
  useUi.getState().requestOmniboxFocus()
}
