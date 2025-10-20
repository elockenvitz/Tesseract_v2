import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Target, FileText, ArrowUpRight, ArrowDownRight, Activity, Users, Lightbulb, Briefcase, Tag, List, Workflow, Star, Clock } from 'lucide-react'
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
import { formatDistanceToNow } from 'date-fns'
import { ProfilePage } from './ProfilePage'
import { SettingsPage } from './SettingsPage'
import { IdeaGeneratorPage } from './IdeaGeneratorPage'
import { WorkflowsPage } from './WorkflowsPage'

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
        .order('is_default', { ascending: false })
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

  const handleSearchResult = (result: any) => {
    console.log(`🎯 DashboardPage: handleSearchResult called with:`, {
      resultId: result.id,
      resultType: result.type,
      hasData: !!result.data,
      dataWorkflowId: result.data?.workflow_id
    })

    // Check if a tab with this ID already exists
    const existingTab = tabs.find(tab => tab.id === result.id)
    if (existingTab) {
      console.log(`🔄 DashboardPage: Existing tab found, updating data and activating`)
      // If tab exists, update its data and activate it
      setTabs(tabs.map(tab => ({
        ...tab,
        isActive: tab.id === result.id,
        // Update the data if this is the matching tab
        ...(tab.id === result.id && result.data ? { data: result.data } : {})
      })))
      setActiveTabId(result.id)
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
      case 'note':
        return <NotebookTab notebook={activeTab.data} />
      case 'theme':
        return <ThemeTab theme={activeTab.data} />
      case 'portfolio':
        return <PortfolioTab portfolio={activeTab.data} />
      default:
        return renderDashboardContent()
    }
  }

  const renderDashboardContent = () => (
    <>
      <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Investment Dashboard</h1>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center space-x-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        <Card
          className="hover:shadow-md transition-shadow cursor-pointer flex-shrink-0 w-36"
          onClick={() => handleSearchResult({
            id: 'idea-generator',
            title: 'Ideas',
            type: 'idea-generator',
            data: null
          })}
        >
          <div className="flex flex-col items-center p-4">
            <div className="w-12 h-12 bg-gradient-to-r from-purple-100 to-pink-100 rounded-lg flex items-center justify-center mb-3">
              <Lightbulb className="h-6 w-6 text-purple-600" />
            </div>
            <span className="text-gray-900 font-semibold text-center">Ideas</span>
            <span className="text-gray-500 text-xs mt-1 text-center">Discover insights</span>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer flex-shrink-0 w-36"
          onClick={() => handleSearchResult({
            id: 'workflows',
            title: 'Workflows',
            type: 'workflows',
            data: null
          })}
        >
          <div className="flex flex-col items-center p-4">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-lg flex items-center justify-center mb-3">
              <Workflow className="h-6 w-6 text-blue-600" />
            </div>
            <span className="text-gray-900 font-semibold text-center">Workflows</span>
            <span className="text-gray-500 text-xs mt-1 text-center">Manage processes</span>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer flex-shrink-0 w-36"
          onClick={() => handleSearchResult({
            id: 'assets-list',
            title: 'All Assets',
            type: 'assets-list',
            data: null
          })}
        >
          <div className="flex flex-col items-center p-4">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-3">
              <TrendingUp className="h-6 w-6 text-primary-600" />
            </div>
            <span className="text-gray-900 font-semibold text-center">Assets</span>
            <span className="text-gray-500 text-xs mt-1 text-center">Investment ideas</span>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer flex-shrink-0 w-36"
          onClick={() => handleSearchResult({
            id: 'portfolios-list',
            title: 'All Portfolios',
            type: 'portfolios-list',
            data: null
          })}
        >
          <div className="flex flex-col items-center p-4">
            <div className="w-12 h-12 bg-success-100 rounded-lg flex items-center justify-center mb-3">
              <Briefcase className="h-6 w-6 text-success-600" />
            </div>
            <span className="text-gray-900 font-semibold text-center">Portfolios</span>
            <span className="text-gray-500 text-xs mt-1 text-center">Track performance</span>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer flex-shrink-0 w-36"
          onClick={() => handleSearchResult({
            id: 'themes-list',
            title: 'All Themes',
            type: 'themes-list',
            data: null
          })}
        >
          <div className="flex flex-col items-center p-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-3">
              <Tag className="h-6 w-6 text-indigo-600" />
            </div>
            <span className="text-gray-900 font-semibold text-center">Themes</span>
            <span className="text-gray-500 text-xs mt-1 text-center">Organize by topic</span>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer flex-shrink-0 w-36"
          onClick={() => handleSearchResult({
            id: 'notes-list',
            title: 'All Notes',
            type: 'notes-list',
            data: null
          })}
        >
          <div className="flex flex-col items-center p-4">
            <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center mb-3">
              <FileText className="h-6 w-6 text-slate-600" />
            </div>
            <span className="text-gray-900 font-semibold text-center">Notes</span>
            <span className="text-gray-500 text-xs mt-1 text-center">All your notes</span>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer flex-shrink-0 w-36"
          onClick={() => handleSearchResult({
            id: 'lists',
            title: 'Asset Lists',
            type: 'lists',
            data: null
          })}
        >
          <div className="flex flex-col items-center p-4">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
              <List className="h-6 w-6 text-purple-600" />
            </div>
            <span className="text-gray-900 font-semibold text-center">Lists</span>
            <span className="text-gray-500 text-xs mt-1 text-center">Organize assets</span>
          </div>
        </Card>
      </div>

      {/* Active Workflows */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Active Workflows</h2>
            <p className="text-sm text-gray-500">All available workflows with usage statistics</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-600 hover:text-primary-700"
            onClick={() => handleSearchResult({
              id: 'workflows',
              title: 'Workflows',
              type: 'workflows',
              data: null
            })}
          >
            Manage workflows →
          </Button>
        </div>

        {workflowsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-32 bg-gray-200 rounded-lg"></div>
              </div>
            ))}
          </div>
        ) : workflows && workflows.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="relative p-4 border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-md transition-all duration-200 cursor-pointer"
                onClick={() => handleSearchResult({
                  id: 'workflows',
                  title: 'Workflows',
                  type: 'workflows',
                  data: { selectedWorkflowId: workflow.id }
                })}
              >
                {/* Header with color indicator and default badge */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: workflow.color }}
                    />
                    <h3 className="font-semibold text-gray-900 truncate flex-1">
                      {workflow.name}
                    </h3>
                  </div>
                  <div className="flex items-center space-x-1">
                    {workflow.is_default && (
                      <div className="text-yellow-500">
                        <Star className="w-4 h-4 fill-current" />
                      </div>
                    )}
                    {workflow.is_public && (
                      <Badge variant="secondary" size="sm">
                        Public
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Description */}
                {workflow.description && (
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                    {workflow.description}
                  </p>
                )}

                {/* Statistics */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-blue-50 rounded-lg p-2">
                    <div className="text-lg font-semibold text-blue-600">
                      {workflow.usage_count || 0}
                    </div>
                    <div className="text-xs text-blue-600 font-medium">
                      Total
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-2">
                    <div className="text-lg font-semibold text-green-600">
                      {workflow.active_assets || 0}
                    </div>
                    <div className="text-xs text-green-600 font-medium">
                      Active
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="text-lg font-semibold text-gray-600">
                      {workflow.completed_assets || 0}
                    </div>
                    <div className="text-xs text-gray-600 font-medium">
                      Done
                    </div>
                  </div>
                </div>

                {/* Cadence info */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{workflow.cadence_days} day cycle</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Activity className="w-3 h-3" />
                      <span>
                        {workflow.active_assets > 0
                          ? `${Math.round((workflow.completed_assets / workflow.usage_count) * 100) || 0}% complete`
                          : 'Ready to use'
                        }
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Workflow className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows available</h3>
            <p className="text-gray-500 mb-4">Create your first workflow to start tracking your investment process.</p>
            <Button
              onClick={() => handleSearchResult({
                id: 'workflows',
                title: 'Workflows',
                type: 'workflows',
                data: null
              })}
            >
              Create Workflow
            </Button>
          </div>
        )}
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Recent Assets - Takes 2 columns on xl screens */}
        <div className="xl:col-span-2">
          <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Recent Assets</h2>
              <p className="text-sm text-gray-500">Your latest investment ideas</p>
            </div>
            <Button variant="ghost" size="sm" className="text-primary-600 hover:text-primary-700">
              <span onClick={() => handleSearchResult({
                id: 'assets-list',
                title: 'All Assets',
                type: 'assets-list',
                data: null
              })}>
                View all →
              </span>
            </Button>
          </div>
          
          {assetsLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : assets && assets.length > 0 ? (
            <div className="space-y-4">
              {assets.map((asset) => (
                <div 
                  key={asset.id} 
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 cursor-pointer"
                  onClick={() => handleSearchResult({
                    id: asset.id,
                    title: asset.symbol,
                    type: 'asset',
                    data: asset
                  })}
                >
                  <div className="flex items-center space-x-4 flex-1">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{asset.symbol}</h3>
                        <PriorityBadge priority={asset.priority} />
                      </div>
                      <p className="text-sm text-gray-600 truncate">{asset.company_name}</p>
                      <p className="text-xs text-gray-500">
                        Updated {formatDistanceToNow(new Date(asset.updated_at || 0), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {(() => {
                      const quote = financialData?.[asset.symbol]

                      // Show colored pulse animation while loading
                      if (financialDataLoading) {
                        return (
                          <div className="animate-pulse">
                            <div className="h-6 bg-primary-200 rounded w-16 mb-1"></div>
                            <div className="h-4 bg-primary-200 rounded w-12"></div>
                          </div>
                        )
                      }

                      // Show dashes when no data available
                      if (!quote) {
                        return (
                          <div className="text-gray-400 text-sm">
                            <p className="text-lg font-semibold">--</p>
                            <div className="text-sm">--</div>
                          </div>
                        )
                      }

                      const isPositive = quote.change >= 0
                      const changeColor = isPositive ? 'text-success-600' : 'text-red-600'
                      const ChangeIcon = isPositive ? ArrowUpRight : ArrowDownRight

                      return (
                        <>
                          <p className="text-lg font-semibold text-gray-900">
                            ${quote.price.toFixed(2)}
                          </p>
                          <div className={`flex items-center ${changeColor} text-sm`}>
                            <ChangeIcon className="h-3 w-3 mr-1" />
                            {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No assets yet</h3>
              <p className="text-gray-500 mb-4">Start by adding your first investment idea.</p>
            </div>
          )}
          </Card>
        </div>

        {/* Recent Notes */}
        <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Recent Notes</h2>
              <p className="text-sm text-gray-500">Latest research</p>
            </div>
            <Button variant="ghost" size="sm" className="text-primary-600 hover:text-primary-700">
              <span onClick={() => handleSearchResult({
                id: 'notes-list',
                title: 'All Notes',
                type: 'notes-list',
                data: null
              })}>
                View all →
              </span>
            </Button>
          </div>
          
          {notesLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : notes && notes.length > 0 ? (
            <div className="space-y-4">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="p-4 border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 cursor-pointer"
                  onClick={async () => {
                    // Navigate to the entity page with note selected
                    let entityId = null
                    let entityTitle = null
                    let entityType = null
                    let entityData = null

                    if (note.type === 'asset' && note.asset_id) {
                      entityId = note.asset_id
                      entityTitle = note.assets?.symbol || 'Asset'
                      entityType = 'asset'
                      entityData = note.assets
                    } else if (note.type === 'portfolio' && note.portfolio_id) {
                      entityId = note.portfolio_id
                      entityTitle = note.portfolios?.name || 'Portfolio'
                      entityType = 'portfolio'
                      entityData = note.portfolios
                    } else if (note.type === 'theme' && note.theme_id) {
                      entityId = note.theme_id
                      entityTitle = note.themes?.name || 'Theme'
                      entityType = 'theme'
                      entityData = note.themes
                    }

                    if (entityId && entityType && entityData) {
                      console.log('📝 Dashboard: Navigating to entity with note:', {
                        entityId,
                        entityType,
                        noteId: note.id,
                        noteTitle: note.title
                      })
                      handleSearchResult({
                        id: entityId,
                        title: entityTitle,
                        type: entityType,
                        data: { ...entityData, noteId: note.id }
                      })
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 truncate">{note.title}</h3>
                    <div className="flex items-center space-x-2">
                      {(() => {
                        let entityName = null
                        if (note.type === 'asset' && note.assets?.symbol) {
                          entityName = note.assets.symbol
                        } else if (note.type === 'portfolio' && note.portfolios?.name) {
                          entityName = note.portfolios.name
                        } else if (note.type === 'theme' && note.themes?.name) {
                          entityName = note.themes.name
                        } else if (note.type === 'custom' && note.custom_notebooks?.name) {
                          entityName = note.custom_notebooks.name
                        }

                        return entityName ? (
                          <Badge variant="secondary" size="sm">
                            {entityName}
                          </Badge>
                        ) : null
                      })()}
                      {note.note_type && (
                        <Badge variant="default" size="sm">
                          {note.note_type}
                        </Badge>
                      )}
                      {note.is_shared && (
                        <Badge variant="primary" size="sm">
                          Shared
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                    {note.content.substring(0, 100)}...
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    {formatDistanceToNow(new Date(note.updated_at || 0), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No notes yet</h3>
              <p className="text-gray-500 mb-4">Start documenting your research.</p>
            </div>
          )}
        </Card>
      </div>
      </div>
    </>
  )

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