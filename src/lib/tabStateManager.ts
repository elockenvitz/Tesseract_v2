export interface TabState {
  [key: string]: any
}

export interface MainTabState {
  tabs: any[]
  activeTabId: string
  tabStates: Record<string, TabState>
  version?: number
  userId?: string
  orgId?: string
}

const TAB_STATE_PREFIX = 'tesseract_tabs_'
const LEGACY_KEY = 'tesseract_tab_states'
const CURRENT_VERSION = 3 // Bumped: org-scoped storage

export class TabStateManager {
  // Build a storage key scoped to user+org
  private static key(userId?: string, orgId?: string): string {
    if (userId && orgId) return `${TAB_STATE_PREFIX}${userId}_${orgId}`
    if (userId) return `${TAB_STATE_PREFIX}${userId}`
    return LEGACY_KEY
  }

  // Clear all tab state for a specific user+org (or legacy)
  static clearAll(userId?: string, orgId?: string): void {
    try {
      sessionStorage.removeItem(this.key(userId, orgId))
      // Also clear legacy key
      sessionStorage.removeItem(LEGACY_KEY)
    } catch {}
  }

  // Clear if the saved state belongs to a different user
  static clearIfDifferentUser(currentUserId: string): void {
    // Legacy cleanup only
    try {
      const saved = sessionStorage.getItem(LEGACY_KEY)
      if (!saved) return
      const state = JSON.parse(saved) as MainTabState
      if (state.userId && state.userId !== currentUserId) {
        sessionStorage.removeItem(LEGACY_KEY)
      }
    } catch {}
  }

  // Save the main tab state (tabs array and active tab)
  static saveMainTabState(tabs: any[], activeTabId: string, tabStates: Record<string, TabState> = {}, userId?: string, orgId?: string): void {
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
        version: CURRENT_VERSION,
        userId,
        orgId,
      }
      sessionStorage.setItem(this.key(userId, orgId), JSON.stringify(state))
    } catch (error) {
      console.warn('Failed to save tab state:', error)
    }
  }

  // Load the main tab state for a specific user+org
  static loadMainTabState(forUserId?: string, forOrgId?: string): MainTabState | null {
    try {
      // Try org-scoped key first
      const key = this.key(forUserId, forOrgId)
      let saved = sessionStorage.getItem(key)

      // Fall back to legacy key if no org-scoped state
      if (!saved && key !== LEGACY_KEY) {
        saved = sessionStorage.getItem(LEGACY_KEY)
        if (saved) {
          const legacy = JSON.parse(saved) as MainTabState
          // Only use legacy if it belongs to this user
          if (forUserId && legacy.userId && legacy.userId !== forUserId) {
            sessionStorage.removeItem(LEGACY_KEY)
            return null
          }
          // Migrate: save under new key, remove legacy
          if (forUserId && forOrgId) {
            sessionStorage.setItem(key, saved)
            sessionStorage.removeItem(LEGACY_KEY)
          }
        }
      }

      if (!saved) return null

      const state = JSON.parse(saved) as MainTabState

      // Check version — clear old data
      if (!state.version || state.version < CURRENT_VERSION) {
        sessionStorage.removeItem(key)
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
  static saveTabState(tabId: string, state: TabState, userId?: string, orgId?: string): void {
    try {
      let mainState = this.loadMainTabState(userId, orgId)
      if (!mainState) {
        mainState = {
          tabs: [{ id: 'dashboard', title: 'Dashboard', type: 'dashboard', isActive: true }],
          activeTabId: 'dashboard',
          tabStates: {},
          version: CURRENT_VERSION,
          userId,
          orgId,
        }
      }

      mainState.tabStates = mainState.tabStates || {}
      mainState.tabStates[tabId] = state

      sessionStorage.setItem(this.key(userId, orgId), JSON.stringify(mainState))
    } catch (error) {
      console.warn('Failed to save tab state for', tabId, ':', error)
    }
  }

  // Load state for a specific tab
  static loadTabState(tabId: string, userId?: string, orgId?: string): TabState | null {
    try {
      const mainState = this.loadMainTabState(userId, orgId)
      if (!mainState || !mainState.tabStates) return null
      return mainState.tabStates[tabId] || null
    } catch (error) {
      console.warn('Failed to load tab state for', tabId, ':', error)
      return null
    }
  }

  // Clear all tab states (useful for logout or reset)
  static clearTabStates(userId?: string, orgId?: string): void {
    try {
      sessionStorage.removeItem(this.key(userId, orgId))
    } catch (error) {
      console.warn('Failed to clear tab states:', error)
    }
  }

  // Remove state for a specific tab (when tab is closed)
  static removeTabState(tabId: string, userId?: string, orgId?: string): void {
    try {
      const mainState = this.loadMainTabState(userId, orgId)
      if (!mainState || !mainState.tabStates) return

      delete mainState.tabStates[tabId]
      sessionStorage.setItem(this.key(userId, orgId), JSON.stringify(mainState))
    } catch (error) {
      console.warn('Failed to remove tab state for', tabId, ':', error)
    }
  }
}
