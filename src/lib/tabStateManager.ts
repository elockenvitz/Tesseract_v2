export interface TabState {
  [key: string]: any
}

export interface MainTabState {
  tabs: any[]
  activeTabId: string
  tabStates: Record<string, TabState>
  version?: number
}

const TAB_STATE_KEY = 'tesseract_tab_states'
const CURRENT_VERSION = 2 // Increment this to clear old cached data

export class TabStateManager {
  // Save the main tab state (tabs array and active tab)
  static saveMainTabState(tabs: any[], activeTabId: string, tabStates: Record<string, TabState> = {}): void {
    try {
      const state: MainTabState = {
        tabs: tabs.map(tab => ({
          id: tab.id,
          title: tab.title,
          type: tab.type,
          data: tab.data,
          isActive: tab.isActive,
          isBlank: tab.isBlank
        })),
        activeTabId,
        tabStates,
        version: CURRENT_VERSION
      }
      sessionStorage.setItem(TAB_STATE_KEY, JSON.stringify(state))
    } catch (error) {
      console.warn('Failed to save tab state:', error)
    }
  }

  // Load the main tab state
  static loadMainTabState(): MainTabState | null {
    try {
      const saved = sessionStorage.getItem(TAB_STATE_KEY)
      if (!saved) return null

      const state = JSON.parse(saved) as MainTabState

      // Check version and clear old cached data
      if (!state.version || state.version < CURRENT_VERSION) {
        console.log('TabStateManager: Clearing old cached tab state due to version mismatch')
        sessionStorage.removeItem(TAB_STATE_KEY)
        return null
      }

      // Validate the structure
      if (!state.tabs || !Array.isArray(state.tabs) || !state.activeTabId) {
        return null
      }

      return state
    } catch (error) {
      console.warn('Failed to load tab state:', error)
      return null
    }
  }

  // Save state for a specific tab (like internal tab state within AssetTab)
  static saveTabState(tabId: string, state: TabState): void {
    try {
      let mainState = this.loadMainTabState()
      if (!mainState) {
        console.log(`TabStateManager: No main state found, creating new state for ${tabId}`)
        // Create a minimal main state if it doesn't exist
        mainState = {
          tabs: [{ id: 'dashboard', title: 'Dashboard', type: 'dashboard', isActive: true }],
          activeTabId: 'dashboard',
          tabStates: {}
        }
      }

      mainState.tabStates = mainState.tabStates || {}
      mainState.tabStates[tabId] = state
      console.log(`TabStateManager: Saving state for ${tabId}:`, state)

      sessionStorage.setItem(TAB_STATE_KEY, JSON.stringify(mainState))
    } catch (error) {
      console.warn('Failed to save tab state for', tabId, ':', error)
    }
  }

  // Load state for a specific tab
  static loadTabState(tabId: string): TabState | null {
    try {
      const mainState = this.loadMainTabState()
      console.log(`TabStateManager: Loading state for ${tabId}:`, mainState?.tabStates?.[tabId])

      if (!mainState || !mainState.tabStates) {
        return null
      }

      return mainState.tabStates[tabId] || null
    } catch (error) {
      console.warn('Failed to load tab state for', tabId, ':', error)
      return null
    }
  }

  // Clear all tab states (useful for logout or reset)
  static clearTabStates(): void {
    try {
      sessionStorage.removeItem(TAB_STATE_KEY)
    } catch (error) {
      console.warn('Failed to clear tab states:', error)
    }
  }

  // Remove state for a specific tab (when tab is closed)
  static removeTabState(tabId: string): void {
    try {
      const mainState = this.loadMainTabState()
      if (!mainState || !mainState.tabStates) return

      delete mainState.tabStates[tabId]
      sessionStorage.setItem(TAB_STATE_KEY, JSON.stringify(mainState))
    } catch (error) {
      console.warn('Failed to remove tab state for', tabId, ':', error)
    }
  }
}