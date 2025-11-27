import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Target, FileText, ArrowUpRight, ArrowDownRight, Activity, Users, Lightbulb, Briefcase, Tag, List, Workflow, Star, Clock, Orbit, FolderKanban, ListTodo, Beaker, PieChart, Calendar, AlertTriangle, CheckCircle2, Play, ChevronRight, Plus, Zap, ArrowRight } from 'lucide-react'
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
import { ProjectOverviewWidget } from '../components/projects/ProjectOverviewWidget'
import { ProjectStatusBreakdown } from '../components/projects/ProjectStatusBreakdown'
import { UpcomingDeadlines } from '../components/projects/UpcomingDeadlines'
import { RecentProjectActivity } from '../components/projects/RecentProjectActivity'
import { TradeQueuePage } from './TradeQueuePage'
import { SimulationPage } from './SimulationPage'
import { AssetAllocationPage } from './AssetAllocationPage'
import { TDFListPage } from './TDFListPage'
import { TDFTab } from '../components/tabs/TDFTab'
import { CalendarPage } from './CalendarPage'
import { PrioritizerPage } from './PrioritizerPage'
import { QuickThoughtCapture, ThoughtsFeed } from '../components/thoughts'

export function DashboardPage() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'dashboard', title: 'Dashboard', type: 'dashboard', isActive: true }
  ])
  const [activeTabId, setActiveTabId] = useState('dashboard')
  const [isInitialized, setIsInitialized] = useState(false)

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
              thesis,
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

      // Fetch incomplete deliverables with due dates
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
        .not('due_date', 'is', null)
        .lte('due_date', endOfWeek.toISOString())
        .order('due_date', { ascending: true })
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
      const { data: workflowProgress } = await supabase
        .from('asset_workflow_progress')
        .select(`
          *,
          assets!inner(id, symbol, company_name, priority, process_stage),
          workflows!inner(id, name),
          workflow_stages!inner(id, name, stage_order)
        `)
        .eq('is_started', true)
        .eq('is_completed', false)
        .order('started_at', { ascending: false })
        .limit(15)

      return workflowProgress || []
    }
  })

  // Fetch team activity
  const { data: teamActivity } = useQuery({
    queryKey: ['dashboard-team-activity'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return []

      // Get recent project activity from projects the user is assigned to
      const { data: activity } = await supabase
        .from('project_activity')
        .select(`
          *,
          projects!inner(
            id,
            title,
            project_assignments!inner(assigned_to)
          )
        `)
        .eq('projects.project_assignments.assigned_to', userId)
        .order('created_at', { ascending: false })
        .limit(10)

      return activity || []
    }
  })

  // Initialize tab state from persistence on component mount
  useEffect(() => {
    const savedState = TabStateManager.loadMainTabState()
    if (savedState) {
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

      // Restore tabs and active tab
      setTabs(savedState.tabs.map(tab => ({
        ...tab,
        isActive: tab.id === savedState.activeTabId
      })))
      setActiveTabId(savedState.activeTabId)
    }
    setIsInitialized(true)
  }, [])

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
    const existingTab = tabs.find(tab => {
      if (tab.id === result.id) return true
      // For asset tabs, also check by symbol
      if (result.type === 'asset' && result.data?.symbol && tab.data?.symbol === result.data.symbol) return true
      if (result.type === 'asset' && result.data?.symbol && tab.id === result.data.symbol) return true
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
    const newTabs = [...tabs]
    const [movedTab] = newTabs.splice(fromIndex, 1)
    newTabs.splice(toIndex, 0, movedTab)
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

    return (
    <>
      <div className="space-y-6">
        {/* Quick Actions Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleSearchResult({ id: 'projects-list', title: 'All Projects', type: 'projects-list', data: null })}
              className="flex items-center space-x-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">New Project</span>
            </button>
            <button
              onClick={() => handleSearchResult({ id: 'calendar', title: 'Calendar', type: 'calendar', data: null })}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Calendar className="h-4 w-4" />
              <span className="text-sm font-medium">Calendar</span>
            </button>
            <button
              onClick={() => handleSearchResult({ id: 'prioritizer', title: 'Prioritizer', type: 'prioritizer', data: null })}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ListTodo className="h-4 w-4" />
              <span className="text-sm font-medium">Prioritizer</span>
            </button>
          </div>
          <div className="flex items-center space-x-4 text-sm text-gray-500">
            <div className="flex items-center space-x-1">
              <Activity className="h-4 w-4 text-blue-500" />
              <span>{myTasks?.length || 0} active tasks</span>
            </div>
            <div className="flex items-center space-x-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>{allUrgentItems.filter(i => getUrgencyColor(i.due_date || i.start_date, i.priority) === 'error').length} urgent</span>
            </div>
          </div>
        </div>

        {/* Today's Focus - Full Width Priority Section */}
        <Card className="border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Today's Focus</h2>
                <p className="text-sm text-gray-500">Urgent deadlines and high-priority work</p>
              </div>
            </div>
            <button
              onClick={() => handleSearchResult({ id: 'prioritizer', title: 'Prioritizer', type: 'prioritizer', data: null })}
              className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center space-x-1"
            >
              <span>View all</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {allUrgentItems.length > 0 ? (
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
          )}
        </Card>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Work Management */}
          <div className="lg:col-span-2 space-y-6">
            {/* My Active Tasks */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Play className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">My Active Tasks</h2>
                    <p className="text-sm text-gray-500">Work in progress across workflows</p>
                  </div>
                </div>
                <button
                  onClick={() => handleSearchResult({ id: 'workflows', title: 'Workflows', type: 'workflows', data: null })}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center space-x-1"
                >
                  <span>Workflows</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2">
                {myTasks && myTasks.length > 0 ? (
                  myTasks.slice(0, 6).map((task: any) => (
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
                  ))
                ) : (
                  <NoDataAvailable message="No active workflow tasks" compact />
                )}
              </div>
            </Card>

            {/* Projects Overview with Deadlines */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ProjectOverviewWidget
                onProjectSelect={(project) => handleSearchResult({
                  id: project.id,
                  title: project.title,
                  type: 'project',
                  data: project
                })}
              />
              <UpcomingDeadlines
                onProjectSelect={(project) => handleSearchResult({
                  id: project.id,
                  title: project.title,
                  type: 'project',
                  data: project
                })}
              />
            </div>

            {/* Active Workflows */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <Orbit className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Active Workflows</h2>
                    <p className="text-sm text-gray-500">Process status at a glance</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {workflows && workflows.filter(wf => wf.active_assets > 0 || wf.usage_count > 0).length > 0 ? (
                  workflows
                    .filter(wf => wf.active_assets > 0 || wf.usage_count > 0)
                    .slice(0, 4)
                    .map(workflow => {
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
                          <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                            <div
                              className="bg-indigo-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{workflow.active_assets} active</span>
                            <span>{workflow.completed_assets} done</span>
                          </div>
                        </div>
                      )
                    })
                ) : (
                  <div className="col-span-2">
                    <NoDataAvailable message="No active workflows" compact />
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column - Quick Access & Activity */}
          <div className="space-y-6">
            {/* Quick Thought Capture */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center space-x-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <span>Capture a Thought</span>
              </h3>
              <QuickThoughtCapture compact placeholder="Quick reaction to news, research, market moves..." />
            </div>

            {/* Recent Thoughts */}
            <Card>
              <ThoughtsFeed
                limit={5}
                showHeader={true}
                onAssetClick={(assetId, symbol) => handleSearchResult({
                  id: assetId,
                  title: symbol,
                  type: 'asset',
                  data: { id: assetId, symbol }
                })}
              />
            </Card>

            {/* Quick Navigation */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Access</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'projects-list', title: 'Projects', type: 'projects-list', icon: FolderKanban, color: 'violet' },
                  { id: 'workflows', title: 'Workflows', type: 'workflows', icon: Orbit, color: 'indigo' },
                  { id: 'calendar', title: 'Calendar', type: 'calendar', icon: Calendar, color: 'blue' },
                  { id: 'prioritizer', title: 'Prioritizer', type: 'prioritizer', icon: ListTodo, color: 'amber' },
                  { id: 'idea-generator', title: 'Ideas', type: 'idea-generator', icon: Lightbulb, color: 'purple' },
                  { id: 'trade-queue', title: 'Trade Queue', type: 'trade-queue', icon: ListTodo, color: 'emerald' },
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleSearchResult({ id: item.id, title: item.title, type: item.type as any, data: null })}
                    className={`flex items-center space-x-2 p-2.5 rounded-lg transition-colors bg-${item.color}-50 hover:bg-${item.color}-100 text-${item.color}-700`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="text-xs font-medium">{item.title}</span>
                  </button>
                ))}
              </div>

              <div className="border-t border-gray-100 mt-4 pt-4">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Research</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'assets-list', title: 'Assets', type: 'assets-list', icon: TrendingUp },
                    { id: 'portfolios-list', title: 'Portfolios', type: 'portfolios-list', icon: Briefcase },
                    { id: 'themes-list', title: 'Themes', type: 'themes-list', icon: Tag },
                    { id: 'notes-list', title: 'Notes', type: 'notes-list', icon: FileText },
                  ].map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSearchResult({ id: item.id, title: item.title, type: item.type as any, data: null })}
                      className="flex items-center space-x-2 p-2 rounded-lg transition-colors bg-gray-50 hover:bg-gray-100 text-gray-700"
                    >
                      <item.icon className="h-4 w-4 text-gray-500" />
                      <span className="text-xs font-medium">{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-100 mt-4 pt-4">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Tools</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'trade-lab', title: 'Trade Lab', type: 'trade-lab', icon: Beaker },
                    { id: 'asset-allocation', title: 'Allocation', type: 'asset-allocation', icon: PieChart },
                    { id: 'tdf-list', title: 'TDF', type: 'tdf-list', icon: Clock },
                    { id: 'lists', title: 'Lists', type: 'lists', icon: List },
                  ].map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSearchResult({ id: item.id, title: item.title, type: item.type as any, data: null })}
                      className="flex items-center space-x-2 p-2 rounded-lg transition-colors bg-gray-50 hover:bg-gray-100 text-gray-700"
                    >
                      <item.icon className="h-4 w-4 text-gray-500" />
                      <span className="text-xs font-medium">{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* Team Activity */}
            <RecentProjectActivity
              onProjectSelect={(project) => handleSearchResult({
                id: project.id,
                title: project.title,
                type: 'project',
                data: project
              })}
            />

            {/* Quick Stats */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Overview</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 bg-primary-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <TrendingUp className="h-4 w-4 text-primary-600" />
                    <span className="text-sm text-gray-600">Assets</span>
                  </div>
                  <span className="font-bold text-gray-900">{stats?.assets || 0}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-indigo-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    <span className="text-sm text-gray-600">Notes</span>
                  </div>
                  <span className="font-bold text-gray-900">{stats?.notes || 0}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-success-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Target className="h-4 w-4 text-success-600" />
                    <span className="text-sm text-gray-600">Price Targets</span>
                  </div>
                  <span className="font-bold text-gray-900">{stats?.priceTargets || 0}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
  }

  return (
    <Layout
      tabs={tabs}
      activeTabId={activeTabId}
      onTabReorder={handleTabReorder}
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
