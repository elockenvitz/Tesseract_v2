import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Target, FileText, ArrowUpRight, ArrowDownRight, Activity, Users, Lightbulb, Briefcase, Tag, List, Workflow, Star, Clock, Orbit } from 'lucide-react'
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
      case 'note':
        return <NotebookTab notebook={activeTab.data} />
      case 'theme':
        return <ThemeTab theme={activeTab.data} />
      case 'portfolio':
        return <PortfolioTab portfolio={activeTab.data} onNavigate={handleSearchResult} />
      default:
        return renderDashboardContent()
    }
  }

  const renderDashboardContent = () => (
    <>
      <div className="space-y-6">
      {/* Navigation Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 gap-3">
        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => handleSearchResult({
            id: 'idea-generator',
            title: 'Ideas',
            type: 'idea-generator',
            data: null
          })}
        >
          <div className="flex items-center p-3 space-x-3">
            <div className="w-12 h-12 bg-gradient-to-r from-purple-100 to-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Lightbulb className="h-6 w-6 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Ideas</div>
              <div className="text-xs text-gray-500">Discover insights</div>
            </div>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => handleSearchResult({
            id: 'workflows',
            title: 'Workflows',
            type: 'workflows',
            data: null
          })}
        >
          <div className="flex items-center p-3 space-x-3">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Orbit className="h-6 w-6 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Workflows</div>
              <div className="text-xs text-gray-500">Manage processes</div>
            </div>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => handleSearchResult({
            id: 'assets-list',
            title: 'All Assets',
            type: 'assets-list',
            data: null
          })}
        >
          <div className="flex items-center p-3 space-x-3">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingUp className="h-6 w-6 text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Assets</div>
              <div className="text-xs text-gray-500">Investment ideas</div>
            </div>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => handleSearchResult({
            id: 'portfolios-list',
            title: 'All Portfolios',
            type: 'portfolios-list',
            data: null
          })}
        >
          <div className="flex items-center p-3 space-x-3">
            <div className="w-12 h-12 bg-success-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Briefcase className="h-6 w-6 text-success-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Portfolios</div>
              <div className="text-xs text-gray-500">Track performance</div>
            </div>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => handleSearchResult({
            id: 'themes-list',
            title: 'All Themes',
            type: 'themes-list',
            data: null
          })}
        >
          <div className="flex items-center p-3 space-x-3">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Tag className="h-6 w-6 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Themes</div>
              <div className="text-xs text-gray-500">Organize by topic</div>
            </div>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => handleSearchResult({
            id: 'notes-list',
            title: 'All Notes',
            type: 'notes-list',
            data: null
          })}
        >
          <div className="flex items-center p-3 space-x-3">
            <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="h-6 w-6 text-slate-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Notes</div>
              <div className="text-xs text-gray-500">All your notes</div>
            </div>
          </div>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => handleSearchResult({
            id: 'lists',
            title: 'Asset Lists',
            type: 'lists',
            data: null
          })}
        >
          <div className="flex items-center p-3 space-x-3">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <List className="h-6 w-6 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Lists</div>
              <div className="text-xs text-gray-500">Organize assets</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Curated Content Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Priority Assets */}
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Priority Assets</h2>
            <p className="text-sm text-gray-500">High-priority items needing your attention</p>
          </div>
          <div className="space-y-3">
            {assets && assets.length > 0 ? (
              assets
                .filter(asset => asset.priority === 'high' || asset.priority === 'medium')
                .slice(0, 5)
                .map(asset => (
                  <div
                    key={asset.id}
                    onClick={() => handleSearchResult({
                      id: asset.id,
                      title: asset.symbol,
                      type: 'asset',
                      data: asset
                    })}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-gray-900">{asset.symbol}</span>
                        <PriorityBadge priority={asset.priority} />
                      </div>
                      <p className="text-sm text-gray-600 truncate">{asset.company_name}</p>
                    </div>
                    {financialData?.[asset.symbol] && (
                      <div className="text-right ml-4">
                        <div className="font-semibold text-gray-900">
                          ${financialData[asset.symbol].price?.toFixed(2)}
                        </div>
                        <div className={`text-sm flex items-center justify-end ${
                          financialData[asset.symbol].changePercent >= 0 ? 'text-success-600' : 'text-error-600'
                        }`}>
                          {financialData[asset.symbol].changePercent >= 0 ? (
                            <ArrowUpRight className="h-3 w-3 mr-1" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 mr-1" />
                          )}
                          {Math.abs(financialData[asset.symbol].changePercent).toFixed(2)}%
                        </div>
                      </div>
                    )}
                  </div>
                ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Target className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm">No priority assets yet</p>
              </div>
            )}
          </div>
        </Card>

        {/* Active Workflows */}
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Active Workflows</h2>
            <p className="text-sm text-gray-500">Workflows currently in progress</p>
          </div>
          <div className="space-y-3">
            {workflows && workflows.length > 0 ? (
              workflows
                .filter(wf => wf.active_assets && wf.active_assets > 0)
                .slice(0, 5)
                .map(workflow => (
                  <div
                    key={workflow.id}
                    className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-900">{workflow.name}</span>
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <div className="flex items-center space-x-1">
                        <Activity className="h-4 w-4" />
                        <span>{workflow.active_assets} active</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Target className="h-4 w-4" />
                        <span>{workflow.completed_assets} completed</span>
                      </div>
                    </div>
                  </div>
                ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Workflow className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm">No active workflows</p>
              </div>
            )}
          </div>
        </Card>

        {/* Recent Notes */}
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Notes</h2>
            <p className="text-sm text-gray-500">Your latest research and insights</p>
          </div>
          <div className="space-y-3">
            {notes && notes.length > 0 ? (
              notes.slice(0, 5).map((note: any) => (
                <div
                  key={note.id}
                  className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="font-medium text-gray-900 text-sm">
                      {note.type === 'asset' ? note.assets?.symbol :
                       note.type === 'portfolio' ? note.portfolios?.name :
                       note.type === 'theme' ? note.themes?.name :
                       note.custom_notebooks?.name}
                    </span>
                    <Badge variant="outline" size="sm">{note.type}</Badge>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2">{note.content}</p>
                  <div className="flex items-center space-x-1 mt-2 text-xs text-gray-500">
                    <Clock className="h-3 w-3" />
                    <span>{formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm">No recent notes</p>
              </div>
            )}
          </div>
        </Card>

        {/* Quick Stats */}
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Your Research</h2>
            <p className="text-sm text-gray-500">Overview of your activity</p>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-primary-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Assets</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.assets || 0}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <FileText className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Notes</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.notes || 0}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-success-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
                  <Target className="h-5 w-5 text-success-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Price Targets</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.priceTargets || 0}</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
      </div> {/* End space-y-6 */}
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
