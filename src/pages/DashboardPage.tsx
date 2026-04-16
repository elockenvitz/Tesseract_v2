import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import { clsx } from 'clsx'
import { arrayMove } from '@dnd-kit/sortable'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
const IdeaGeneratorPage = lazy(() => import('./IdeaGeneratorPage').then(m => ({ default: m.IdeaGeneratorPage })))
const WorkflowsPage = lazy(() => import('./WorkflowsPage').then(m => ({ default: m.WorkflowsPage })))
import { ProjectsPage } from './ProjectsPage'
import { ProjectDetailTab } from '../components/tabs/ProjectDetailTab'
// Project widgets removed - content now in Command Center carousel
import { TradeQueuePage } from './TradeQueuePage'
import { AddTradeIdeaModal } from '../components/trading/AddTradeIdeaModal'
const DecisionAccountabilityPage = lazy(() => import('./DecisionAccountabilityPage').then(m => ({ default: m.DecisionAccountabilityPage })))
import { FilesPage } from './FilesPage'
import { useSessionTracking } from '../hooks/useSessionTracking'
const ChartingPage = lazy(() => import('./ChartingPage').then(m => ({ default: m.ChartingPage })))
const SimulationPage = lazy(() => import('./SimulationPage').then(m => ({ default: m.SimulationPage })))
const TradeBookPage = lazy(() => import('./TradeBookPage').then(m => ({ default: m.TradeBookPage })))
import { AssetAllocationPage } from './AssetAllocationPage'
import { TDFListPage } from './TDFListPage'
import { TDFTab } from '../components/tabs/TDFTab'
import { UserTab } from '../components/tabs/UserTab'
import { TemplatesTab } from '../components/tabs/TemplatesTab'
const CalendarPage = lazy(() => import('./CalendarPage').then(m => ({ default: m.CalendarPage })))
import { PrioritizerPage } from './PrioritizerPage'
const CoveragePage = lazy(() => import('./CoveragePage').then(m => ({ default: m.CoveragePage })))
import { OrganizationPage } from './OrganizationPage'
import { AuditExplorerPage } from './AuditExplorerPage'
import { AdminConsolePage } from './AdminConsolePage'
import type { AttentionType } from '../types/attention'
import type { DashboardItem } from '../types/dashboard-item'
import { DashboardFilters } from '../components/dashboard/DashboardFilters'
import { DecisionSystem } from '../components/dashboard/DecisionSystem'
import { ResearchWorkbench } from '../components/dashboard/ResearchWorkbench'
import { PortfolioWorkbench } from '../components/dashboard/PortfolioWorkbench'
import { PortfolioGrid } from '../components/dashboard/PortfolioGrid'
import { useDashboardScope } from '../hooks/useDashboardScope'
import { useCockpitFeed } from '../hooks/useCockpitFeed'
import { useAuth } from '../hooks/useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { PilotWelcomeBanner } from '../components/dashboard/PilotWelcomeBanner'
import { FeedbackWidget } from '../components/feedback/FeedbackWidget'
import { useOnboarding } from '../hooks/useOnboarding'
import { SetupWizard } from '../components/onboarding/SetupWizard'
import { useToast } from '../components/common/Toast'

/** Clean loading state for asset tabs while data is being fetched */
function AssetLoadingState() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading asset...</p>
      </div>
    </div>
  )
}

// Helper to get initial tab state synchronously (avoids flash on refresh)
function getInitialTabState(userId?: string, orgId?: string): { tabs: Tab[]; activeTabId: string } {
  const savedState = TabStateManager.loadMainTabState(userId, orgId)
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
        isActive: tab.id === savedState.activeTabId,
        // Migrate old tab titles
        ...(tab.type === 'workflows' && tab.title !== 'Process' ? { title: 'Process' } : {}),
        ...(tab.type === 'priorities' && tab.title !== 'My Priorities' ? { title: 'My Priorities' } : {}),
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

export function DashboardPage() {
  // Auth & org
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  // Initialize state from org-scoped sessionStorage
  const [initialState] = useState(() => getInitialTabState(user?.id, currentOrgId ?? undefined))
  const [tabs, setTabs] = useState<Tab[]>(initialState.tabs)
  const [activeTabId, setActiveTabId] = useState(initialState.activeTabId)
  const [isInitialized, setIsInitialized] = useState(true)

  // Ref mirror of activeTabId — used inside handlers that are captured by
  // long-lived event listeners (registered with [] deps). Reading the ref
  // inside the handler avoids stale-closure bugs where the handler sees the
  // first render's activeTabId forever.
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  // Session tracking (heartbeat-based)
  useSessionTracking()

  // Reset tabs when org changes (switch org → load that org's saved tabs or default)
  const prevOrgRef = useRef(currentOrgId)
  useEffect(() => {
    if (currentOrgId && currentOrgId !== prevOrgRef.current) {
      prevOrgRef.current = currentOrgId
      const saved = TabStateManager.loadMainTabState(user?.id, currentOrgId)
      if (saved) {
        setTabs(saved.tabs as Tab[])
        setActiveTabId(saved.activeTabId)
      } else {
        const defaultTabs = [{ id: 'dashboard', title: 'Dashboard', type: 'dashboard', isActive: true }]
        setTabs(defaultTabs as Tab[])
        setActiveTabId('dashboard')
      }
    }
  }, [currentOrgId, user?.id])

  // Save tab state whenever tabs or activeTabId changes
  useEffect(() => {
    if (isInitialized && user?.id && currentOrgId) {
      const currentState = TabStateManager.loadMainTabState(user.id, currentOrgId)
      const existingTabStates = currentState?.tabStates || {}
      TabStateManager.saveMainTabState(tabs, activeTabId, existingTabStates, user.id, currentOrgId)
    }
  }, [tabs, activeTabId, isInitialized, user?.id, currentOrgId])

  // Onboarding: check if new user needs profile setup
  const { onboardingStatus, isLoading: onboardingLoading } = useOnboarding()
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const needsOnboarding = !onboardingLoading && !onboardingStatus?.wizard_completed && !onboardingDismissed

  const toast = useToast()

  // Listen for org auto-join event (dispatched from useAuth when domain routing auto-joins)
  useEffect(() => {
    const handler = (e: Event) => {
      const { orgName } = (e as CustomEvent).detail ?? {}
      if (orgName) toast.success('Joined organization', orgName)
    }
    window.addEventListener('org-auto-joined', handler)
    return () => window.removeEventListener('org-auto-joined', handler)
  }, [])

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

  // "New Trade Idea" modal — opened via decision-engine-action event from asset page
  const [tradeIdeaModal, setTradeIdeaModal] = useState<{ open: boolean; assetId?: string; portfolioId?: string }>({ open: false })

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
    // For asset type, if we don't have an ID but have a symbol, fetch the asset by symbol
    if (result.type === 'asset' && !result.data?.id && result.data?.symbol) {
      const { data: assetData, error } = await supabase
        .from('assets')
        .select('*')
        .eq('symbol', result.data.symbol)
        .single()

      if (!error && assetData) {
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

    // For portfolios, prefer mnemonic (portfolio_id) as tab title
    const tabTitle = result.type === 'portfolio' && result.data?.portfolio_id
      ? result.data.portfolio_id
      : result.title

    // All state reads happen inside the functional updater so this is safe
    // to call from stale-captured event listeners AND after async awaits.
    // The updater decides: activate existing tab, replace blank tab, or append new tab.
    let finalActiveId: string | null = null
    setTabs(prev => {
      const existingTab = prev.find(tab => {
        if (tab.id === result.id) return true
        if (result.type === 'asset' && result.data?.symbol && tab.data?.symbol === result.data.symbol) return true
        if (result.type === 'asset' && result.data?.symbol && tab.id === result.data.symbol) return true
        // Singleton tabs: only one allowed per type
        if (result.type === 'coverage' && tab.type === 'coverage') return true
        if (result.type === 'trade-lab' && tab.type === 'trade-lab') return true
        if (result.type === 'trade-queue' && tab.type === 'trade-queue') return true
        if (result.type === 'trade-book' && tab.type === 'trade-book') return true
        if (result.type === 'workflows' && tab.type === 'workflows') return true
        if (result.type === 'priorities' && tab.type === 'priorities') return true
        return false
      })

      if (existingTab) {
        finalActiveId = existingTab.id
        return prev.map(tab => ({
          ...tab,
          isActive: tab.id === existingTab.id,
          ...(tab.id === existingTab.id ? {
            title: result.title || tab.title,
            ...(result.data ? { data: { ...tab.data, ...result.data } } : {})
          } : {})
        }))
      }

      // Read latest activeTabId via ref (not closure) so this is safe under
      // stale-closure invocation and post-await races.
      const currentActiveId = activeTabIdRef.current
      const activeTab = prev.find(tab => tab.id === currentActiveId)

      // If we're in a blank tab, replace it instead of creating a new one
      if (activeTab?.isBlank) {
        finalActiveId = result.id
        return prev.map(tab =>
          tab.id === currentActiveId
            ? { id: result.id, title: tabTitle, type: result.type, data: result.data, isActive: true }
            : { ...tab, isActive: false }
        )
      }

      // Append new tab and switch to it
      finalActiveId = result.id
      return [
        ...prev.map(tab => ({ ...tab, isActive: false })),
        { id: result.id, title: tabTitle, type: result.type, data: result.data, isActive: true },
      ]
    })
    if (finalActiveId) setActiveTabId(finalActiveId)
  }

  // Keep navigate ref in sync with latest handleSearchResult
  navigateRef.current = handleSearchResult

  // Auto-enrich asset tabs that have only symbol/id but no full asset data.
  // This happens when navigating from Ideas feed, signals, etc.
  useEffect(() => {
    const assetTabsToEnrich = tabs.filter(
      t => t.type === 'asset' && t.data && !t.data.company_name && (t.data.symbol || t.id)
    )
    if (assetTabsToEnrich.length === 0) return

    for (const tab of assetTabsToEnrich) {
      const fetchAsset = async () => {
        const { data: asset } = await supabase
          .from('assets')
          .select('*')
          .eq('id', tab.id)
          .single()
        if (asset) {
          setTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, data: { ...t.data, ...asset }, title: asset.symbol || t.title } : t
          ))
        }
      }
      fetchAsset()
    }
  }, [tabs.map(t => t.id).join(',')])

  // Decision engine action dispatch → tab navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      // Intercept new-trade-idea to open the AddTradeIdeaModal
      if (detail.type === 'new-trade-idea') {
        setTradeIdeaModal({
          open: true,
          assetId: detail.data?.assetId,
          portfolioId: detail.data?.portfolioId,
        })
        return
      }
      navigateRef.current(detail)
    }
    window.addEventListener('decision-engine-action', handler)
    return () => window.removeEventListener('decision-engine-action', handler)
  }, [])

  const handleTabChange = (tabId: string) => {
    // If tab doesn't exist yet (e.g. synthetic parent from grouped tabs), create it directly
    const exists = tabs.some(tab => tab.id === tabId)
    if (!exists) {
      const parentTypes: Record<string, { type: Tab['type']; title: string }> = {
        'assets-list': { type: 'assets-list', title: 'Assets' },
        'portfolios-list': { type: 'portfolios-list', title: 'Portfolios' },
        'themes-list': { type: 'themes-list', title: 'Themes' },
        'notes-list': { type: 'notes-list', title: 'Notes' },
        'lists': { type: 'lists', title: 'Lists' },
        'projects-list': { type: 'projects-list', title: 'Projects' },
        'tdf-list': { type: 'tdf-list', title: 'TDFs' },
      }
      const info = parentTypes[tabId]
      if (info) {
        setTabs(prev => [
          ...prev.map(t => ({ ...t, isActive: false })),
          { id: tabId, title: info.title, type: info.type, isActive: true }
        ])
        setActiveTabId(tabId)
        return
      }
    }
    setTabs(currentTabs => currentTabs.map(tab => ({ ...tab, isActive: tab.id === tabId })))
    setActiveTabId(tabId)
  }

  const handleTabClose = (tabId: string) => {
    if (tabId === 'dashboard') return // Can't close dashboard tab

    // Clean up empty notes when closing a note tab
    const closingTab = tabs.find(t => t.id === tabId)
    if (closingTab?.type === 'note' && closingTab.data?.id && user) {
      const noteTableMap: Record<string, string> = {
        asset: 'asset_notes',
        portfolio: 'portfolio_notes',
        theme: 'theme_notes',
      }
      const entityType = closingTab.data.entityType || 'asset'
      const tableName = noteTableMap[entityType]
      if (tableName) {
        // Fire-and-forget: check if note is empty and soft-delete it
        supabase
          .from(tableName)
          .select('id, title, content')
          .eq('id', closingTab.data.id)
          .eq('created_by', user.id)
          .single()
          .then(({ data: note }) => {
            if (!note) return
            const titleEmpty = !note.title || note.title === 'Untitled'
            const contentEmpty = !note.content || !note.content.replace(/<[^>]*>/g, '').trim()
            if (titleEmpty && contentEmpty) {
              supabase
                .from(tableName)
                .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
                .eq('id', note.id)
                .then(() => {
                  queryClient.invalidateQueries({ queryKey: ['all-notes-with-users'] })
                  queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
                })
            }
          })
      }
    }

    // Remove the tab's stored state
    TabStateManager.removeTabState(tabId, user?.id, currentOrgId ?? undefined)

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

  const handleCloseTabs = (tabIds: string[]) => {
    const idsToClose = new Set(tabIds.filter(id => id !== 'dashboard'))
    if (idsToClose.size === 0) return

    // Per-tab cleanup (note cleanup, state removal)
    for (const tabId of idsToClose) {
      const closingTab = tabs.find(t => t.id === tabId)
      if (closingTab?.type === 'note' && closingTab.data?.id && user) {
        const noteTableMap: Record<string, string> = {
          asset: 'asset_notes',
          portfolio: 'portfolio_notes',
          theme: 'theme_notes',
        }
        const entityType = closingTab.data.entityType || 'asset'
        const tableName = noteTableMap[entityType]
        if (tableName) {
          supabase
            .from(tableName)
            .select('id, title, content')
            .eq('id', closingTab.data.id)
            .eq('created_by', user.id)
            .single()
            .then(({ data: note }) => {
              if (!note) return
              const titleEmpty = !note.title || note.title === 'Untitled'
              const contentEmpty = !note.content || !note.content.replace(/<[^>]*>/g, '').trim()
              if (titleEmpty && contentEmpty) {
                supabase
                  .from(tableName)
                  .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
                  .eq('id', note.id)
                  .then(() => {
                    queryClient.invalidateQueries({ queryKey: ['all-notes-with-users'] })
                    queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
                  })
              }
            })
        }
      }
      TabStateManager.removeTabState(tabId, user?.id, currentOrgId ?? undefined)
    }

    // Single state update to remove all tabs at once
    setTabs(currentTabs => {
      const newTabs = currentTabs.filter(tab => !idsToClose.has(tab.id))
      const activeStillExists = newTabs.some(tab => tab.id === activeTabId)
      if (!activeStillExists) {
        const fallback = newTabs.find(t => t.id === 'dashboard') || newTabs[0]
        if (fallback) {
          setActiveTabId(fallback.id)
          return newTabs.map(tab => ({ ...tab, isActive: tab.id === fallback.id }))
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
      // Navigate to trade-lab tab with the portfolio/lab ID
      // Always use "Trade Lab" as the tab title for consistency
      navigateRef.current({
        id: labId || 'trade-lab',
        title: 'Trade Lab',
        type: 'trade-lab',
        data: { id: labId, portfolioId }
      })
    }

    window.addEventListener('openTradeLab', handleOpenTradeLab as EventListener)
    return () => window.removeEventListener('openTradeLab', handleOpenTradeLab as EventListener)
  }, [])

  // Listen for custom event to open a portfolio tab
  useEffect(() => {
    const handleOpenPortfolio = (event: CustomEvent) => {
      const { id, name } = event.detail || {}
      if (!id) return
      navigateRef.current({
        id,
        title: name || 'Portfolio',
        type: 'portfolio',
        data: { id, name },
      })
    }
    window.addEventListener('open-portfolio', handleOpenPortfolio as EventListener)
    return () => window.removeEventListener('open-portfolio', handleOpenPortfolio as EventListener)
  }, [])

  // Listen for custom event to open a shared simulation
  useEffect(() => {
    const handleOpenSharedSimulation = (event: CustomEvent) => {
      const { share } = event.detail || {}
      if (!share) return
      navigateRef.current({
        id: `shared-${share.share_id}`,
        title: `Shared: ${share.name}`,
        type: 'trade-lab',
        data: { shareId: share.share_id }
      })
    }
    window.addEventListener('open-shared-simulation', handleOpenSharedSimulation as EventListener)
    return () => window.removeEventListener('open-shared-simulation', handleOpenSharedSimulation as EventListener)
  }, [])

  // Listen for custom event to open Ideas tab with filters (e.g., from "View all" in sidebar)
  useEffect(() => {
    const handleOpenIdeasTab = (event: CustomEvent) => {
      const { filters } = event.detail || {}
      // Navigate to idea-generator tab with initial filters
      navigateRef.current({
        id: 'idea-generator',
        title: 'Ideas',
        type: 'idea-generator',
        data: { initialFilters: filters }
      })
    }

    window.addEventListener('openIdeasTab', handleOpenIdeasTab as EventListener)
    return () => window.removeEventListener('openIdeasTab', handleOpenIdeasTab as EventListener)
  }, [])

  // Listen for custom event to navigate to an asset (e.g., from coverage matrix)
  useEffect(() => {
    const handleNavigateToAsset = (event: CustomEvent) => {
      navigateRef.current(event.detail)
    }
    window.addEventListener('navigate-to-asset', handleNavigateToAsset as EventListener)
    return () => window.removeEventListener('navigate-to-asset', handleNavigateToAsset as EventListener)
  }, [])

  // Listen for custom event to open Trade Queue (e.g., from toast action after creating trade idea)
  useEffect(() => {
    const handleOpenTradeQueue = (event: CustomEvent) => {
      const { selectedTradeId, openDecisionDrawer } = event.detail || {}

      navigateRef.current({
        id: 'trade-queue',
        title: 'Idea Pipeline',
        type: 'trade-queue',
        data: { selectedTradeId, openDecisionDrawer }
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
        return activeTab.data ? <AssetTab asset={activeTab.data} onNavigate={handleSearchResult} /> : <AssetLoadingState />
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
        return <WorkflowsPage onNavigate={handleSearchResult} />
      case 'projects-list':
        return <ProjectsPage onProjectSelect={handleSearchResult} />
      case 'project':
        return activeTab.data ? <ProjectDetailTab project={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading project...</div>
      case 'trade-queue':
        return <TradeQueuePage />
      case 'trade-lab':
        return <SimulationPage simulationId={activeTab.data?.id} tabId={activeTab.id} initialPortfolioId={activeTab.data?.portfolioId} shareId={activeTab.data?.shareId} />
      case 'trade-book':
        return <TradeBookPage initialPortfolioId={activeTab.data?.portfolioId} />
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
        // Use data.id for the selected note. Only fall back to activeTab.id if it looks like a UUID (not a synthetic tab ID like "notes-{assetId}")
        const rawNoteId = activeTab.data?.isNew ? undefined : activeTab.data?.id
        const noteId = rawNoteId || (activeTab.id && !activeTab.id.startsWith('notes-') && !activeTab.id.startsWith('research-') ? activeTab.id : undefined)

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
      case 'priorities':
        return <PrioritizerPage onItemSelect={handleSearchResult} />
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
        return <DecisionAccountabilityPage onItemSelect={handleSearchResult} />
      case 'files':
        return <FilesPage onItemSelect={handleSearchResult} />
      case 'charting':
        return <ChartingPage onItemSelect={handleSearchResult} initialSymbol={activeTab.data?.symbol} />
      case 'audit':
        return <AuditExplorerPage onNavigate={handleSearchResult} />
      case 'admin-console':
        return <AdminConsolePage />
      case 'user':
        return activeTab.data ? <UserTab user={activeTab.data} onNavigate={handleSearchResult} /> : <div>Loading user...</div>
      case 'templates':
        return <TemplatesTab />
      case 'workflow':
        // Individual workflow - navigate to workflows page focused on this workflow
        return <WorkflowsPage initialWorkflowId={activeTab.data?.id} initialBranchId={activeTab.data?.branchId} onNavigate={handleSearchResult} />
      case 'workflow-template':
        // Workflow template - navigate to workflows page to create from template
        return <WorkflowsPage initialTemplateId={activeTab.data?.id} onNavigate={handleSearchResult} />
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
        // Team - go to organization page with access view filtered by team
        return <OrganizationPage
          initialTab="access"
          initialAccessSubTab="manage"
          initialAccessFilter={{ teamNodeId: activeTab.data?.id }}
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
      title: 'My Priorities',
      type: 'priorities' as any,
      data: { filterType: type }
    })
  }

  const handleOpenTradeQueue = (filter?: string) => {
    handleSearchResult({
      id: 'trade-queue',
      title: 'Idea Pipeline',
      type: 'trade-queue',
      data: filter ? { stageFilter: filter } : undefined,
    })
  }

  // Row click → navigate to item's primary action
  const handleRowClick = useCallback((item: DashboardItem) => {
    item.primaryAction.onClick()
  }, [])

  const renderDashboardContent = () => {
    return (
      <div className="h-full overflow-auto">
        <div className="p-3 space-y-2.5">
          {/* Pilot welcome banner */}
          <PilotWelcomeBanner onNavigate={handleSearchResult} />

          {/* Filters */}
          <DashboardFilters
            scope={scope}
            onScopeChange={setScope}
            portfolios={portfolios}
          />

          {/* MODE: DECISION */}
          {scope.mode === 'decision' && (
            <DecisionSystem
              id="band-DECIDE"
              viewModel={cockpit.viewModel}
              pipelineStats={cockpit.pipelineStats}
              isLoading={cockpit.isLoading}
              onItemClick={handleRowClick}
              onSnooze={cockpit.snooze}
              onOpenTradeQueue={handleOpenTradeQueue}
            />
          )}

          {/* MODE: RESEARCH */}
          {scope.mode === 'research' && (
            <ResearchWorkbench
              viewModel={cockpit.viewModel}
              onItemClick={handleRowClick}
            />
          )}

          {/* MODE: PORTFOLIO */}
          {scope.mode === 'portfolio' && (
            <>
              {scope.portfolioIds.length === 1 && (
                <PortfolioWorkbench
                  portfolioId={scope.portfolioIds[0]}
                  portfolioName={portfolios.find(p => p.id === scope.portfolioIds[0])?.name ?? 'Portfolio'}
                  viewModel={cockpit.viewModel}
                  onItemClick={handleRowClick}
                  onNavigate={handleSearchResult}
                />
              )}

              {scope.portfolioIds.length !== 1 && (
                <>
                  <PortfolioGrid
                    portfolios={portfolios}
                    viewModel={cockpit.viewModel}
                    onSelectPortfolio={(id) => setScope({ ...scope, portfolioIds: [id] })}
                  />

                  <PortfolioWorkbench
                    portfolioIds={scope.portfolioIds.length > 0 ? scope.portfolioIds : portfolios.map(p => p.id)}
                    portfolioName={scope.portfolioIds.length > 0 ? `${scope.portfolioIds.length} portfolios` : 'All Portfolios'}
                    viewModel={cockpit.viewModel}
                    onItemClick={handleRowClick}
                    onNavigate={handleSearchResult}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
    {/* Onboarding wizard for new users */}
    {needsOnboarding && (
      <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center">
        <div className="w-full max-w-3xl h-[90vh] overflow-hidden bg-white dark:bg-gray-800 rounded-2xl shadow-2xl">
          <SetupWizard
            onComplete={() => setOnboardingDismissed(true)}
            onSkip={() => setOnboardingDismissed(true)}
            isModal
          />
        </div>
      </div>
    )}
    <Layout
      tabs={tabs}
      activeTabId={activeTabId}
      onTabReorder={handleTabReorder}
      onTabsReorder={handleTabsReorder}
      onTabChange={handleTabChange}
      onTabClose={handleTabClose}
      onCloseTabs={handleCloseTabs}
      onNewTab={handleNewTab}
      onSearchResult={handleSearchResult}
      onFocusSearch={handleFocusSearch}
    >
      <>
        <Suspense fallback={<AssetLoadingState />}>
          {renderTabContent()}
        </Suspense>

        {/* New Trade Idea modal — shared across all tabs via decision-engine-action event */}
        <AddTradeIdeaModal
          isOpen={tradeIdeaModal.open}
          onClose={() => setTradeIdeaModal({ open: false })}
          onSuccess={() => {
            setTradeIdeaModal({ open: false })
            queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
          }}
          preselectedAssetId={tradeIdeaModal.assetId}
          preselectedPortfolioId={tradeIdeaModal.portfolioId}
        />
      </>
    </Layout>
    <FeedbackWidget />
    </>
  )
}
