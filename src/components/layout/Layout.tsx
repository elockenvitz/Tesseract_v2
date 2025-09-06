import React from 'react'
import { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { Header } from './Header'
import { TabManager, type Tab } from './TabManager'
import { CommunicationPane } from '../communication/CommunicationPane'
import { CoverageManager } from '../coverage/CoverageManager'
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
    cite, 
    clearCitation,
    openCommPane
  } = useCommunication()
  
  const [commPaneView, setCommPaneView] = useState<'messages' | 'notifications' | 'profile' | 'ai'>('messages')
  const [showCoverageManager, setShowCoverageManager] = useState(false)
  const { hasUnreadNotifications } = useNotifications()

  const handleShowCoverageManager = useCallback(() => {
    setShowCoverageManager(true)
  }, [])

  const handleShowNotifications = () => {
    setCommPaneView('notifications')
    if (!isCommPaneOpen) {
      toggleCommPane()
    }
  }

  const handleShowMessages = () => {
    setCommPaneView('messages')
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

  // Determine communication context from active tab
  const getCommContext = () => {
    if (!activeTabId) return { contextType: undefined, contextId: undefined, contextTitle: undefined }
    
    const activeTab = tabs.find(tab => tab.id === activeTabId)
    if (!activeTab) return { contextType: undefined, contextId: undefined, contextTitle: undefined }
    
    // Extract context from tab type and data
    if (activeTab.type === 'asset' && activeTab.data?.id) {
      return {
        contextType: 'asset' as const,
        contextId: activeTab.data.id,
        contextTitle: activeTab.data.symbol || activeTab.title
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

  const { contextType, contextId, contextTitle } = getCommContext()

  const handleContextChange = useCallback((contextType: string, contextId: string, contextTitle: string) => {
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
        onSearchResult({
          id: contextId,
          title: contextTitle,
          type: contextType,
          data: { id: contextId, [contextType === 'asset' ? 'symbol' : 'name']: contextTitle }
        })
      }
    }
  }, [tabs, onTabChange, onSearchResult])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header 
        onSearchResult={onSearchResult}
        onShowMessages={handleShowMessages}
        hasUnreadMessages={false}
        onShowDirectMessages={handleShowDirectMessages}
        onShowNotifications={handleShowNotifications}
        isCoverageManagerOpen={showCoverageManager}
        onCloseCoverageManager={() => setShowCoverageManager(false)}
        onShowCoverageManager={handleShowCoverageManager}
        isCommPaneOpen={isCommPaneOpen}
        onToggleCommPane={toggleCommPane}
        commPaneView={commPaneView}
        onShowAI={handleShowAI}
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
      <main className="flex-1">
        <div className={clsx(
          "px-4 sm:px-6 lg:px-8 py-6 relative transition-all duration-300",
          isCommPaneOpen && !isCommPaneFullscreen ? "mr-96" : "mr-0"
        )}>
          {React.cloneElement(children as React.ReactElement, { onCite: cite })}
        </div>
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
      />
      
      <CoverageManager
        isOpen={showCoverageManager}
        onClose={() => setShowCoverageManager(false)}
      />
      
    </div>
  )
}