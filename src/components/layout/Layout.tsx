import React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { clsx } from 'clsx'
import { Eye, X } from 'lucide-react'
import { Header } from './Header'
import { TabManager, type Tab } from './TabManager'
import { CommunicationPane } from '../communication/CommunicationPane'
import { NotificationPane } from '../notifications/NotificationPane'
import { useCommunication } from '../../hooks/useCommunication'
import { useNotifications } from '../../hooks/useNotifications'

interface LayoutProps {
  children: React.ReactNode
  tabs: Tab[]
  activeTabId?: string
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  onTabReorder: (fromIndex: number, toIndex: number) => void
  onSearchResult?: (result: any) => void
  onFocusSearch?: () => void
}

// Tab types that should render full-width without padding
const FULL_WIDTH_TAB_TYPES = ['trade-lab', 'simulation', 'trade-queue', 'coverage', 'organization']

export function Layout({
  children,
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onNewTab,
  onTabReorder,
  onSearchResult,
  onFocusSearch
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

  const [commPaneView, setCommPaneView] = useState<'messages' | 'notifications' | 'profile' | 'ai' | 'direct-messages' | 'thoughts'>('messages')
  const [commPaneContext, setCommPaneContext] = useState<{ contextType?: string, contextId?: string, contextTitle?: string } | null>(null)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const { hasUnreadNotifications } = useNotifications()

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

  const handleShowNotifications = () => {
    setCommPaneView('notifications')
    if (!isCommPaneOpen) {
      toggleCommPane()
    }
  }

  const handleShowMessages = () => {
    setCommPaneView('messages')
    // Reset to tab-based context when opening messages view
    setCommPaneContext(null)
    if (!isCommPaneOpen) {
      toggleCommPane()
    }
  }

  const handleShowDirectMessages = () => {
    setCommPaneView('direct-messages')
    if (!isCommPaneOpen) {
      toggleCommPane()
    }
  }

  const handleShowProfile = () => {
    setCommPaneView('profile')
    if (!isCommPaneOpen) {
      toggleCommPane()
    }
  }

  const handleShowAI = () => {
    setCommPaneView('ai')
    if (!isCommPaneOpen) {
      toggleCommPane()
    }
  }

  const handleShowThoughts = () => {
    setCommPaneView('thoughts')
    if (!isCommPaneOpen) {
      toggleCommPane()
    }
  }

  const handleNotificationClick = useCallback((notification: any) => {
    console.log('🔔 Notification clicked:', notification)
    console.log('🔔 Notification type:', notification.type)
    console.log('🔔 Notification data:', notification.data)

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
    console.log('🔍 Focus mode:', enable ? 'enabled' : 'disabled')

    // When enabling focus mode, switch context to current tab and open comm pane
    if (enable) {
      // Get the current tab's context
      const tabContext = getCommContext()

      // If current tab has a valid context, switch to it
      if (tabContext.contextType && tabContext.contextId) {
        console.log('🎯 Switching to current tab context:', tabContext)
        // Clear any override context to use the current tab's context
        setCommPaneContext(null)
        // Switch to messages view
        setCommPaneView('messages')
        // Open the comm pane if it's not already open
        if (!isCommPaneOpen) {
          toggleCommPane()
        }
      }
    }
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
      console.log('📬 Opening direct message conversation:', conversationId)

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
    
    // For other tab types (dashboard, lists, etc.), don't provide context
    return { contextType: undefined, contextId: undefined, contextTitle: undefined }
  }

  // Use override context if set, otherwise fall back to tab-based context
  const tabContext = getCommContext()
  const hasOverride = commPaneContext !== null
  const { contextType, contextId, contextTitle } = hasOverride
    ? commPaneContext
    : tabContext

  console.log('🎯 Context resolution - hasOverride:', hasOverride, 'commPaneContext:', commPaneContext, 'tabContext:', tabContext, 'final:', { contextType, contextId, contextTitle })

  const handleContextChange = useCallback((contextType: string, contextId: string, contextTitle: string, contextData?: any) => {
    console.log('🔄 handleContextChange called with:', { contextType, contextId, contextTitle, contextData })
    // If context is being cleared (back to conversation list), clear the override
    if (!contextType || !contextId) {
      console.log('✅ Context cleared, showing conversation list')
      setCommPaneContext({ contextType: undefined, contextId: undefined, contextTitle: undefined })
      return
    }

    console.log('🔧 Setting override context')
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header
        onSearchResult={onSearchResult}
        onShowMessages={handleShowMessages}
        hasUnreadMessages={false}
        onShowDirectMessages={handleShowDirectMessages}
        onShowNotifications={handleShowNotifications}
        onShowCoverageManager={handleShowCoverageManager}
        isCommPaneOpen={isCommPaneOpen}
        onToggleCommPane={toggleCommPane}
        commPaneView={commPaneView}
        onShowAI={handleShowAI}
        onShowThoughts={handleShowThoughts}
      />
      <TabManager
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        onNewTab={onNewTab}
        onTabReorder={onTabReorder}
        onFocusSearch={onFocusSearch}
      />
      <main className="flex-1 h-[calc(100vh-8rem)]">
        {(() => {
          const activeTab = tabs.find(tab => tab.id === activeTabId)
          const isFullWidth = activeTab && FULL_WIDTH_TAB_TYPES.includes(activeTab.type)
          return (
            <div className={clsx(
              "relative h-full",
              // Only transition margin for comm pane, not padding
              "transition-[margin] duration-300",
              !isFullWidth && "px-4 sm:px-6 lg:px-8 py-6",
              isCommPaneOpen && !isCommPaneFullscreen ? "mr-96" : "mr-0",
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
        isOpen={isCommPaneOpen}
        onToggle={toggleCommPane}
        isFullscreen={isCommPaneFullscreen}
        onToggleFullscreen={toggleCommPaneFullscreen}
        view={commPaneView}
        onViewChange={setCommPaneView}
        contextType={contextType}
        contextId={contextId}
        contextTitle={contextTitle}
        citedContent={currentCitation?.content}
        fieldName={currentCitation?.fieldName}
        onCite={cite}
        onContextChange={handleContextChange}
        onShowCoverageManager={handleShowCoverageManager}
        onFocusMode={handleFocusMode}
        isFocusMode={isFocusMode}
        onNotificationClick={handleNotificationClick}
        onOpenSettings={() => {
          // Dispatch event to open settings modal in Header
          window.dispatchEvent(new CustomEvent('openSettings'))
          // Close the comm pane
          if (isCommPaneOpen) {
            toggleCommPane()
          }
        }}
      />
    </div>
  )
}