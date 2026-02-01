import { useState, useEffect, useMemo } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { supabase } from '../lib/supabase'
import { Layout } from '../components/layout/Layout'
import type { Tab } from '../components/layout/TabManager'
import { TabStateManager } from '../lib/tabStateManager'
import { AssetTab } from '../components/tabs/AssetTab'
import { AssetsListPage } from './AssetsListPage'
import { ThemesListPage } from './ThemesListPage'
import { PortfoliosListPage } from './PortfoliosListPage'
import { NotesListPage } from './NotesListPage'
import { ListsPage } from './ListsPage'
import { NoteEditor } from '../components/notes/NoteEditorUnified'
import { PortfolioNoteEditor } from '../components/notes/PortfolioNoteEditorUnified'
import { ThemeNoteEditor } from '../components/notes/ThemeNoteEditorUnified'
import { ThemeTab } from '../components/tabs/ThemeTab'
import { PortfolioTab } from '../components/tabs/PortfolioTab'
import { ListTab } from '../components/tabs/ListTab'
import { BlankTab } from '../components/tabs/BlankTab.tsx'
import { IdeaGeneratorPage} from './IdeaGeneratorPage'
import { WorkflowsPage } from './WorkflowsPage'
import { ProjectsPage } from './ProjectsPage'
import { ProjectDetailTab } from '../components/tabs/ProjectDetailTab'
// Project widgets removed - content now in Command Center carousel
import { TradeQueuePage } from './TradeQueuePage'
import { OutcomesPage } from './OutcomesPage'
import { FilesPage } from './FilesPage'
import { ChartingPage } from './ChartingPage'
import { SimulationPage } from './SimulationPage'
import { AssetAllocationPage } from './AssetAllocationPage'
import { TDFListPage } from './TDFListPage'
import { TDFTab } from '../components/tabs/TDFTab'
import { UserTab } from '../components/tabs/UserTab'
import { TemplatesTab } from '../components/tabs/TemplatesTab'
import { CalendarPage } from './CalendarPage'
// PrioritizerPage removed - consolidated into All Priorities (AttentionPage)
import { CoveragePage } from './CoveragePage'
import { OrganizationPage } from './OrganizationPage'
import { AttentionPage } from './AttentionPage'
import { AttentionDashboard, type QuickCaptureMode } from '../components/attention'
import type { AttentionItem, AttentionType } from '../types/attention'

// Helper to get initial tab state synchronously (avoids flash on refresh)
function getInitialTabState(): { tabs: Tab[]; activeTabId: string } {
  const savedState = TabStateManager.loadMainTabState()
  if (savedState && savedState.tabs && savedState.tabs.length > 0) {
    // Ensure dashboard tab always exists
    const hasDashboard = savedState.tabs.some(tab => tab.id === 'dashboard')
    if (!hasDashboard) {
      savedState.tabs.unshift({
        id: 'dashboard',
        title: 'Dashboard',
        type: 'dashboard',
        isActive: false
      })
    }
    return {
      tabs: savedState.tabs.map(tab => ({
        ...tab,
        isActive: tab.id === savedState.activeTabId
      })),
      activeTabId: savedState.activeTabId
    }
  }
  // Default state
  return {
    tabs: [{ id: 'dashboard', title: 'Dashboard', type: 'dashboard', isActive: true }],
    activeTabId: 'dashboard'
  }
}

// Cache the initial state so we only read from storage once
const cachedInitialState = getInitialTabState()

export function DashboardPage() {
  // Initialize state synchronously from sessionStorage to avoid flash
  const [tabs, setTabs] = useState<Tab[]>(cachedInitialState.tabs)
  const [activeTabId, setActiveTabId] = useState(cachedInitialState.activeTabId)
  const [isInitialized, setIsInitialized] = useState(true) // Already initialized from storage

  // Save tab state whenever tabs or activeTabId changes (but only after initialization)
  useEffect(() => {
    if (isInitialized) {
      // Preserve existing tabStates when saving main state
      const currentState = TabStateManager.loadMainTabState()
      const existingTabStates = currentState?.tabStates || {}
      TabStateManager.saveMainTabState(tabs, activeTabId, existingTabStates)
    }
  }, [tabs, activeTabId, isInitialized])

  const handleSearchResult = async (result: any) => {
    console.log(`🎯 DashboardPage: handleSearchResult called with:`, {
      resultId: result.id,
      resultType: result.type,
      hasData: !!result.data,
      dataWorkflowId: result.data?.workflow_id,
      dataSymbol: result.data?.symbol,
      dataId: result.data?.id
    })

    // For asset type, if we don't have an ID but have a symbol, fetch the asset by symbol
    if (result.type === 'asset' && !result.data?.id && result.data?.symbol) {
      console.log('🔍 DashboardPage: Fetching asset by symbol:', result.data.symbol)
      const { data: assetData, error } = await supabase
        .from('assets')
        .select('*')
        .eq('symbol', result.data.symbol)
        .single()

      if (!error && assetData) {
        console.log('✅ DashboardPage: Found asset by symbol:', assetData.id)
        // Merge the fetched asset data with the navigation data
        result.data = { ...assetData, ...result.data }
        result.id = assetData.id
      } else {
        console.error('❌ DashboardPage: Failed to fetch asset by symbol:', error)
      }
    }

    // Handle 'page' type results - convert to the actual page type
    if (result.type === 'page' && result.data?.pageType) {
      result = {
        ...result,
        type: result.data.pageType,
        id: result.data.pageType // Use pageType as ID for singleton pages
      }
    }

    // Check if a tab with this ID or symbol already exists (for asset tabs)
    // Also check for coverage tabs by type since they should be singleton
    const existingTab = tabs.find(tab => {
      if (tab.id === result.id) return true
      // For asset tabs, also check by symbol
      if (result.type === 'asset' && result.data?.symbol && tab.data?.symbol === result.data.symbol) return true
      if (result.type === 'asset' && result.data?.symbol && tab.id === result.data.symbol) return true
      // For coverage tabs, check by type (singleton - only one coverage tab allowed)
      if (result.type === 'coverage' && tab.type === 'coverage') return true
      return false
    })

    if (existingTab) {
      console.log(`🔄 DashboardPage: Existing tab found, updating data and activating`, {
        existingTabId: existingTab.id,
        resultId: result.id,
        mergedData: { ...existingTab.data, ...result.data }
      })
      // If tab exists, update its data (merge with existing) and activate it
      setTabs(tabs.map(tab => ({
        ...tab,
        isActive: tab.id === existingTab.id,
        // Merge the new data with existing data if this is the matching tab
        ...(tab.id === existingTab.id && result.data ? {
          data: { ...tab.data, ...result.data }
        } : {})
      })))
      setActiveTabId(existingTab.id)
      return
    }
    
    const activeTab = tabs.find(tab => tab.id === activeTabId)
    
    // If we're in a blank tab, replace it instead of creating a new one
    if (activeTab?.isBlank) {
      const updatedTab: Tab = {
        id: result.id,
        title: result.title,
        type: result.type,
        data: result.data,
        isActive: true
      }
      
      // Replace the blank tab with the new content
      const updatedTabs = tabs.map(tab => 
        tab.id === activeTabId 
          ? updatedTab 
          : { ...tab, isActive: false }
      )
      setTabs(updatedTabs)
      setActiveTabId(result.id)
      return
    }
    
    const newTab: Tab = {
      id: result.id,
      title: result.title,
      type: result.type,
      data: result.data,
      isActive: false
    }
    
    // Add new tab and switch to it
    const updatedTabs = tabs.map(tab => ({ ...tab, isActive: false }))
    updatedTabs.push({ ...newTab, isActive: true })
    setTabs(updatedTabs)
    setActiveTabId(result.id)
  }

  const handleTabChange = (tabId: string) => {
    setTabs(tabs.map(tab => ({ ...tab, isActive: tab.id === tabId })))
    setActiveTabId(tabId)
  }

  const handleTabClose = (tabId: string) => {
    if (tabId === 'dashboard') return // Can't close dashboard tab

    // Remove the tab's stored state
    TabStateManager.removeTabState(tabId)

    // Use functional update to handle multiple closes in succession
    setTabs(currentTabs => {
      const tabIndex = currentTabs.findIndex(tab => tab.id === tabId)
      const newTabs = currentTabs.filter(tab => tab.id !== tabId)

      // If closing active tab, switch to dashboard or previous tab
      if (activeTabId === tabId) {
        const newActiveTab = newTabs.length > 0 ? newTabs[Math.max(0, tabIndex - 1)] : newTabs[0]
        if (newActiveTab) {
          setActiveTabId(newActiveTab.id)
          return newTabs.map(tab => ({ ...tab, isActive: tab.id === newActiveTab.id }))
        }
      }
      return newTabs
    })
  }

  const handleNewTab = () => {
    const newTabId = `blank-${Date.now()}`
    const newTab: Tab = {
      id: newTabId,
      title: 'New Tab',
      type: 'dashboard',
      isActive: false,
      isBlank: true
    }
    
    // Add new blank tab and switch to it
    const updatedTabs = tabs.map(tab => ({ ...tab, isActive: false }))
    updatedTabs.push({ ...newTab, isActive: true })
    setTabs(updatedTabs)
    setActiveTabId(newTabId)
  }

  const handleTabReorder = (fromIndex: number, toIndex: number) => {
    setTabs(arrayMove(tabs, fromIndex, toIndex))
  }

  const handleTabsReorder = (newTabs: Tab[]) => {
    setTabs(newTabs)
  }

  const handleFocusSearch = () => {
    // Focus search functionality would be implemented here
  }

  // Memoize active tab to prevent unnecessary recalculations
  const activeTab = useMemo(() =>
    tabs.find(tab => tab.id === activeTabId),
    [tabs, activeTabId]
  )

  const renderTabContent = () => {
    if (!activeTab) {
      return renderDashboardContent()
    }

    if (activeTab.isBlank) {
      return <BlankTab onSearchResult={handleSearchResult} />
    }

    if (activeTab.type === 'dashboard') {
      return renderDashboardContent()
    }

    switch (activeTab.type) {
      case 'asset':
        return activeTab.data ? <AssetTab asset={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading asset...</div>
      case 'assets-list':
        return <AssetsListPage onAssetSelect={handleSearchResult} />
      case 'portfolios-list':
        return <PortfoliosListPage onPortfolioSelect={handleSearchResult} />
      case 'themes-list':
        return <ThemesListPage onThemeSelect={handleSearchResult} />
      case 'notes-list':
        return <NotesListPage onNoteSelect={handleSearchResult} />
      case 'lists':
        return <ListsPage onListSelect={handleSearchResult} />
      case 'list':
        return <ListTab list={activeTab.data} onAssetSelect={handleSearchResult} />
      case 'idea-generator':
        return <IdeaGeneratorPage onItemSelect={handleSearchResult} />
      case 'workflows':
        return <WorkflowsPage />
      case 'projects-list':
        return <ProjectsPage onProjectSelect={handleSearchResult} />
      case 'project':
        return activeTab.data ? <ProjectDetailTab project={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading project...</div>
      case 'trade-queue':
        return <TradeQueuePage />
      case 'trade-lab':
        return <SimulationPage simulationId={activeTab.data?.id} tabId={activeTab.id} />
      case 'asset-allocation':
        return <AssetAllocationPage />
      case 'tdf-list':
        return <TDFListPage onTDFSelect={(tdf) => handleSearchResult({
          id: tdf.id,
          title: tdf.name,
          type: 'tdf',
          data: tdf
        })} />
      case 'tdf':
        return activeTab.data ? <TDFTab tdf={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading TDF...</div>
      case 'allocation-period':
        return <AssetAllocationPage initialPeriodId={activeTab.data?.id} />
      case 'note': {
        // Handle notes from different sources: asset, portfolio, theme
        const entityType = activeTab.data?.entityType || 'asset' // Default to asset for backwards compatibility
        const noteId = activeTab.data?.isNew ? undefined : (activeTab.data?.id || activeTab.id)

        const handleNoteSelect = (newNoteId: string) => {
          // Update the tab's data.id to the new note (but keep the stable tab ID)
          if (newNoteId && newNoteId !== activeTab.data?.id) {
            setTabs(prev => prev.map(tab =>
              tab.id === activeTab.id
                ? { ...tab, data: { ...tab.data, id: newNoteId, isNew: false } }
                : tab
            ))
          }
        }

        // Render the appropriate editor based on entity type
        if (entityType === 'portfolio') {
          const portfolioId = activeTab.data?.portfolioId || activeTab.data?.entityId
          const portfolioName = activeTab.data?.portfolioName || activeTab.data?.entityName || 'Portfolio'
          return portfolioId ? (
            <PortfolioNoteEditor
              portfolioId={portfolioId}
              portfolioName={portfolioName}
              selectedNoteId={noteId}
              onNoteSelect={handleNoteSelect}
            />
          ) : <div className="p-4 text-gray-500">Portfolio note data not available</div>
        }

        if (entityType === 'theme') {
          const themeId = activeTab.data?.themeId || activeTab.data?.entityId
          const themeName = activeTab.data?.themeName || activeTab.data?.entityName || 'Theme'
          return themeId ? (
            <ThemeNoteEditor
              themeId={themeId}
              themeName={themeName}
              selectedNoteId={noteId}
              onNoteSelect={handleNoteSelect}
            />
          ) : <div className="p-4 text-gray-500">Theme note data not available</div>
        }

        // Default: asset notes (handle both formats from AssetTab and search)
        const noteAssetId = activeTab.data?.assetId || activeTab.data?.asset_id || activeTab.data?.entityId
        const noteAssetSymbol = activeTab.data?.assetSymbol || activeTab.data?.assets?.symbol || activeTab.data?.entityName || 'Note'

        return noteAssetId ? (
          <NoteEditor
            assetId={noteAssetId}
            assetSymbol={noteAssetSymbol}
            selectedNoteId={noteId}
            onNoteSelect={handleNoteSelect}
          />
        ) : <div className="p-4 text-gray-500">Note data not available</div>
      }
      case 'theme':
        return <ThemeTab theme={activeTab.data} />
      case 'portfolio':
        return <PortfolioTab portfolio={activeTab.data} onNavigate={handleSearchResult} />
      case 'calendar':
        return <CalendarPage onItemSelect={handleSearchResult} />
      case 'prioritizer':
        // Deprecated: redirect to All Priorities
        // This case handles any saved tabs or deep links to the old route
        return <AttentionPage initialFilter={activeTab.data?.filterType} onNavigate={handleSearchResult} />
      case 'priorities':
        return <AttentionPage initialFilter={activeTab.data?.filterType} onNavigate={handleSearchResult} />
      case 'coverage':
        return <CoveragePage initialView={activeTab.data?.initialView} />
      case 'organization':
        return <OrganizationPage onUserClick={(user) => handleSearchResult({
          id: user.id,
          title: user.full_name,
          type: 'user',
          data: user
        })} />
      case 'outcomes':
        return <OutcomesPage onItemSelect={handleSearchResult} />
      case 'files':
        return <FilesPage onItemSelect={handleSearchResult} />
      case 'charting':
        return <ChartingPage onItemSelect={handleSearchResult} initialSymbol={activeTab.data?.symbol} />
      case 'user':
        return activeTab.data ? <UserTab user={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading user...</div>
      case 'templates':
        return <TemplatesTab />
      case 'workflow':
        // Individual workflow - navigate to workflows page focused on this workflow
        return <WorkflowsPage initialWorkflowId={activeTab.data?.id} />
      case 'workflow-template':
        // Workflow template - navigate to workflows page to create from template
        return <WorkflowsPage initialTemplateId={activeTab.data?.id} />
      case 'notebook':
        // Custom notebook - open the notes editor for this notebook
        return activeTab.data ? (
          <NotesListPage
            onNoteSelect={handleSearchResult}
            initialNotebookId={activeTab.data.id}
          />
        ) : <div>Loading notebook...</div>
      case 'model-template':
        // Model template - go to templates tab focused on models
        return <TemplatesTab initialTab="models" initialTemplateId={activeTab.data?.id} />
      case 'model-file':
        // Model file - navigate to the asset's files or to files page
        if (activeTab.data?.assetId) {
          // Navigate to the asset tab focused on models/files
          return <AssetTab
            asset={{ id: activeTab.data.assetId, symbol: activeTab.data?.assets?.symbol }}
            onNavigate={handleSearchResult}
            initialSection="models"
          />
        }
        return <FilesPage onItemSelect={handleSearchResult} initialFileId={activeTab.data?.id} />
      case 'text-template':
        // Text template - go to templates tab
        return <TemplatesTab initialTab="text" initialTemplateId={activeTab.data?.id} />
      case 'simulation':
        // Simulation - open in trade lab
        return <SimulationPage simulationId={activeTab.data?.id} tabId={activeTab.id} />
      case 'team':
        // Team - go to organization page with team view
        return <OrganizationPage
          initialTeamId={activeTab.data?.id}
          onUserClick={(user) => handleSearchResult({
            id: user.id,
            title: user.full_name,
            type: 'user',
            data: user
          })}
        />
      case 'calendar-event':
        // Calendar event - open calendar focused on this event
        return <CalendarPage onItemSelect={handleSearchResult} initialEventId={activeTab.data?.id} />
      case 'capture':
        // Capture - navigate to the entity it belongs to, or show in context
        if (activeTab.data?.entity_type && activeTab.data?.entity_id) {
          // Navigate to the parent entity
          handleSearchResult({
            id: activeTab.data.entity_id,
            title: activeTab.data.entity_display || 'Entity',
            type: activeTab.data.entity_type,
            data: { id: activeTab.data.entity_id, captureId: activeTab.data.id }
          })
          return <div>Navigating to capture context...</div>
        }
        return <FilesPage onItemSelect={handleSearchResult} />
      default:
        return renderDashboardContent()
    }
  }

  // Dashboard content - focused on priorities only
  // Action/navigation buttons moved to New Tab for intentional discovery

  const renderDashboardContent = () => {
    return (
      <div className="h-full overflow-auto">
      <div className="space-y-6 p-1">
        {/* Priorities Dashboard - "What matters now" */}
        <AttentionDashboard
          onNavigate={(item: AttentionItem) => {
            // Navigate based on source_type and source_id for reliable routing
            const { source_type, source_id, title, context } = item

            switch (source_type) {
              case 'project':
                handleSearchResult({ id: source_id, title, type: 'project', data: { id: source_id } })
                break
              case 'project_deliverable':
                // Navigate to the parent project
                handleSearchResult({
                  id: context?.project_id || source_id,
                  title: item.subtitle || 'Project',
                  type: 'project',
                  data: { id: context?.project_id || source_id }
                })
                break
              case 'trade_queue_item':
                handleSearchResult({
                  id: 'trade-queue',
                  title: 'Trade Queue',
                  type: 'trade-queue',
                  data: { selectedTradeId: source_id }
                })
                break
              case 'list_suggestion':
                handleSearchResult({
                  id: context?.list_id || source_id,
                  title: 'List',
                  type: 'list',
                  data: { id: context?.list_id || source_id }
                })
                break
              case 'notification':
                // Navigate based on notification context
                if (context?.asset_id) {
                  handleSearchResult({ id: context.asset_id, title, type: 'asset', data: { id: context.asset_id } })
                } else if (context?.project_id) {
                  handleSearchResult({ id: context.project_id, title, type: 'project', data: { id: context.project_id } })
                }
                break
              case 'workflow_item':
                handleSearchResult({ id: 'workflows', title: 'Workflows', type: 'workflows', data: null })
                break
              default:
                // Fallback: try to navigate based on context or source URL pattern
                if (context?.asset_id) {
                  handleSearchResult({ id: context.asset_id, title, type: 'asset', data: { id: context.asset_id } })
                } else if (context?.project_id) {
                  handleSearchResult({ id: context.project_id, title, type: 'project', data: { id: context.project_id } })
                } else {
                  // Last resort: parse the source_url
                  const parts = item.source_url.split('/')
                  const type = parts[1]
                  const id = parts[2]
                  handleSearchResult({ id: id || type, title, type: type as any, data: { id } })
                }
            }
          }}
          onQuickCapture={(item: AttentionItem, mode: QuickCaptureMode) => {
            // Open the thoughts capture pane with context from the attention item
            // Extract context from the attention item's source
            let contextType: string | undefined
            let contextId: string | undefined
            let contextTitle: string | undefined

            // Map attention source types to context types for thoughts
            if (item.source_type === 'project' || item.source_type === 'project_deliverable') {
              contextType = 'project'
              contextId = item.context?.project_id || item.source_id
              contextTitle = item.title
            } else if (item.source_type === 'trade_queue_item') {
              // Navigate to trade queue for trade items
              handleSearchResult({ id: 'trade-queue', title: 'Trade Queue', type: 'trade-queue', data: { selectedTradeId: item.source_id } })
              return
            } else if (item.context?.asset_id) {
              contextType = 'asset'
              contextId = item.context.asset_id
              contextTitle = item.title
            } else if (item.context?.list_id) {
              contextType = 'list'
              contextId = item.context.list_id
              contextTitle = item.title
            }

            // Dispatch event to open thoughts capture
            window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
              detail: { contextType, contextId, contextTitle }
            }))
          }}
          onViewAll={(type: AttentionType) => {
            // Navigate to the All Priorities page filtered by type
            handleSearchResult({
              id: 'priorities',
              title: 'All Priorities',
              type: 'priorities' as any,
              data: { filterType: type }
            })
          }}
          maxItemsPerSection={5}
          showScore={import.meta.env.DEV}
        />
      </div>
    </div>
  )
  }

  return (
    <Layout
      tabs={tabs}
      activeTabId={activeTabId}
      onTabReorder={handleTabReorder}
      onTabsReorder={handleTabsReorder}
      onTabChange={handleTabChange}
      onTabClose={handleTabClose}
      onNewTab={handleNewTab}
      onSearchResult={handleSearchResult}
      onFocusSearch={handleFocusSearch}
    >
      {renderTabContent()}
    </Layout>
  )
}
