import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { arrayMove } from '@dnd-kit/sortable'
import { useQuery } from '@tanstack/react-query'
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
import { TradePlanHistoryPage } from './TradePlanHistoryPage'
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
import { AuditExplorerPage } from './AuditExplorerPage'
import type { AttentionType } from '../types/attention'
import type { DashboardItem } from '../types/dashboard-item'
import type { CockpitBand } from '../types/cockpit'
import { DashboardFilters } from '../components/dashboard/DashboardFilters'
import { DecisionSnapshotBar } from '../components/dashboard/DecisionSnapshotBar'
import { BandSection } from '../components/dashboard/BandSection'
import { AdvanceBandSection } from '../components/dashboard/AdvanceBandSection'
import { TradePipelineLoop, type StageKey } from '../components/dashboard/TradePipelineLoop'
import { SystemInsightCard } from '../components/dashboard/SystemInsightCard'
import { useDashboardScope } from '../hooks/useDashboardScope'
import { useCockpitFeed } from '../hooks/useCockpitFeed'
import { useAuth } from '../hooks/useAuth'

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

  // Auth
  const { user } = useAuth()

  // Dashboard scope (portfolio, coverage, urgent filters)
  const [scope, setScope] = useDashboardScope()

  // Portfolio list for scope bar
  const { data: portfolios = [] } = useQuery({
    queryKey: ['user-portfolios', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const [ownedRes, teamRes] = await Promise.all([
        supabase.from('portfolios').select('id, name, team_id, teams:team_id(id, name)').eq('created_by', user.id),
        supabase
          .from('portfolio_team')
          .select('portfolio_id, portfolios:portfolio_id(id, name, team_id, teams:team_id(id, name))')
          .eq('user_id', user.id),
      ])
      const owned = ownedRes.data ?? []
      const team = (teamRes.data ?? [])
        .map((t: any) => t.portfolios)
        .filter(Boolean)
      const all = [...owned, ...team]
      const unique = Array.from(new Map(all.map(p => [p.id, p])).values())
      return unique as { id: string; name: string; team_id: string | null; teams: { id: string; name: string } | null }[]
    },
    enabled: !!user?.id,
    staleTime: 300_000,
  })

  // Track DECIDE expanded state — controls right column visibility
  const [decideExpanded, setDecideExpanded] = useState(true)

  // Pipeline stage filter — clicking a stage in TradePipelineLoop filters DECIDE
  const [pipelineStage, setPipelineStage] = useState<StageKey | null>(null)

  // Stable navigate ref — handleSearchResult is defined below but onClick closures
  // only fire on user interaction (never during render), so a ref is safe.
  const navigateRef = useRef<(detail: any) => void>(() => {})
  const stableNavigate = useCallback(
    (detail: any) => navigateRef.current(detail),
    [],
  )

  // Cockpit feed — merges Decision Engine + Attention System → stacked view model
  const cockpit = useCockpitFeed(
    { portfolioIds: scope.portfolioIds, urgentOnly: scope.urgentOnly },
    stableNavigate,
  )

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
    // Also check for singleton tabs by type (only one tab of this type allowed)
    const existingTab = tabs.find(tab => {
      if (tab.id === result.id) return true
      // For asset tabs, also check by symbol
      if (result.type === 'asset' && result.data?.symbol && tab.data?.symbol === result.data.symbol) return true
      if (result.type === 'asset' && result.data?.symbol && tab.id === result.data.symbol) return true
      // For singleton tabs, check by type (only one tab of this type allowed)
      if (result.type === 'coverage' && tab.type === 'coverage') return true
      if (result.type === 'trade-lab' && tab.type === 'trade-lab') return true
      if (result.type === 'trade-queue' && tab.type === 'trade-queue') return true
      if (result.type === 'trade-plans' && tab.type === 'trade-plans') return true
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

  // Keep navigate ref in sync with latest handleSearchResult
  navigateRef.current = handleSearchResult

  // Decision engine action dispatch → tab navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) handleSearchResult(detail)
    }
    window.addEventListener('decision-engine-action', handler)
    return () => window.removeEventListener('decision-engine-action', handler)
  })

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

  // Listen for custom event to open Trade Lab with specific portfolio
  useEffect(() => {
    const handleOpenTradeLab = (event: CustomEvent) => {
      const { labId, labName, portfolioId } = event.detail || {}
      console.log('🧪 Opening Trade Lab:', { labId, labName, portfolioId })

      // Navigate to trade-lab tab with the portfolio/lab ID
      // Always use "Trade Lab" as the tab title for consistency
      handleSearchResult({
        id: labId || 'trade-lab',
        title: 'Trade Lab',
        type: 'trade-lab',
        data: { id: labId, portfolioId }
      })
    }

    window.addEventListener('openTradeLab', handleOpenTradeLab as EventListener)
    return () => window.removeEventListener('openTradeLab', handleOpenTradeLab as EventListener)
  }, [])

  // Listen for custom event to open a shared simulation
  useEffect(() => {
    const handleOpenSharedSimulation = (event: CustomEvent) => {
      const { share } = event.detail || {}
      if (!share) return
      handleSearchResult({
        id: `shared-${share.share_id}`,
        title: `Shared: ${share.name}`,
        type: 'trade-lab',
        data: { shareId: share.share_id }
      })
    }
    window.addEventListener('open-shared-simulation', handleOpenSharedSimulation as EventListener)
    return () => window.removeEventListener('open-shared-simulation', handleOpenSharedSimulation as EventListener)
  }, [])

  // Listen for custom event to open Trade Plans tab
  useEffect(() => {
    const handleOpenTradePlans = () => {
      handleSearchResult({
        id: 'trade-plans',
        title: 'Trade Plans',
        type: 'trade-plans',
        data: {}
      })
    }
    window.addEventListener('openTradePlans', handleOpenTradePlans)
    return () => window.removeEventListener('openTradePlans', handleOpenTradePlans)
  }, [])

  // Listen for custom event to open Ideas tab with filters (e.g., from "View all" in sidebar)
  useEffect(() => {
    const handleOpenIdeasTab = (event: CustomEvent) => {
      const { filters } = event.detail || {}
      console.log('💡 Opening Ideas tab with filters:', filters)

      // Navigate to idea-generator tab with initial filters
      handleSearchResult({
        id: 'idea-generator',
        title: 'Ideas',
        type: 'idea-generator',
        data: { initialFilters: filters }
      })
    }

    window.addEventListener('openIdeasTab', handleOpenIdeasTab as EventListener)
    return () => window.removeEventListener('openIdeasTab', handleOpenIdeasTab as EventListener)
  }, [])

  // Listen for custom event to open Trade Queue (e.g., from toast action after creating trade idea)
  useEffect(() => {
    const handleOpenTradeQueue = (event: CustomEvent) => {
      const { selectedTradeId } = event.detail || {}
      console.log('📋 Opening Trade Queue:', { selectedTradeId })

      handleSearchResult({
        id: 'trade-queue',
        title: 'Trade Queue',
        type: 'trade-queue',
        data: selectedTradeId ? { selectedTradeId } : undefined
      })
    }

    window.addEventListener('openTradeQueue', handleOpenTradeQueue as EventListener)
    return () => window.removeEventListener('openTradeQueue', handleOpenTradeQueue as EventListener)
  }, [])

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
        return <IdeaGeneratorPage onItemSelect={handleSearchResult} initialFilters={activeTab.data?.initialFilters} />
      case 'workflows':
        return <WorkflowsPage />
      case 'projects-list':
        return <ProjectsPage onProjectSelect={handleSearchResult} />
      case 'project':
        return activeTab.data ? <ProjectDetailTab project={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading project...</div>
      case 'trade-queue':
        return <TradeQueuePage />
      case 'trade-lab':
        return <SimulationPage simulationId={activeTab.data?.id} tabId={activeTab.id} initialPortfolioId={activeTab.data?.portfolioId} shareId={activeTab.data?.shareId} />
      case 'trade-plans':
        return <TradePlanHistoryPage />
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
      case 'audit':
        return <AuditExplorerPage />
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

  const handleViewAll = (type: AttentionType) => {
    handleSearchResult({
      id: 'priorities',
      title: 'All Priorities',
      type: 'priorities' as any,
      data: { filterType: type }
    })
  }

  const handleOpenTradeQueue = (filter?: string) => {
    handleSearchResult({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: filter ? { stageFilter: filter } : undefined,
    })
  }

  // Scroll to a band element
  const handleScrollToBand = (band: CockpitBand) => {
    const el = document.getElementById(`band-${band}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Row click → navigate to item's primary action
  const handleRowClick = useCallback((item: DashboardItem) => {
    item.primaryAction.onClick()
  }, [])

  // Selected portfolio name for snapshot bar
  const selectedPortfolioName = useMemo(() => {
    if (scope.portfolioIds.length === 0) return null
    if (scope.portfolioIds.length === 1) {
      return portfolios.find(p => p.id === scope.portfolioIds[0])?.name ?? null
    }
    return `${scope.portfolioIds.length} portfolios`
  }, [scope.portfolioIds, portfolios])

  // Filtered DECIDE band — when a pipeline stage is selected, show only matching stacks
  const filteredDecide = useMemo(() => {
    if (!pipelineStage) return cockpit.viewModel.decide

    // Map pipeline stage → stack kinds to show
    const kindFilter: Record<StageKey, string[]> = {
      deciding: ['proposal'],
      modeling: ['simulation'],
      executing: ['execution'],
    }
    const allowedKinds = new Set(kindFilter[pipelineStage])

    // Pull matching stacks from ALL bands (modeling items are normally in ADVANCE)
    const allStacks = [
      ...cockpit.viewModel.decide.stacks,
      ...cockpit.viewModel.advance.stacks,
      ...cockpit.viewModel.aware.stacks,
    ]
    let filtered = allStacks.filter(s => allowedKinds.has(s.kind))

    // For modeling: filter simulation stacks to only 'simulating' stage items
    // and rename to "Ideas Being Modeled"
    if (pipelineStage === 'modeling') {
      filtered = filtered.map(stack => {
        const modelingItems = stack.itemsAll.filter(i => i.meta?.stage === 'simulating')
        if (modelingItems.length === 0 && stack.itemsAll.length > 0) return null
        return {
          ...stack,
          title: 'Ideas Being Modeled',
          itemsAll: modelingItems,
          itemsPreview: modelingItems.slice(0, 3),
          count: modelingItems.length,
        }
      }).filter(Boolean) as typeof filtered
    }

    const totalItems = filtered.reduce((sum, s) => sum + s.count, 0)

    return {
      ...cockpit.viewModel.decide,
      stacks: filtered,
      totalItems,
    }
  }, [cockpit.viewModel, pipelineStage])

  // Keyboard shortcuts: D→DECIDE, A→ADVANCE, I→INVESTIGATE (only when dashboard is active)
  useEffect(() => {
    if (activeTab?.type !== 'dashboard') return
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'd' || e.key === 'D') {
        handleScrollToBand('DECIDE')
      } else if (e.key === 'a' || e.key === 'A') {
        handleScrollToBand('ADVANCE')
      } else if (e.key === 'i' || e.key === 'I') {
        handleScrollToBand('INVESTIGATE')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab?.type])

  const renderDashboardContent = () => {
    return (
      <div className="h-full overflow-auto">
        {/*
         * Decision Cockpit — Command Center Layout
         *
         * Row 1: Filters
         * Row 2: DecisionSnapshotBar (full width — scan in 5-8 seconds)
         * Row 3: [DECIDE section | Pipeline + Insight] (two-column grid)
         * Row 4: ADVANCE summary cards (collapsed by default)
         * Row 5: AWARE + INVESTIGATE (compact, collapsed)
         */}
        <div className="p-3 space-y-3">
          {/* Row 1: Integrated filter row */}
          <DashboardFilters
            scope={scope}
            onScopeChange={setScope}
            portfolios={portfolios}
          />

          {/* Row 2: Decision Snapshot Bar */}
          <DecisionSnapshotBar
            viewModel={cockpit.viewModel}
            pipelineStats={cockpit.pipelineStats}
            isLoading={cockpit.isLoading}
            portfolioName={selectedPortfolioName}
            onScrollToBand={handleScrollToBand}
            onOpenTradeQueue={handleOpenTradeQueue}
          />

          {/* Row 3: Two-column — DECIDE (primary) + Pipeline & Insight (secondary) */}
          <div className={clsx(
            'grid grid-cols-1 gap-3',
            decideExpanded && 'lg:grid-cols-[1fr_320px] items-stretch',
          )}>
            {/* Left: DECIDE — Requires Decision */}
            <BandSection
              id="band-DECIDE"
              bandData={filteredDecide}
              defaultExpanded
              onItemClick={handleRowClick}
              onSnooze={cockpit.snooze}
              onExpandedChange={setDecideExpanded}
            />

            {/* Right: Pipeline + System Insight — visible when DECIDE is expanded */}
            {decideExpanded && (
              <div className="flex flex-col gap-3">
                <TradePipelineLoop
                  stats={cockpit.pipelineStats}
                  isLoading={cockpit.isLoading}
                  onOpenTradeQueue={handleOpenTradeQueue}
                  activeStage={pipelineStage}
                  onStageSelect={setPipelineStage}
                />
                <SystemInsightCard
                  viewModel={cockpit.viewModel}
                  pipelineStats={cockpit.pipelineStats}
                  onScrollToBand={handleScrollToBand}
                  onOpenTradeQueue={handleOpenTradeQueue}
                />
              </div>
            )}
          </div>

          {/* Row 4: ADVANCE — Summary cards (collapsed by default) */}
          <AdvanceBandSection
            id="band-ADVANCE"
            bandData={cockpit.viewModel.advance}
            onItemClick={handleRowClick}
            onSnooze={cockpit.snooze}
          />

          {/* Row 5: AWARE — Monitoring (hidden in urgent-only mode) */}
          {!scope.urgentOnly && (
            <BandSection
              id="band-AWARE"
              bandData={cockpit.viewModel.aware}
              onItemClick={handleRowClick}
              onSnooze={cockpit.snooze}
            />
          )}

          {/* Row 5b: INVESTIGATE — System flags & team prompts */}
          {!scope.urgentOnly && (
            <BandSection
              id="band-INVESTIGATE"
              bandData={cockpit.viewModel.investigate}
              onItemClick={handleRowClick}
              onSnooze={cockpit.snooze}
            />
          )}
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
