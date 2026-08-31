import React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { clsx } from 'clsx'
import { Eye, X, Archive } from 'lucide-react'
import { Header } from './Header'
import { TabManager, type Tab } from './TabManager'
import { CommunicationPane } from '../communication/CommunicationPane'
import { subscribeToEngagement } from '../../lib/engagement'
import type { EngagementTarget } from '../../lib/engagement'
import { NotificationPane } from '../notifications/NotificationPane'
import { useCommunication } from '../../hooks/useCommunication'
import { useNotifications } from '../../hooks/useNotifications'
import { useSidebarStore, type InspectableItemType } from '../../stores/sidebarStore'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { MobileNavDrawer } from '../mobile/MobileNavDrawer'
import { OverflowAuditOverlay } from '../mobile/OverflowAuditOverlay'

interface LayoutProps {
  children: React.ReactNode
  tabs: Tab[]
  activeTabId?: string
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onCloseTabs?: (tabIds: string[]) => void
  onNewTab: () => void
  onTabReorder: (fromIndex: number, toIndex: number) => void
  onTabsReorder?: (newTabs: Tab[]) => void
  onSearchResult?: (result: any) => void
  onFocusSearch?: () => void
  hideNewTab?: boolean
}

// Tab types that should render full-width without padding
const FULL_WIDTH_TAB_TYPES = ['trade-lab', 'trade-queue', 'trade-book', 'coverage', 'organization', 'templates', 'dashboard', 'audit', 'lists', 'idea-generator', 'priorities']

export function Layout({
  children,
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onCloseTabs,
  onNewTab,
  onTabReorder,
  onTabsReorder,
  onSearchResult,
  onFocusSearch,
  hideNewTab,
}: LayoutProps) {
  const {
    isCommPaneOpen,
    isCommPaneFullscreen,
    currentCitation,
    toggleCommPane,
    toggleCommPaneFullscreen,
    cite: originalCite,
    clearCitation,
    openCommPane
  } = useCommunication()

  const [commPaneView, setCommPaneView] = useState<'notifications' | 'profile' | 'ai' | 'direct-messages' | 'thoughts' | 'discuss'>('thoughts')
  const [commPaneContext, setCommPaneContext] = useState<{ contextType?: string, contextId?: string, contextTitle?: string } | null>(null)
  /**
   * The object + issue the pane was opened about, when it was opened via
   * the engagement seam rather than by following the active tab.
   *
   * Held alongside commPaneContext rather than replacing it: the existing
   * override (openThoughtsCapture) and the tab derivation both still work
   * exactly as before, and this adds the one thing neither could carry —
   * WHY the user is here.
   */
  const [engagementTarget, setEngagementTarget] = useState<EngagementTarget | null>(null)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const { hasUnreadNotifications } = useNotifications()

  // On phones the tab strip is replaced by a nav drawer opened from the
  // Tesseract mark — the Chrome-tab metaphor assumes you are juggling several
  // surfaces at once, which does not survive a 390px viewport.
  const isMobile = useIsMobile()
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  // Close the drawer if the viewport grows back to desktop mid-session
  // (rotation, or a resized browser window), so it cannot get stranded open.
  useEffect(() => {
    if (!isMobile) setIsMobileNavOpen(false)
  }, [isMobile])

  // Global sidebar store for thoughts capture/inspect modes
  const {
    sidebarMode,
    selectedItem,
    openCaptureSidebar,
    openInspector,
    backToCapture
  } = useSidebarStore()

  // Wrap cite function to exit focus mode after citing
  const cite = useCallback((content: string, fieldName?: string) => {
    originalCite(content, fieldName)
    // Exit focus mode after citing a component
    if (isFocusMode) {
      setIsFocusMode(false)
    }
  }, [originalCite, isFocusMode])

  const handleShowCoverageManager = useCallback(() => {
    // Open coverage as a tab instead of modal
    onSearchResult?.({
      id: 'coverage',
      title: 'Coverage',
      type: 'coverage',
      data: { initialView: 'active' }
    })
  }, [onSearchResult])

  // Each toolbar button toggles its own view: clicking when its view is
  // already open closes the right pane; clicking otherwise opens it on
  // that view. Previously the same click always opened, never closed —
  // users had no obvious way to dismiss the pane without clicking some
  // other view first.
  const handleShowNotifications = () => {
    if (isCommPaneOpen && commPaneView === 'notifications') {
      toggleCommPane()
      return
    }
    setCommPaneView('notifications')
    if (!isCommPaneOpen) toggleCommPane()
  }

  const handleShowDirectMessages = () => {
    if (isCommPaneOpen && commPaneView === 'direct-messages') {
      toggleCommPane()
      return
    }
    setCommPaneView('direct-messages')
    if (!isCommPaneOpen) toggleCommPane()
  }

  const handleShowProfile = () => {
    if (isCommPaneOpen && commPaneView === 'profile') {
      toggleCommPane()
      return
    }
    setCommPaneView('profile')
    if (!isCommPaneOpen) toggleCommPane()
  }

  const handleShowAI = () => {
    if (isCommPaneOpen && commPaneView === 'ai') {
      toggleCommPane()
      return
    }
    setCommPaneView('ai')
    if (!isCommPaneOpen) toggleCommPane()
  }

  const handleShowThoughts = () => {
    if (isCommPaneOpen && commPaneView === 'thoughts') {
      toggleCommPane()
      return
    }
    // Use sidebar store to open in capture mode
    openCaptureSidebar()
    setCommPaneView('thoughts')
    if (!isCommPaneOpen) toggleCommPane()
  }

  const handleNotificationClick = useCallback((notification: any) => {

    // Handle coverage_manager_requests type - open as a tab
    if (notification.type === 'coverage_manager_requests') {
      onSearchResult?.({
        id: 'coverage-requests',
        title: 'Coverage',
        type: 'coverage',
        data: { initialView: 'requests' }
      })
      // Close the comm pane
      if (isCommPaneOpen) {
        toggleCommPane()
      }
      return
    }

    // Handle workflow access requests - navigate to workflow Team & Admins tab
    if (notification.type === 'workflow' && notification.tab === 'admins') {
      // Create a workflow search result with the tab parameter
      onSearchResult({
        ...notification,
        type: 'workflow',
        activeTab: 'admins' // Pass the tab to open
      })
      // Close the comm pane
      if (isCommPaneOpen) {
        toggleCommPane()
      }
      return
    }

    // Handle other notification types...
    if (notification.type === 'asset') {
      onSearchResult(notification)
      // Close the comm pane
      if (isCommPaneOpen) {
        toggleCommPane()
      }
    }
  }, [isCommPaneOpen, toggleCommPane, onSearchResult])

  const handleFocusMode = useCallback((enable: boolean) => {
    setIsFocusMode(enable)
    // Focus mode is no longer tied to context conversations.
    // Keep the flag for any citation-based features that remain.
  }, [isCommPaneOpen, toggleCommPane])

  // ESC key listener to exit focus mode
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFocusMode) {
        handleFocusMode(false)
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => document.removeEventListener('keydown', handleEscKey)
  }, [isFocusMode, handleFocusMode])

  // Listen for custom event to open direct messages
  useEffect(() => {
    const handleOpenDirectMessage = (event: CustomEvent) => {
      const { conversationId } = event.detail
      // Switch to direct-messages view
      setCommPaneView('direct-messages')

      // Open the comm pane if not already open
      if (!isCommPaneOpen) {
        toggleCommPane()
      }

      // Set the conversation ID in the URL or state
      // The DirectMessagesSection will pick it up
      const url = new URL(window.location.href)
      url.searchParams.set('conversation', conversationId)
      window.history.pushState({}, '', url.toString())
    }

    window.addEventListener('openDirectMessage', handleOpenDirectMessage as EventListener)
    return () => window.removeEventListener('openDirectMessage', handleOpenDirectMessage as EventListener)
  }, [isCommPaneOpen, toggleCommPane])

  // Listen for custom event to open thoughts capture (from Attention Dashboard)
  useEffect(() => {
    const handleOpenThoughtsCapture = (event: CustomEvent) => {
      const { contextType, contextId, contextTitle, captureType } = event.detail || {}

      // Set context if provided
      if (contextType && contextId) {
        setCommPaneContext({ contextType, contextId, contextTitle })
      }

      // Use store to open in capture mode (with optional auto-select type)
      openCaptureSidebar(captureType || null)

      // Switch to thoughts view
      setCommPaneView('thoughts')

      // Open the comm pane if not already open
      if (!isCommPaneOpen) {
        toggleCommPane()
      }
    }

    window.addEventListener('openThoughtsCapture', handleOpenThoughtsCapture as EventListener)
    return () => window.removeEventListener('openThoughtsCapture', handleOpenThoughtsCapture as EventListener)
  }, [isCommPaneOpen, toggleCommPane, openCaptureSidebar])

  /**
   * The engagement seam.
   *
   * One subscriber for every surface. A surfaced item calls
   * openEngagement(target, mode) and this binds the object into the pane the
   * app already has — so the user never re-types the ticker, re-finds the
   * idea, or restates the problem to open AI or a team thread.
   *
   * The commPaneContext override is set as well as engagementTarget so that
   * everything downstream which still reads contextType/contextId — the
   * conversation list, the citation flow, the thoughts capture — keeps
   * working. Where the target has no taggable object of its own, this falls
   * back to the asset it hangs off, matching toAITags.
   */
  useEffect(() => subscribeToEngagement(({ target, mode }) => {
    setEngagementTarget(target)

    const taggable = ['asset', 'portfolio', 'theme', 'note']
    if (taggable.includes(target.objectType)) {
      setCommPaneContext({
        contextType: target.objectType,
        contextId: target.objectId,
        contextTitle: target.label,
      })
    } else if (target.assetId) {
      setCommPaneContext({
        contextType: 'asset',
        contextId: target.assetId,
        contextTitle: target.symbol ?? target.label,
      })
    } else {
      setCommPaneContext(null)
    }

    // The requested mode is honoured exactly, including when the object
    // cannot hold a thread.
    //
    // An earlier revision substituted AI for an unsupported Discuss. That was
    // wrong: it silently changed what the user asked for, and the substitution
    // was invisible — a user who asked to talk to a person would have found
    // themselves talking to a model without being told. Surfaces avoid the
    // situation by asking canDiscuss() before offering the control; if a
    // request arrives anyway, EngagementThread renders an explicit unavailable
    // state that names why. Failing visibly beats redirecting quietly.
    setCommPaneView(mode)
    openCommPane()
  }), [openCommPane])

  // Listen for custom event to open thought detail (from Ideas tab)
  useEffect(() => {
    const handleOpenThoughtDetail = (event: CustomEvent) => {
      const { thoughtId, itemType } = event.detail || {}
      if (!thoughtId) return

      // Use store to open in inspect mode
      const type = (itemType || 'quick_thought') as InspectableItemType
      openInspector(type, thoughtId)

      // Switch to thoughts view
      setCommPaneView('thoughts')

      // Open the comm pane if not already open
      if (!isCommPaneOpen) {
        toggleCommPane()
      }
    }

    window.addEventListener('openThoughtDetail', handleOpenThoughtDetail as EventListener)
    return () => window.removeEventListener('openThoughtDetail', handleOpenThoughtDetail as EventListener)
  }, [isCommPaneOpen, toggleCommPane, openInspector])

  // Determine communication context from active tab
  const getCommContext = () => {
    if (!activeTabId) return { contextType: undefined, contextId: undefined, contextTitle: undefined }
    
    const activeTab = tabs.find(tab => tab.id === activeTabId)
    if (!activeTab) return { contextType: undefined, contextId: undefined, contextTitle: undefined }
    
    // Extract context from tab type and data
    if (activeTab.type === 'asset' && activeTab.data?.id) {
      // Use full format: "SYMBOL - Company Name" to match recent conversations
      const symbol = activeTab.data.symbol || activeTab.title
      const companyName = activeTab.data.company_name
      const contextTitle = companyName ? `${symbol} - ${companyName}` : symbol

      return {
        contextType: 'asset' as const,
        contextId: activeTab.data.id,
        contextTitle
      }
    }
    
    if (activeTab.type === 'portfolio' && activeTab.data?.id) {
      return {
        contextType: 'portfolio' as const,
        contextId: activeTab.data.id,
        contextTitle: activeTab.data.name || activeTab.title
      }
    }
    
    if (activeTab.type === 'theme' && activeTab.data?.id) {
      return {
        contextType: 'theme' as const,
        contextId: activeTab.data.id,
        contextTitle: activeTab.data.name || activeTab.title
      }
    }
    
    if (activeTab.type === 'notebook' && activeTab.data?.id) {
      return {
        contextType: 'note' as const,
        contextId: activeTab.data.id,
        contextTitle: activeTab.data.name || activeTab.title
      }
    }

    if (activeTab.type === 'project' && activeTab.data?.id) {
      return {
        contextType: 'project' as const,
        contextId: activeTab.data.id,
        contextTitle: activeTab.data.title || activeTab.title
      }
    }

    if (activeTab.type === 'list' && activeTab.data?.id) {
      return {
        contextType: 'list' as const,
        contextId: activeTab.data.id,
        contextTitle: activeTab.data.name || activeTab.title
      }
    }

    // For other tab types (dashboard, etc.), don't provide context
    return { contextType: undefined, contextId: undefined, contextTitle: undefined }
  }

  // Use override context if set, otherwise fall back to tab-based context
  const tabContext = getCommContext()
  const hasOverride = commPaneContext !== null
  const { contextType, contextId, contextTitle } = hasOverride
    ? commPaneContext
    : tabContext

  const handleContextChange = useCallback((contextType: string, contextId: string, contextTitle: string, contextData?: any) => {
    // If context is being cleared (back to conversation list), clear the override
    if (!contextType || !contextId) {
      setCommPaneContext({ contextType: undefined, contextId: undefined, contextTitle: undefined })
      return
    }
    // Set the override context
    setCommPaneContext({ contextType, contextId, contextTitle })

    // Find if there's already a tab for this context
    const existingTab = tabs.find(tab =>
      tab.data?.id === contextId && tab.type === contextType
    )

    if (existingTab) {
      // Switch to existing tab
      onTabChange(existingTab.id)
    } else {
      // Create new tab for this context
      if (onSearchResult) {
        // For assets, use just the symbol as the title, not the full "SYMBOL - Company Name"
        let tabTitle = contextTitle
        if (contextType === 'asset' && contextData?.symbol) {
          tabTitle = contextData.symbol
        }

        onSearchResult({
          id: contextId,
          title: tabTitle,
          type: contextType,
          data: contextData || { id: contextId, [contextType === 'asset' ? 'symbol' : 'name']: contextTitle }
        })
      }
    }
  }, [tabs, onTabChange, onSearchResult])

  const { isOrgArchived } = useOrganization()

  return (
    <div className="h-viewport flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      <Header
        onSearchResult={onSearchResult}
        onShowDirectMessages={handleShowDirectMessages}
        onShowNotifications={handleShowNotifications}
        onShowCoverageManager={handleShowCoverageManager}
        isCommPaneOpen={isCommPaneOpen}
        onToggleCommPane={toggleCommPane}
        commPaneView={commPaneView}
        onShowAI={handleShowAI}
        onShowThoughts={handleShowThoughts}
        onOpenMobileNav={() => setIsMobileNavOpen(true)}
      />
      {isOrgArchived && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-center gap-2 text-sm text-amber-800">
          <Archive className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">This organization is archived.</span>
          <span className="text-amber-600">All data is read-only. Contact a platform administrator to restore.</span>
        </div>
      )}
      {!isMobile && (
        <TabManager
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={onTabChange}
          onTabClose={onTabClose}
          onCloseTabs={onCloseTabs}
          onNewTab={onNewTab}
          onTabReorder={onTabReorder}
          onTabsReorder={onTabsReorder}
          onFocusSearch={onFocusSearch}
          hideNewTab={hideNewTab}
        />
      )}
      <main className="flex-1 min-h-0 overflow-hidden">
        {(() => {
          const activeTab = tabs.find(tab => tab.id === activeTabId)
          const isFullWidth = activeTab && FULL_WIDTH_TAB_TYPES.includes(activeTab.type)
          const isCompactPad = activeTab && ['outcomes'].includes(activeTab.type)
          return (
            <div className={clsx(
              "relative h-full flex flex-col",
              isFullWidth ? "overflow-hidden" : isCompactPad ? "overflow-hidden p-2" : "overflow-auto",
              !isFullWidth && !isCompactPad && "px-3 py-4 sm:px-6 sm:py-6 lg:px-8",
              "transition-[margin] duration-300 ease-in-out",
              // The comm pane becomes a bottom sheet on phones, so it must not
              // reserve a 384px right margin out of a 390px viewport.
              isCommPaneOpen && !isCommPaneFullscreen && !isMobile ? "mr-96" : "mr-0",
              isFocusMode && "ring-4 ring-primary-400 ring-opacity-50"
            )}>
          {isFocusMode && (
            <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-primary-600 text-white px-6 py-3 rounded-full shadow-lg flex items-center space-x-3">
              <Eye className="h-5 w-5" />
              <span className="font-medium">Focus Mode: Click any component to cite it • Press ESC to exit</span>
              <button
                onClick={() => handleFocusMode(false)}
                className="ml-2 hover:bg-primary-700 rounded-full p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {React.cloneElement(children as React.ReactElement, { onCite: cite, isFocusMode })}
            </div>
          )
        })()}
      </main>
      
      <CommunicationPane
        isMobile={isMobile}
        isOpen={isCommPaneOpen}
        onToggle={toggleCommPane}
        isFullscreen={isCommPaneFullscreen}
        onToggleFullscreen={toggleCommPaneFullscreen}
        view={commPaneView}
        onViewChange={setCommPaneView}
        contextType={contextType}
        contextId={contextId}
        contextTitle={contextTitle}
        engagementTarget={engagementTarget}
        citedContent={currentCitation?.content}
        fieldName={currentCitation?.fieldName}
        onCite={cite}
        onContextChange={handleContextChange}
        onShowCoverageManager={handleShowCoverageManager}
        onFocusMode={handleFocusMode}
        isFocusMode={isFocusMode}
        onNotificationClick={handleNotificationClick}
        sidebarMode={sidebarMode}
        selectedItem={selectedItem}
        onBackToCapture={backToCapture}
        onOpenInspector={openInspector}
        onOpenSettings={() => {
          // Dispatch event to open settings modal in Header
          window.dispatchEvent(new CustomEvent('openSettings'))
          // Close the comm pane
          if (isCommPaneOpen) {
            toggleCommPane()
          }
        }}
      />

      {/* Inert unless the URL carries ?overflow=1 */}
      <OverflowAuditOverlay />

      {isMobile && (
        <MobileNavDrawer
          open={isMobileNavOpen}
          onClose={() => setIsMobileNavOpen(false)}
          onSearchResult={onSearchResult}
          onOpenSearch={onFocusSearch}
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={onTabChange}
          onTabClose={onTabClose}
        />
      )}
    </div>
  )
}