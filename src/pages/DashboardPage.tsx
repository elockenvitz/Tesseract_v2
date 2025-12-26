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
import { NotebookTab } from '../components/tabs/NotebookTab'
import { ThemeTab } from '../components/tabs/ThemeTab'
import { PortfolioTab } from '../components/tabs/PortfolioTab'
import { ListTab } from '../components/tabs/ListTab'
import { BlankTab } from '../components/tabs/BlankTab.tsx'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { NoDataAvailable } from '../components/common/EmptyState'
import { formatDistanceToNow } from 'date-fns'
import { ProfilePage } from './ProfilePage'
import { SettingsPage } from './SettingsPage'
import { IdeaGeneratorPage} from './IdeaGeneratorPage'
import { WorkflowsPage } from './WorkflowsPage'
import { ProjectsPage } from './ProjectsPage'
import { ProjectDetailTab } from '../components/tabs/ProjectDetailTab'
// Project widgets removed - content now in Command Center carousel
import { TradeQueuePage } from './TradeQueuePage'
import { ReasonsPage } from './ReasonsPage'
import { FilesPage } from './FilesPage'
import { ChartingPage } from './ChartingPage'
import { SimulationPage } from './SimulationPage'
import { AssetAllocationPage } from './AssetAllocationPage'
import { TDFListPage } from './TDFListPage'
import { TDFTab } from '../components/tabs/TDFTab'
import { CalendarPage } from './CalendarPage'
import { PrioritizerPage } from './PrioritizerPage'
import { CoveragePage } from './CoveragePage'
import { OrganizationPage } from './OrganizationPage'
import { ThoughtsFeed } from '../components/thoughts'
import { ContentSection } from '../components/dashboard/ContentSection'

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
            project_assignments!inner(assigned_to)
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

    const tabIndex = tabs.findIndex(tab => tab.id === tabId)
    const newTabs = tabs.filter(tab => tab.id !== tabId)

    // Remove the tab's stored state
    TabStateManager.removeTabState(tabId)

    // If closing active tab, switch to dashboard or previous tab
    if (activeTabId === tabId) {
      const newActiveTab = newTabs.length > 0 ? newTabs[Math.max(0, tabIndex - 1)] : newTabs[0]
      if (newActiveTab) {
        setActiveTabId(newActiveTab.id)
        setTabs(newTabs.map(tab => ({ ...tab, isActive: tab.id === newActiveTab.id })))
      }
    } else {
      setTabs(newTabs)
    }
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
      case 'note':
        return <NotebookTab notebook={activeTab.data} />
      case 'theme':
        return <ThemeTab theme={activeTab.data} />
      case 'portfolio':
        return <PortfolioTab portfolio={activeTab.data} onNavigate={handleSearchResult} />
      case 'calendar':
        return <CalendarPage onItemSelect={handleSearchResult} />
      case 'prioritizer':
        return <PrioritizerPage onItemSelect={handleSearchResult} />
      case 'coverage':
        return <CoveragePage initialView={activeTab.data?.initialView} />
      case 'organization':
        return <OrganizationPage />
      case 'reasons':
        return <ReasonsPage onItemSelect={handleSearchResult} />
      case 'files':
        return <FilesPage onItemSelect={handleSearchResult} />
      case 'charting':
        return <ChartingPage onItemSelect={handleSearchResult} />
      default:
        return renderDashboardContent()
    }
  }

  // Helper functions for dashboard
  const getUrgencyColor = (dueDate: string | null, priority?: string) => {
    if (!dueDate) return priority === 'urgent' ? 'error' : priority === 'high' ? 'warning' : 'default'
    const now = new Date()
    const due = new Date(dueDate)
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return 'error' // Overdue
    if (diffDays === 0) return 'error' // Due today
    if (diffDays <= 2) return 'warning' // Due soon
    return 'primary'
  }

  const formatDueDate = (dueDate: string | null) => {
    if (!dueDate) return null
    const now = new Date()
    const due = new Date(dueDate)
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
    if (diffDays === 0) return 'Due today'
    if (diffDays === 1) return 'Due tomorrow'
    if (diffDays <= 7) return `Due in ${diffDays}d`
    return formatDistanceToNow(due, { addSuffix: true })
  }

  // Carousel state for Command Center
  const [focusTab, setFocusTab] = useState<'urgent' | 'tasks' | 'projects' | 'deliverables' | 'deadlines' | 'activity' | 'workflows'>('urgent')

  // Dropdown menu states
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showTradeMenu, setShowTradeMenu] = useState(false)
  const [showResearchMenu, setShowResearchMenu] = useState(false)
  const [showEfficiencyMenu, setShowEfficiencyMenu] = useState(false)

  const renderDashboardContent = () => {
    // Combine urgent items for Today's Focus
    const allUrgentItems = [
      ...(urgentItems?.projects || []).map((p: any) => ({ ...p, itemType: 'project' })),
      ...(urgentItems?.deliverables || []).map((d: any) => ({ ...d, itemType: 'deliverable' })),
      ...(urgentItems?.calendarEvents || []).map((e: any) => ({ ...e, itemType: 'event' }))
    ].sort((a, b) => {
      const dateA = a.due_date || a.start_date || ''
      const dateB = b.due_date || b.start_date || ''
      return new Date(dateA).getTime() - new Date(dateB).getTime()
    }).slice(0, 8)

    // Tab configuration for the Command Center
    const focusTabs = [
      { id: 'urgent' as const, label: 'Urgent', icon: AlertTriangle, color: 'amber', count: allUrgentItems.filter(i => getUrgencyColor(i.due_date || i.start_date, i.priority) === 'error').length, viewAllType: 'prioritizer' as const, viewAllTitle: 'Prioritizer' },
      { id: 'tasks' as const, label: 'Tasks', icon: Play, color: 'blue', count: myTasks?.length || 0, viewAllType: 'workflows' as const, viewAllTitle: 'Workflows' },
      { id: 'projects' as const, label: 'Projects', icon: FolderKanban, color: 'violet', count: urgentItems?.projects?.length || 0, viewAllType: 'projects-list' as const, viewAllTitle: 'Projects' },
      { id: 'deliverables' as const, label: 'Deliverables', icon: Target, color: 'purple', count: urgentItems?.deliverables?.length || 0, viewAllType: 'projects-list' as const, viewAllTitle: 'Projects' },
      { id: 'deadlines' as const, label: 'Deadlines', icon: Clock, color: 'red', count: urgentItems?.calendarEvents?.length || 0, viewAllType: 'calendar' as const, viewAllTitle: 'Calendar' },
      { id: 'activity' as const, label: 'Activity', icon: Activity, color: 'green', count: teamActivity?.length || 0, viewAllType: 'projects-list' as const, viewAllTitle: 'Projects' },
      { id: 'workflows' as const, label: 'Workflows', icon: Orbit, color: 'indigo', count: workflows?.filter(wf => wf.active_assets > 0).length || 0, viewAllType: 'workflows' as const, viewAllTitle: 'Workflows' },
    ]

    // Get current tab for View All link
    const currentTab = focusTabs.find(t => t.id === focusTab)

    const renderFocusContent = () => {
      switch (focusTab) {
        case 'urgent':
          return allUrgentItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {allUrgentItems.map((item: any, index: number) => {
                const urgency = getUrgencyColor(item.due_date || item.start_date, item.priority)
                const dueLabel = formatDueDate(item.due_date || item.start_date)
                return (
                  <div
                    key={`${item.itemType}-${item.id}-${index}`}
                    onClick={() => {
                      if (item.itemType === 'project') {
                        handleSearchResult({ id: item.id, title: item.title, type: 'project', data: item })
                      } else if (item.itemType === 'deliverable') {
                        handleSearchResult({ id: item.projects?.id, title: item.projects?.title, type: 'project', data: item.projects })
                      } else {
                        handleSearchResult({ id: 'calendar', title: 'Calendar', type: 'calendar', data: null })
                      }
                    }}
                    className={`p-3 rounded-lg cursor-pointer transition-all hover:shadow-md ${
                      urgency === 'error' ? 'bg-red-50 border border-red-200 hover:border-red-300' :
                      urgency === 'warning' ? 'bg-amber-50 border border-amber-200 hover:border-amber-300' :
                      'bg-gray-50 border border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className={`p-1.5 rounded ${
                        item.itemType === 'project' ? 'bg-violet-100' :
                        item.itemType === 'deliverable' ? 'bg-blue-100' : 'bg-green-100'
                      }`}>
                        {item.itemType === 'project' ? <FolderKanban className="h-3.5 w-3.5 text-violet-600" /> :
                         item.itemType === 'deliverable' ? <Target className="h-3.5 w-3.5 text-blue-600" /> :
                         <Calendar className="h-3.5 w-3.5 text-green-600" />}
                      </div>
                      {dueLabel && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          urgency === 'error' ? 'bg-red-100 text-red-700' :
                          urgency === 'warning' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {dueLabel}
                        </span>
                      )}
                    </div>
                    <h4 className="font-medium text-gray-900 text-sm line-clamp-2">
                      {item.title || item.name}
                    </h4>
                    {item.itemType === 'deliverable' && item.projects?.title && (
                      <p className="text-xs text-gray-500 mt-1 truncate">{item.projects.title}</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-300" />
              <p className="font-medium">You're all caught up!</p>
              <p className="text-sm">No urgent items requiring immediate attention</p>
            </div>
          )

        case 'tasks':
          return myTasks && myTasks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {myTasks.slice(0, 8).map((task: any) => (
                <div
                  key={task.id}
                  onClick={() => handleSearchResult({
                    id: task.assets?.id,
                    title: task.assets?.symbol,
                    type: 'asset',
                    data: { ...task.assets, workflow_id: task.workflow_id }
                  })}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors group"
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <div className="w-8 h-8 bg-primary-100 rounded flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="h-4 w-4 text-primary-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-gray-900">{task.assets?.symbol}</span>
                        <PriorityBadge priority={task.assets?.priority} />
                      </div>
                      <p className="text-xs text-gray-500 truncate">{task.assets?.company_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <Badge variant="outline" size="sm">{task.workflow_stages?.name}</Badge>
                      <p className="text-xs text-gray-400 mt-1">{task.workflows?.name}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Play className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No active tasks</p>
              <p className="text-sm">Start a workflow to see tasks here</p>
            </div>
          )

        case 'deliverables':
          const deliverableItems = (urgentItems?.deliverables || []).sort((a: any, b: any) => {
            const dateA = a.due_date || ''
            const dateB = b.due_date || ''
            return new Date(dateA).getTime() - new Date(dateB).getTime()
          })

          return deliverableItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {deliverableItems.slice(0, 8).map((item: any, index: number) => {
                const dueLabel = formatDueDate(item.due_date)
                const urgency = getUrgencyColor(item.due_date)
                return (
                  <div
                    key={`deliverable-${item.id}-${index}`}
                    onClick={() => {
                      if (item.projects) {
                        handleSearchResult({ id: item.projects.id, title: item.projects.title, type: 'project', data: item.projects })
                      }
                    }}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${
                        item.completed ? 'bg-green-100' :
                        urgency === 'error' ? 'bg-red-100' : urgency === 'warning' ? 'bg-amber-100' : 'bg-violet-100'
                      }`}>
                        {item.completed ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <Target className={`h-4 w-4 ${
                            urgency === 'error' ? 'text-red-600' : urgency === 'warning' ? 'text-amber-600' : 'text-violet-600'
                          }`} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm truncate">{item.title || item.name}</p>
                        {item.projects?.title && (
                          <p className="text-xs text-gray-500 truncate">{item.projects.title}</p>
                        )}
                      </div>
                    </div>
                    {dueLabel && !item.completed && (
                      <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ml-2 ${
                        urgency === 'error' ? 'bg-red-100 text-red-700' :
                        urgency === 'warning' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {dueLabel}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Target className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No deliverables</p>
              <p className="text-sm">Create deliverables in your projects</p>
            </div>
          )

        case 'projects':
          const projectItems = (urgentItems?.projects || []).sort((a: any, b: any) => {
            const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
            const priorityDiff = (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3)
            if (priorityDiff !== 0) return priorityDiff
            const dateA = a.due_date || ''
            const dateB = b.due_date || ''
            return new Date(dateA).getTime() - new Date(dateB).getTime()
          })

          return projectItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {projectItems.slice(0, 8).map((project: any, index: number) => {
                const dueLabel = formatDueDate(project.due_date)
                const urgency = getUrgencyColor(project.due_date, project.priority)
                const statusColors: Record<string, string> = {
                  planning: 'bg-blue-100 text-blue-700',
                  in_progress: 'bg-green-100 text-green-700',
                  blocked: 'bg-red-100 text-red-700',
                  on_hold: 'bg-gray-100 text-gray-700',
                  completed: 'bg-emerald-100 text-emerald-700',
                }
                return (
                  <div
                    key={`project-${project.id}-${index}`}
                    onClick={() => handleSearchResult({ id: project.id, title: project.title, type: 'project', data: project })}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${
                        urgency === 'error' ? 'bg-red-100' : urgency === 'warning' ? 'bg-amber-100' : 'bg-violet-100'
                      }`}>
                        <FolderKanban className={`h-4 w-4 ${
                          urgency === 'error' ? 'text-red-600' : urgency === 'warning' ? 'text-amber-600' : 'text-violet-600'
                        }`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm truncate">{project.title}</p>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors[project.status] || 'bg-gray-100 text-gray-600'}`}>
                            {project.status?.replace('_', ' ')}
                          </span>
                          {project.priority && (
                            <PriorityBadge priority={project.priority} size="sm" />
                          )}
                        </div>
                      </div>
                    </div>
                    {dueLabel && (
                      <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ml-2 ${
                        urgency === 'error' ? 'bg-red-100 text-red-700' :
                        urgency === 'warning' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {dueLabel}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <FolderKanban className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No active projects</p>
              <p className="text-sm">Create a project to get started</p>
            </div>
          )

        case 'deadlines':
          const deadlineItems = (urgentItems?.calendarEvents || []).sort((a: any, b: any) => {
            const dateA = a.start_date || ''
            const dateB = b.start_date || ''
            return new Date(dateA).getTime() - new Date(dateB).getTime()
          })

          return deadlineItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {deadlineItems.slice(0, 8).map((event: any, index: number) => {
                const eventDate = new Date(event.start_date)
                const dueLabel = formatDueDate(event.start_date)
                const urgency = getUrgencyColor(event.start_date)
                const eventTypeColors: Record<string, { bg: string; icon: string }> = {
                  deadline: { bg: 'bg-red-100', icon: 'text-red-600' },
                  meeting: { bg: 'bg-blue-100', icon: 'text-blue-600' },
                  earnings_call: { bg: 'bg-green-100', icon: 'text-green-600' },
                  conference: { bg: 'bg-purple-100', icon: 'text-purple-600' },
                  deliverable: { bg: 'bg-amber-100', icon: 'text-amber-600' },
                }
                const colors = eventTypeColors[event.event_type] || { bg: 'bg-gray-100', icon: 'text-gray-600' }
                return (
                  <div
                    key={`deadline-${event.id}-${index}`}
                    onClick={() => handleSearchResult({ id: 'calendar', title: 'Calendar', type: 'calendar', data: null })}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${colors.bg}`}>
                        <Clock className={`h-4 w-4 ${colors.icon}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm truncate">{event.title}</p>
                        <p className="text-xs text-gray-500">
                          {eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          {event.start_time && ` at ${event.start_time}`}
                        </p>
                      </div>
                    </div>
                    {dueLabel && (
                      <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ml-2 ${
                        urgency === 'error' ? 'bg-red-100 text-red-700' :
                        urgency === 'warning' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {dueLabel}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Clock className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No upcoming deadlines</p>
              <p className="text-sm">Add events to your calendar</p>
            </div>
          )

        case 'activity':
          return teamActivity && teamActivity.length > 0 ? (
            <div className="space-y-2">
              {teamActivity.slice(0, 8).map((activity: any, index: number) => (
                <div
                  key={`activity-${activity.id}-${index}`}
                  onClick={() => {
                    if (activity.projects) {
                      handleSearchResult({ id: activity.projects.id, title: activity.projects.title, type: 'project', data: activity.projects })
                    }
                  }}
                  className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                >
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Activity className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{activity.description || activity.action}</p>
                    <p className="text-xs text-gray-500">
                      {activity.projects?.title} • {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Activity className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No recent activity</p>
              <p className="text-sm">Activity will appear here as work progresses</p>
            </div>
          )

        case 'workflows':
          const activeWorkflows = workflows?.filter(wf => wf.active_assets > 0 || wf.usage_count > 0) || []
          return activeWorkflows.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeWorkflows.slice(0, 6).map(workflow => {
                const progress = workflow.usage_count > 0
                  ? Math.round((workflow.completed_assets / workflow.usage_count) * 100)
                  : 0
                return (
                  <div
                    key={workflow.id}
                    onClick={() => handleSearchResult({ id: 'workflows', title: 'Workflows', type: 'workflows', data: null })}
                    className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-900 text-sm">{workflow.name}</span>
                      <span className="text-xs text-gray-500">{progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                      <div
                        className="bg-indigo-500 h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{workflow.active_assets} active</span>
                      <span>{workflow.completed_assets} done</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Orbit className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No active workflows</p>
              <p className="text-sm">Create a workflow to track your process</p>
            </div>
          )

        default:
          return null
      }
    }

    return (
    <>
      <div className="space-y-6">
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
                      handleSearchResult({ id: 'reasons', title: 'Reasons', type: 'reasons', data: null })
                      setShowTradeMenu(false)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <MessageSquareText className="h-4 w-4 text-indigo-500" />
                    <span className="text-sm font-medium text-gray-700">Reasons</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Stats */}
          <div className="flex items-center space-x-4 text-sm text-gray-500">
            <div className="flex items-center space-x-1">
              <Activity className="h-4 w-4 text-blue-500" />
              <span>{myTasks?.length || 0} tasks</span>
            </div>
            <div className="flex items-center space-x-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>{allUrgentItems.filter(i => getUrgencyColor(i.due_date || i.start_date, i.priority) === 'error').length} urgent</span>
            </div>
          </div>
        </div>

        {/* Command Center - Unified Focus Box with Tabs */}
        <Card className="border-l-4 border-l-amber-500">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Command Center</h2>
                <p className="text-sm text-gray-500">Everything that needs your attention</p>
              </div>
            </div>
            {currentTab && (
              <button
                onClick={() => handleSearchResult({
                  id: currentTab.viewAllType,
                  title: currentTab.viewAllTitle,
                  type: currentTab.viewAllType as any,
                  data: null
                })}
                className="flex items-center space-x-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                <span>View all {currentTab.viewAllTitle}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center space-x-1 mb-4 bg-gray-100 rounded-lg p-1">
            {focusTabs.map(tab => {
              const Icon = tab.icon
              const isActive = focusTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setFocusTab(tab.id)}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center ${
                    isActive
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? `text-${tab.color}-500` : ''}`} />
                  <span className="hidden md:inline">{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                      isActive ? `bg-${tab.color}-100 text-${tab.color}-700` : 'bg-gray-200 text-gray-600'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab Content */}
          <div className="min-h-[200px]">
            {renderFocusContent()}
          </div>
        </Card>

        {/* Content Section - Full Width */}
        <ContentSection
          onAssetClick={(assetId, symbol) => handleSearchResult({
            id: assetId,
            title: symbol,
            type: 'asset',
            data: { id: assetId, symbol }
          })}
          onNoteClick={(noteId, noteType, noteData) => {
            // Navigate based on note type
            if (noteType === 'asset' && noteData.assets) {
              handleSearchResult({
                id: noteData.assets.id,
                title: noteData.assets.symbol,
                type: 'asset',
                data: noteData.assets
              })
            } else if (noteType === 'portfolio' && noteData.portfolios) {
              handleSearchResult({
                id: noteData.portfolios.id,
                title: noteData.portfolios.name,
                type: 'portfolio',
                data: noteData.portfolios
              })
            } else if (noteType === 'theme' && noteData.themes) {
              handleSearchResult({
                id: noteData.themes.id,
                title: noteData.themes.name,
                type: 'theme',
                data: noteData.themes
              })
            }
          }}
          onTradeIdeaClick={(tradeId) => {
            handleSearchResult({
              id: 'trade-queue',
              title: 'Trade Queue',
              type: 'trade-queue',
              data: { selectedTradeId: tradeId }
            })
          }}
        />

        {/* Analytics Section */}
        <Card className="border-l-4 border-l-cyan-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-cyan-100 rounded-lg flex items-center justify-center">
                <PieChart className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Analytics</h2>
                <p className="text-sm text-gray-500">Overview across all applications</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {/* Research Analytics */}
            <button
              onClick={() => handleSearchResult({ id: 'assets-list', title: 'Assets', type: 'assets-list', data: null })}
              className="p-4 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                <span className="text-2xl font-bold text-gray-900">{stats?.assets || 0}</span>
              </div>
              <p className="text-sm font-medium text-gray-700">Assets</p>
              <p className="text-xs text-gray-500">Under coverage</p>
            </button>

            <button
              onClick={() => handleSearchResult({ id: 'notes-list', title: 'Notes', type: 'notes-list', data: null })}
              className="p-4 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-colors text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <FileText className="h-5 w-5 text-indigo-600" />
                <span className="text-2xl font-bold text-gray-900">{stats?.notes || 0}</span>
              </div>
              <p className="text-sm font-medium text-gray-700">Notes</p>
              <p className="text-xs text-gray-500">Total written</p>
            </button>

            <button
              onClick={() => handleSearchResult({ id: 'assets-list', title: 'Assets', type: 'assets-list', data: null })}
              className="p-4 bg-green-50 rounded-xl hover:bg-green-100 transition-colors text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <Target className="h-5 w-5 text-green-600" />
                <span className="text-2xl font-bold text-gray-900">{stats?.priceTargets || 0}</span>
              </div>
              <p className="text-sm font-medium text-gray-700">Price Targets</p>
              <p className="text-xs text-gray-500">Active targets</p>
            </button>

            {/* Efficiency Analytics */}
            <button
              onClick={() => handleSearchResult({ id: 'projects-list', title: 'All Projects', type: 'projects-list', data: null })}
              className="p-4 bg-violet-50 rounded-xl hover:bg-violet-100 transition-colors text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <FolderKanban className="h-5 w-5 text-violet-600" />
                <span className="text-2xl font-bold text-gray-900">{urgentItems?.projects?.length || 0}</span>
              </div>
              <p className="text-sm font-medium text-gray-700">Projects</p>
              <p className="text-xs text-gray-500">Active projects</p>
            </button>

            <button
              onClick={() => handleSearchResult({ id: 'workflows', title: 'Workflows', type: 'workflows', data: null })}
              className="p-4 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <Orbit className="h-5 w-5 text-purple-600" />
                <span className="text-2xl font-bold text-gray-900">{workflows?.length || 0}</span>
              </div>
              <p className="text-sm font-medium text-gray-700">Workflows</p>
              <p className="text-xs text-gray-500">Total workflows</p>
            </button>

            {/* Trade Analytics */}
            <button
              onClick={() => handleSearchResult({ id: 'trade-queue', title: 'Trade Queue', type: 'trade-queue', data: null })}
              className="p-4 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <Lightbulb className="h-5 w-5 text-emerald-600" />
                <span className="text-2xl font-bold text-gray-900">{myTasks?.length || 0}</span>
              </div>
              <p className="text-sm font-medium text-gray-700">Active Tasks</p>
              <p className="text-xs text-gray-500">In workflows</p>
            </button>
          </div>
        </Card>
      </div>
    </>
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
