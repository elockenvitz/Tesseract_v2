import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { arrayMove } from '@dnd-kit/sortable'
import { TrendingUp, Target, FileText, ArrowUpRight, ArrowDownRight, Activity, Users, Lightbulb, Briefcase, Tag, List, Workflow, Star, Clock, Orbit, FolderKanban, ListTodo, Beaker, PieChart, Calendar, AlertTriangle, CheckCircle2, Play, ChevronRight, ChevronLeft, ChevronDown, Plus, Zap, ArrowRight, MessageSquareText, FolderOpen } from 'lucide-react'
import { PriorityBadge } from '../components/ui/PriorityBadge'
import { financialDataService } from '../lib/financial-data/browser-client'
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
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { NoDataAvailable } from '../components/common/EmptyState'
import { formatDistanceToNow, differenceInDays, startOfDay, parseISO } from 'date-fns'
import { ProfilePage } from './ProfilePage'
import { SettingsPage } from './SettingsPage'
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
import { PrioritizerPage } from './PrioritizerPage'
import { CoveragePage } from './CoveragePage'
import { OrganizationPage } from './OrganizationPage'
import { AttentionPage } from './AttentionPage'
import { ThoughtsFeed } from '../components/thoughts'
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

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      console.log('🔍 Fetching assets from database...')
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(5)
      
      if (error) {
        console.error('❌ Failed to fetch assets:', error)
        throw error
      }

      console.log('✅ Assets fetched:', data?.length || 0, 'records')
      console.log('🔍 First asset keys:', data && data.length > 0 ? Object.keys(data[0]) : 'no data')
      console.log('🔍 First asset:', data && data.length > 0 ? data[0] : 'no data')
      return data
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true, // Refetch when window regains focus
  })

  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: ['recent-notes'],
    queryFn: async () => {
      // Get notes from all types using junction tables
      const [assetNotes, portfolioNotes, themeNotes, customNotes] = await Promise.all([
        supabase
          .from('asset_notes')
          .select(`
            *,
            assets (
              id,
              symbol,
              company_name,
              sector,
              thesis,
              where_different,
              risks_to_thesis,
              priority,
              process_stage,
              created_at,
              updated_at
            )
          `)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(10),
        supabase
          .from('portfolio_notes')
          .select(`
            *,
            portfolios (
              id,
              name,
              description,
              portfolio_type,
              created_at,
              updated_at
            )
          `)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(10),
        supabase
          .from('theme_notes')
          .select(`
            *,
            themes (
              id,
              name,
              description,
              theme_type,
              color,
              where_different,
              risks_to_thesis,
              created_at,
              updated_at
            )
          `)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(10),
        supabase
          .from('custom_notebook_notes')
          .select('*, custom_notebooks(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(10)
      ])
      
      // Combine and sort all notes
      const allNotes = [
        ...(assetNotes.data || []).map(note => ({ 
          ...note, 
          type: 'asset',
          assets: note.assets
        })),
        ...(portfolioNotes.data || []).map(note => ({ 
          ...note, 
          type: 'portfolio',
          portfolios: note.portfolios
        })),
        ...(themeNotes.data || []).map(note => ({ 
          ...note, 
          type: 'theme',
          themes: note.themes
        })),
        ...(customNotes.data || []).map(note => ({ 
          ...note, 
          type: 'custom',
          custom_notebooks: note.custom_notebooks
        }))
      ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5)
      
      return allNotes
    },
  })

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [assetsCount, notesCount, priceTargetsCount] = await Promise.all([
        supabase.from('assets').select('*', { count: 'exact', head: true }),
        Promise.all([
          supabase.from('asset_notes').select('*', { count: 'exact', head: true }).neq('is_deleted', true),
          supabase.from('portfolio_notes').select('*', { count: 'exact', head: true }).neq('is_deleted', true),
          supabase.from('theme_notes').select('*', { count: 'exact', head: true }).neq('is_deleted', true),
          supabase.from('custom_notebook_notes').select('*', { count: 'exact', head: true }).neq('is_deleted', true)
        ]).then(([asset, portfolio, theme, custom]) => ({
          count: (asset.count || 0) + (portfolio.count || 0) + (theme.count || 0) + (custom.count || 0)
        })),
        supabase.from('price_targets').select('*', { count: 'exact', head: true }),
      ])

      return {
        assets: assetsCount.count || 0,
        notes: notesCount.count || 0,
        priceTargets: priceTargetsCount.count || 0,
      }
    },
  })

  // Fetch workflows for the workflow map
  const { data: workflows, isLoading: workflowsLoading } = useQuery({
    queryKey: ['dashboard-workflows'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return []

      // Helper function to get workflow IDs shared with the user
      const getSharedWorkflowIds = async (userId: string | undefined) => {
        if (!userId) return []

        const { data, error } = await supabase
          .from('workflow_collaborations')
          .select('workflow_id')
          .eq('user_id', userId)

        if (error) return []

        return data.map(collab => collab.workflow_id)
      }

      // Get workflows the user owns, public workflows, or workflows shared with them
      const sharedIds = await getSharedWorkflowIds(userId)

      let query = supabase
        .from('workflows')
        .select('*')

      if (sharedIds.length > 0) {
        query = query.or(`is_public.eq.true,created_by.eq.${userId},id.in.(${sharedIds.join(',')})`)
      } else {
        query = query.or(`is_public.eq.true,created_by.eq.${userId}`)
      }

      const { data: workflows, error } = await query
        .order('name')

      if (error) throw error

      // Get usage stats for each workflow
      const workflowIds = (workflows || []).map(w => w.id)

      if (workflowIds.length === 0) return []

      const { data: usageStats, error: usageError } = await supabase
        .from('asset_workflow_progress')
        .select('workflow_id, is_started, is_completed')
        .in('workflow_id', workflowIds)

      if (usageError) {
        console.error('Error fetching usage stats:', usageError)
      }

      // Calculate stats for each workflow
      const workflowsWithStats = (workflows || []).map(workflow => {
        const workflowUsage = (usageStats || []).filter(stat => stat.workflow_id === workflow.id)
        const activeAssets = workflowUsage.filter(stat => stat.is_started && !stat.is_completed).length
        const completedAssets = workflowUsage.filter(stat => stat.is_completed).length
        const totalAssets = workflowUsage.length

        return {
          ...workflow,
          usage_count: totalAssets,
          active_assets: activeAssets,
          completed_assets: completedAssets
        }
      })

      return workflowsWithStats
    }
  })

  // Fetch financial data for assets
  const { data: financialData, isLoading: financialDataLoading } = useQuery({
    queryKey: ['dashboard-financial-data', assets?.map(a => a.symbol)],
    queryFn: async () => {
      if (!assets || assets.length === 0) return {}

      // Fetch quotes for all assets in parallel for better performance
      const quotes: Record<string, any> = {}

      // Create parallel promises for all assets
      const fetchPromises = assets
        .filter(asset => asset.symbol)
        .map(async (asset, index) => {
          try {
            console.log(`Dashboard: Fetching quote for ${asset.symbol} (${index + 1}/${assets.length})`)
            const quote = await financialDataService.getQuote(asset.symbol)
            if (quote) {
              console.log(`Dashboard: Successfully got quote for ${asset.symbol}: $${quote.price}`)
              return { symbol: asset.symbol, quote }
            } else {
              console.warn(`Dashboard: No quote returned for ${asset.symbol}`)
              return null
            }
          } catch (error) {
            console.warn(`Dashboard: Failed to fetch quote for ${asset.symbol}:`, error)
            return null
          }
        })

      // Wait for all requests to complete
      const results = await Promise.all(fetchPromises)

      // Build the quotes object
      results.forEach(result => {
        if (result && result.quote) {
          quotes[result.symbol] = result.quote
        }
      })

      return quotes
    },
    enabled: !!assets && assets.length > 0,
    staleTime: 15000, // Cache for 15 seconds (shorter for more real-time feel)
    refetchInterval: 30000, // Refetch every 30 seconds for live updates
  })

  // Fetch urgent tasks and deadlines for Today's Focus
  const { data: urgentItems } = useQuery({
    queryKey: ['dashboard-urgent-items'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return { projects: [], deliverables: [], calendarEvents: [] }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const endOfWeek = new Date(today)
      endOfWeek.setDate(endOfWeek.getDate() + 7)

      // Fetch urgent/overdue projects
      const { data: projects } = await supabase
        .from('projects')
        .select(`
          *,
          creator:users!created_by(id, email, first_name, last_name),
          project_assignments!inner(assigned_to, role)
        `)
        .eq('project_assignments.assigned_to', userId)
        .in('status', ['planning', 'in_progress', 'blocked'])
        .or(`priority.eq.urgent,priority.eq.high,due_date.lte.${endOfWeek.toISOString()}`)
        .order('due_date', { ascending: true })
        .limit(10)

      // Fetch incomplete deliverables for user's projects
      const { data: deliverables } = await supabase
        .from('project_deliverables')
        .select(`
          *,
          projects!inner(
            id,
            title,
            status,
            created_by,
            priority,
            due_date,
            creator:users!created_by(id, email, first_name, last_name),
            project_assignments!inner(assigned_to, role),
            project_deliverables(id, title, completed, due_date)
          )
        `)
        .eq('projects.project_assignments.assigned_to', userId)
        .eq('completed', false)
        .order('created_at', { ascending: false })
        .limit(10)

      // Fetch upcoming calendar events
      const { data: calendarEvents } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('created_by', userId)
        .gte('start_date', today.toISOString())
        .lte('start_date', endOfWeek.toISOString())
        .in('event_type', ['deadline', 'meeting', 'deliverable', 'earnings_call', 'conference'])
        .order('start_date', { ascending: true })
        .limit(10)

      return {
        projects: projects || [],
        deliverables: deliverables || [],
        calendarEvents: calendarEvents || []
      }
    }
  })

  // Fetch my active tasks across workflows
  const { data: myTasks } = useQuery({
    queryKey: ['dashboard-my-tasks'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return []

      // Get assets assigned to user in active workflow stages
      // Note: workflow_stages is joined via workflow_id + current_stage_key, not a direct FK
      const { data: workflowProgress } = await supabase
        .from('asset_workflow_progress')
        .select(`
          *,
          assets!inner(id, symbol, company_name, priority, process_stage),
          workflows!inner(id, name)
        `)
        .eq('is_started', true)
        .eq('is_completed', false)
        .order('started_at', { ascending: false })
        .limit(15)

      return workflowProgress || []
    }
  })

  // Fetch team activity
  // Note: project_activity table doesn't exist yet - returning empty array
  const { data: teamActivity } = useQuery({
    queryKey: ['dashboard-team-activity'],
    queryFn: async () => {
      // TODO: Create project_activity table or use notifications/asset_field_history
      return []
    }
  })

  // Tab state is now initialized synchronously in useState initializers
  // No useEffect needed for restoring tabs - this prevents flash on refresh

  // Save tab state whenever tabs or activeTabId changes (but only after initialization)
  useEffect(() => {
    if (isInitialized) {
      // Preserve existing tabStates when saving main state
      const currentState = TabStateManager.loadMainTabState()
      const existingTabStates = currentState?.tabStates || {}
      TabStateManager.saveMainTabState(tabs, activeTabId, existingTabStates)
    }
  }, [tabs, activeTabId, isInitialized])


  const getStageColor = (stage: string | null) => {
    switch (stage) {
      case 'research': return 'primary'
      case 'analysis': return 'warning'
      case 'monitoring': return 'success'
      case 'review': return 'default'
      case 'archived': return 'default'
      default: return 'default'
    }
  }

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
        return <PrioritizerPage onItemSelect={handleSearchResult} />
      case 'attention':
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

  // Helper functions for dashboard
  const getUrgencyColor = (dueDate: string | null, priority?: string) => {
    if (!dueDate) return priority === 'urgent' ? 'error' : priority === 'high' ? 'warning' : 'default'
    const today = startOfDay(new Date())
    const due = startOfDay(parseISO(dueDate))
    const diffDays = differenceInDays(due, today)
    if (diffDays < 0) return 'error' // Overdue
    if (diffDays === 0) return 'error' // Due today
    if (diffDays <= 2) return 'warning' // Due soon
    return 'primary'
  }

  const formatDueDate = (dueDate: string | null) => {
    if (!dueDate) return null
    const today = startOfDay(new Date())
    const due = startOfDay(parseISO(dueDate))
    const diffDays = differenceInDays(due, today)
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
    if (diffDays === 0) return 'Due today'
    if (diffDays === 1) return 'Due tomorrow'
    if (diffDays <= 7) return `Due in ${diffDays}d`
    return formatDistanceToNow(due, { addSuffix: true })
  }

  // Dropdown menu states
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showTradeMenu, setShowTradeMenu] = useState(false)
  const [showResearchMenu, setShowResearchMenu] = useState(false)
  const [showEfficiencyMenu, setShowEfficiencyMenu] = useState(false)

  const renderDashboardContent = () => {
    return (
      <div className="h-full overflow-auto">
      <div className="space-y-6 p-1">
        {/* Quick Actions Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* New Button with Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowNewMenu(!showNewMenu)}
              className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">New</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showNewMenu ? 'rotate-180' : ''}`} />
            </button>

            {showNewMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowNewMenu(false)}
                />
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] z-20">
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'projects-list', title: 'All Projects', type: 'projects-list', data: { createNew: true } })
                      setShowNewMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <FolderKanban className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium text-gray-700">Project</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'notes-list', title: 'Notes', type: 'notes-list', data: { createNew: true } })
                      setShowNewMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <FileText className="h-4 w-4 text-indigo-500" />
                    <span className="text-sm font-medium text-gray-700">Note</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'workflows', title: 'Workflows', type: 'workflows', data: { createNew: true } })
                      setShowNewMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Orbit className="h-4 w-4 text-indigo-500" />
                    <span className="text-sm font-medium text-gray-700">Workflow</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'lists', title: 'Lists', type: 'lists', data: { createNew: true } })
                      setShowNewMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <List className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">List</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'themes-list', title: 'Themes', type: 'themes-list', data: { createNew: true } })
                      setShowNewMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Tag className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium text-gray-700">Theme</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'trade-lab', title: 'Trade Lab', type: 'trade-lab', data: { createNew: true } })
                      setShowNewMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Beaker className="h-4 w-4 text-cyan-500" />
                    <span className="text-sm font-medium text-gray-700">Trade Lab</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300 mx-1" />

          {/* Calendar - standalone button */}
          <button
            onClick={() => handleSearchResult({ id: 'calendar', title: 'Calendar', type: 'calendar', data: null })}
            className="flex items-center space-x-2 px-3 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors"
          >
            <Calendar className="h-4 w-4" />
            <span className="text-sm font-medium">Calendar</span>
          </button>

          {/* Efficiency Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowEfficiencyMenu(!showEfficiencyMenu)
                setShowTradeMenu(false)
                setShowResearchMenu(false)
              }}
              className="flex items-center space-x-2 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Zap className="h-4 w-4" />
              <span className="text-sm font-medium">Efficiency</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showEfficiencyMenu ? 'rotate-180' : ''}`} />
            </button>

            {showEfficiencyMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowEfficiencyMenu(false)}
                />
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] z-20">
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'projects-list', title: 'All Projects', type: 'projects-list', data: null })
                      setShowEfficiencyMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <FolderKanban className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium text-gray-700">Projects</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'workflows', title: 'Workflows', type: 'workflows', data: null })
                      setShowEfficiencyMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Orbit className="h-4 w-4 text-indigo-500" />
                    <span className="text-sm font-medium text-gray-700">Workflows</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'prioritizer', title: 'Prioritizer', type: 'prioritizer', data: null })
                      setShowEfficiencyMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <ListTodo className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium text-gray-700">Prioritizer</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'files', title: 'Files', type: 'files', data: null })
                      setShowEfficiencyMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <FolderOpen className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium text-gray-700">Files</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Research Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowResearchMenu(!showResearchMenu)
                setShowTradeMenu(false)
                setShowEfficiencyMenu(false)
              }}
              className="flex items-center space-x-2 px-3 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              <FileText className="h-4 w-4" />
              <span className="text-sm font-medium">Research</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showResearchMenu ? 'rotate-180' : ''}`} />
            </button>

            {showResearchMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowResearchMenu(false)}
                />
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] z-20">
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'assets-list', title: 'Assets', type: 'assets-list', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium text-gray-700">Assets</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'portfolios-list', title: 'Portfolios', type: 'portfolios-list', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Briefcase className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-gray-700">Portfolios</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'themes-list', title: 'Themes', type: 'themes-list', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Tag className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium text-gray-700">Themes</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'notes-list', title: 'Notes', type: 'notes-list', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <FileText className="h-4 w-4 text-indigo-500" />
                    <span className="text-sm font-medium text-gray-700">Notes</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'lists', title: 'Lists', type: 'lists', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <List className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Lists</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'tdf-list', title: 'TDF', type: 'tdf-list', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Clock className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium text-gray-700">TDF</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'charting', title: 'Charting', type: 'charting', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Activity className="h-4 w-4 text-cyan-500" />
                    <span className="text-sm font-medium text-gray-700">Charting</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'asset-allocation', title: 'Asset Allocation', type: 'asset-allocation', data: null })
                      setShowResearchMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <PieChart className="h-4 w-4 text-teal-500" />
                    <span className="text-sm font-medium text-gray-700">Asset Allocation</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Trade Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowTradeMenu(!showTradeMenu)
                setShowResearchMenu(false)
                setShowEfficiencyMenu(false)
              }}
              className="flex items-center space-x-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">Trade</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showTradeMenu ? 'rotate-180' : ''}`} />
            </button>

            {showTradeMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowTradeMenu(false)}
                />
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] z-20">
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'idea-generator', title: 'Ideas', type: 'idea-generator', data: null })
                      setShowTradeMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Lightbulb className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium text-gray-700">Ideas</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'trade-queue', title: 'Trade Queue', type: 'trade-queue', data: null })
                      setShowTradeMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <List className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium text-gray-700">Trade Queue</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'trade-lab', title: 'Trade Lab', type: 'trade-lab', data: null })
                      setShowTradeMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Beaker className="h-4 w-4 text-cyan-500" />
                    <span className="text-sm font-medium text-gray-700">Trade Lab</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSearchResult({ id: 'outcomes', title: 'Outcomes', type: 'outcomes', data: null })
                      setShowTradeMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Target className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium text-gray-700">Outcomes</span>
                  </button>
                </div>
              </>
            )}
          </div>

        </div>

        {/* Attention Dashboard - 10-Minute Screen */}
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
            // Navigate to the Priorities page filtered by type
            handleSearchResult({
              id: 'attention',
              title: 'All Priorities',
              type: 'attention' as any,
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
