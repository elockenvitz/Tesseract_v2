import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Target, FileText, ArrowUpRight, ArrowDownRight, Activity, Users } from 'lucide-react'
import { financialDataService } from '../lib/financial-data/browser-client'
import { supabase } from '../lib/supabase'
import { Layout } from '../components/layout/Layout'
import type { Tab } from '../components/layout/TabManager'
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

export function DashboardPage() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'dashboard', title: 'Dashboard', type: 'dashboard', isActive: true }
  ])
  const [activeTabId, setActiveTabId] = useState('dashboard')

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
          .select('*, assets(symbol)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(2),
        supabase
          .from('portfolio_notes')
          .select('*, portfolios(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(2),
        supabase
          .from('theme_notes')
          .select('*, themes(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(2),
        supabase
          .from('custom_notebook_notes')
          .select('*, custom_notebooks(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
          .limit(2)
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

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'high': return 'error'
      case 'medium': return 'warning'
      case 'low': return 'success'
      case 'none': return 'default'
      default: return 'default'
    }
  }

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
    // Check if a tab with this ID already exists
    const existingTab = tabs.find(tab => tab.id === result.id)
    if (existingTab) {
      // If tab exists, just activate it
      setTabs(tabs.map(tab => ({ ...tab, isActive: tab.id === result.id })))
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

  const renderTabContent = () => {
    const activeTab = tabs.find(tab => tab.id === activeTabId)
    
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
        return activeTab.data ? <AssetTab asset={activeTab.data} /> : <div>Loading asset...</div>
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

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <TrendingUp className="h-6 w-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Assets</p>
              <p className="text-3xl font-bold text-gray-900">{stats?.assets || 0}</p>
            </div>
            <ArrowUpRight className="h-4 w-4 text-success-500 ml-auto" />
          </div>
        </Card>

        <Card>
          <div className="flex items-center">
            <div className="p-2 bg-success-100 rounded-lg">
              <Target className="h-6 w-6 text-success-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Price Targets</p>
              <p className="text-3xl font-bold text-gray-900">{stats?.priceTargets || 0}</p>
            </div>
            <Activity className="h-4 w-4 text-warning-500 ml-auto" />
          </div>
        </Card>

        <Card>
          <div className="flex items-center">
            <div className="p-2 bg-warning-100 rounded-lg">
              <FileText className="h-6 w-6 text-warning-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Research Notes</p>
              <p className="text-3xl font-bold text-gray-900">{stats?.notes || 0}</p>
            </div>
            <FileText className="h-4 w-4 text-primary-500 ml-auto" />
          </div>
        </Card>

        <Card>
          <div className="flex items-center">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Users className="h-6 w-6 text-gray-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Active Ideas</p>
              <p className="text-3xl font-bold text-gray-900">12</p>
            </div>
            <ArrowUpRight className="h-4 w-4 text-success-500 ml-auto" />
          </div>
        </Card>
      </div>

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
                        <Badge variant={getPriorityColor(asset.priority)} size="sm">
                          {asset.priority}
                        </Badge>
                        <Badge variant={getStageColor(asset.process_stage)} size="sm">
                          {asset.process_stage}
                        </Badge>
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
                  onClick={() => handleSearchResult({
                    id: note.id,
                    title: note.title,
                    type: 'note',
                    data: note
                  })}
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