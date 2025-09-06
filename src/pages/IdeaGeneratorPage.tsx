import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lightbulb, TrendingUp, Target, FileText, Briefcase, Tag, Shuffle, RefreshCw, Calendar, ArrowUpRight, AlertTriangle, Star, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface IdeaGeneratorPageProps {
  onItemSelect?: (item: any) => void
}

interface IdeaTile {
  id: string
  type: 'asset' | 'note' | 'price_target' | 'theme' | 'portfolio' | 'insight'
  title: string
  subtitle?: string
  content: string
  priority?: 'high' | 'medium' | 'low'
  urgency?: 'urgent' | 'normal' | 'low'
  data: any
  color: string
  icon: React.ReactNode
  actionText: string
}

export function IdeaGeneratorPage({ onItemSelect }: IdeaGeneratorPageProps) {
  const [tiles, setTiles] = useState<IdeaTile[]>([])
  const [isShuffling, setIsShuffling] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // Fetch all data for idea generation
  const { data: ideaData, isLoading, refetch } = useQuery({
    queryKey: ['idea-generator-data'],
    queryFn: async () => {
      console.log('🔍 Fetching data for idea generator...')
      
      // Fetch all relevant data in parallel
      const [
        assetsResult,
        notesResult,
        priceTargetsResult,
        themesResult,
        portfoliosResult
      ] = await Promise.all([
        // Assets with various conditions
        supabase
          .from('assets')
          .select('*')
          .order('updated_at', { ascending: false }),
        
        // Recent notes from all sources
        Promise.all([
          supabase.from('asset_notes').select('*, assets(symbol, company_name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('portfolio_notes').select('*, portfolios(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('theme_notes').select('*, themes(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('custom_notebook_notes').select('*, custom_notebooks(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10)
        ]),
        
        // Price targets
        supabase
          .from('price_targets')
          .select('*, assets(symbol, company_name, current_price)')
          .order('updated_at', { ascending: false }),
        
        // Themes
        supabase
          .from('themes')
          .select('*')
          .order('created_at', { ascending: false }),
        
        // Portfolios
        supabase
          .from('portfolios')
          .select('*, portfolio_holdings(id)')
          .order('updated_at', { ascending: false })
      ])

      // Combine all notes
      const allNotes = [
        ...(notesResult[0].data || []).map(note => ({ ...note, source_type: 'asset', source_name: note.assets?.symbol })),
        ...(notesResult[1].data || []).map(note => ({ ...note, source_type: 'portfolio', source_name: note.portfolios?.name })),
        ...(notesResult[2].data || []).map(note => ({ ...note, source_type: 'theme', source_name: note.themes?.name })),
        ...(notesResult[3].data || []).map(note => ({ ...note, source_type: 'custom', source_name: note.custom_notebooks?.name }))
      ]

      console.log('✅ Idea generator data fetched')
      return {
        assets: assetsResult.data || [],
        notes: allNotes,
        priceTargets: priceTargetsResult.data || [],
        themes: themesResult.data || [],
        portfolios: portfoliosResult.data || []
      }
    },
    staleTime: 30000, // Cache for 30 seconds
    refetchOnWindowFocus: false,
  })

  // Generate idea tiles from the data
  const generateIdeaTiles = (data: any): IdeaTile[] => {
    if (!data) return []

    const tiles: IdeaTile[] = []
    const now = new Date()

    // High priority assets that need attention
    data.assets?.filter((asset: any) => asset.priority === 'high').forEach((asset: any) => {
      tiles.push({
        id: `asset-priority-${asset.id}`,
        type: 'asset',
        title: `${asset.symbol} - High Priority`,
        subtitle: asset.company_name,
        content: `This high-priority asset might need your attention. Last updated ${formatDistanceToNow(new Date(asset.updated_at || 0), { addSuffix: true })}.`,
        priority: 'high',
        urgency: 'urgent',
        data: asset,
        color: '#ef4444',
        icon: <AlertTriangle className="h-5 w-5" />,
        actionText: 'Review Asset'
      })
    })

    // Assets in research stage that haven't been updated recently
    data.assets?.filter((asset: any) => 
      asset.process_stage === 'research' && 
      new Date(asset.updated_at || 0) < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    ).slice(0, 3).forEach((asset: any) => {
      tiles.push({
        id: `asset-stale-${asset.id}`,
        type: 'asset',
        title: `${asset.symbol} Research Update`,
        subtitle: asset.company_name,
        content: `This asset has been in research for a while. Consider moving to analysis or updating your thesis.`,
        priority: 'medium',
        urgency: 'normal',
        data: asset,
        color: '#f59e0b',
        icon: <Clock className="h-5 w-5" />,
        actionText: 'Update Research'
      })
    })

    // Recent notes that might spark ideas
    data.notes?.slice(0, 5).forEach((note: any) => {
      tiles.push({
        id: `note-recent-${note.id}`,
        type: 'note',
        title: `New ${note.source_type} Note`,
        subtitle: note.title,
        content: `"${note.content.substring(0, 100)}..." - Consider expanding on this research.`,
        priority: 'medium',
        urgency: 'normal',
        data: note,
        color: '#8b5cf6',
        icon: <FileText className="h-5 w-5" />,
        actionText: 'Read Note'
      })
    })

    // Price targets that are close to current prices
    data.priceTargets?.filter((pt: any) => {
      const currentPrice = pt.assets?.current_price
      const targetPrice = pt.price
      if (!currentPrice || !targetPrice) return false
      
      const percentDiff = Math.abs((targetPrice - currentPrice) / currentPrice) * 100
      return percentDiff < 15 // Within 15% of target
    }).slice(0, 3).forEach((priceTarget: any) => {
      const currentPrice = priceTarget.assets?.current_price
      const targetPrice = priceTarget.price
      const percentDiff = ((targetPrice - currentPrice) / currentPrice) * 100
      
      tiles.push({
        id: `price-target-close-${priceTarget.id}`,
        type: 'price_target',
        title: `${priceTarget.assets?.symbol} Near Target`,
        subtitle: `${priceTarget.type} case target`,
        content: `Current: $${currentPrice} | Target: $${targetPrice} (${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(1)}%)`,
        priority: 'high',
        urgency: 'urgent',
        data: priceTarget,
        color: percentDiff > 0 ? '#10b981' : '#ef4444',
        icon: <Target className="h-5 w-5" />,
        actionText: 'Review Target'
      })
    })

    // Themes with no recent activity
    data.themes?.filter((theme: any) => 
      new Date(theme.updated_at || theme.created_at || 0) < new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    ).slice(0, 2).forEach((theme: any) => {
      tiles.push({
        id: `theme-inactive-${theme.id}`,
        type: 'theme',
        title: `Revisit ${theme.name}`,
        subtitle: `${theme.theme_type || 'general'} theme`,
        content: `This theme hasn't been updated recently. Consider adding new research or assets.`,
        priority: 'low',
        urgency: 'normal',
        data: theme,
        color: '#06b6d4',
        icon: <Tag className="h-5 w-5" />,
        actionText: 'Update Theme'
      })
    })

    // Portfolio insights
    data.portfolios?.slice(0, 2).forEach((portfolio: any) => {
      const holdingsCount = portfolio.portfolio_holdings?.length || 0
      tiles.push({
        id: `portfolio-insight-${portfolio.id}`,
        type: 'portfolio',
        title: `${portfolio.name} Portfolio`,
        subtitle: `${holdingsCount} holdings`,
        content: holdingsCount === 0 
          ? 'Empty portfolio - consider adding some holdings to track performance.'
          : `Portfolio with ${holdingsCount} holdings. Review allocation and performance.`,
        priority: holdingsCount === 0 ? 'medium' : 'low',
        urgency: 'normal',
        data: portfolio,
        color: '#10b981',
        icon: <Briefcase className="h-5 w-5" />,
        actionText: 'View Portfolio'
      })
    })

    // Generate some insights
    if (data.assets?.length > 0) {
      const highPriorityCount = data.assets.filter((a: any) => a.priority === 'high').length
      const researchStageCount = data.assets.filter((a: any) => a.process_stage === 'research').length
      
      if (highPriorityCount > 3) {
        tiles.push({
          id: 'insight-high-priority',
          type: 'insight',
          title: 'High Priority Alert',
          subtitle: `${highPriorityCount} high-priority assets`,
          content: `You have ${highPriorityCount} high-priority assets. Consider focusing your research efforts.`,
          priority: 'high',
          urgency: 'urgent',
          data: { count: highPriorityCount, type: 'high_priority' },
          color: '#ef4444',
          icon: <Star className="h-5 w-5" />,
          actionText: 'View High Priority'
        })
      }

      if (researchStageCount > 5) {
        tiles.push({
          id: 'insight-research-backlog',
          type: 'insight',
          title: 'Research Backlog',
          subtitle: `${researchStageCount} assets in research`,
          content: `Large research backlog detected. Consider prioritizing or moving some assets to analysis.`,
          priority: 'medium',
          urgency: 'normal',
          data: { count: researchStageCount, type: 'research_backlog' },
          color: '#f59e0b',
          icon: <TrendingUp className="h-5 w-5" />,
          actionText: 'Review Research'
        })
      }
    }

    // Shuffle and return random selection
    const shuffled = tiles.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, 12) // Show up to 12 tiles
  }

  // Generate tiles when data changes
  useEffect(() => {
    if (ideaData) {
      const newTiles = generateIdeaTiles(ideaData)
      setTiles(newTiles)
    }
  }, [ideaData])

  const handleShuffle = () => {
    setIsShuffling(true)
    setTimeout(() => {
      if (ideaData) {
        const newTiles = generateIdeaTiles(ideaData)
        setTiles(newTiles)
      }
      setIsShuffling(false)
    }, 500)
  }

  const handleRefresh = () => {
    setLastRefresh(new Date())
    refetch()
  }

  const handleTileClick = (tile: IdeaTile) => {
    if (onItemSelect) {
      let navigationData = null

      switch (tile.type) {
        case 'asset':
          navigationData = {
            id: tile.data.id,
            title: tile.data.symbol,
            type: 'asset',
            data: tile.data
          }
          break
        case 'note':
          navigationData = {
            id: tile.data.id,
            title: tile.data.title,
            type: 'note',
            data: tile.data
          }
          break
        case 'theme':
          navigationData = {
            id: tile.data.id,
            title: tile.data.name,
            type: 'theme',
            data: tile.data
          }
          break
        case 'portfolio':
          navigationData = {
            id: tile.data.id,
            title: tile.data.name,
            type: 'portfolio',
            data: tile.data
          }
          break
        case 'insight':
          // For insights, navigate to relevant list page
          if (tile.data.type === 'high_priority') {
            navigationData = {
              id: 'assets-list',
              title: 'High Priority Assets',
              type: 'assets-list',
              data: null
            }
          } else if (tile.data.type === 'research_backlog') {
            navigationData = {
              id: 'assets-list',
              title: 'Research Assets',
              type: 'assets-list',
              data: null
            }
          }
          break
      }

      if (navigationData) {
        onItemSelect(navigationData)
      }
    }
  }

  const getPriorityGradient = (priority?: string) => {
    switch (priority) {
      case 'high': return 'from-red-500 to-red-600'
      case 'medium': return 'from-yellow-500 to-orange-500'
      case 'low': return 'from-green-500 to-green-600'
      default: return 'from-blue-500 to-blue-600'
    }
  }

  const getUrgencyBorder = (urgency?: string) => {
    switch (urgency) {
      case 'urgent': return 'border-red-300 shadow-red-100'
      case 'normal': return 'border-gray-200 shadow-gray-100'
      case 'low': return 'border-gray-100 shadow-gray-50'
      default: return 'border-gray-200 shadow-gray-100'
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <Lightbulb className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Idea Generator</h1>
          </div>
          <p className="text-gray-600">
            Discover insights and opportunities from your investment data
          </p>
        </div>
        <div className="flex items-center space-x-3 mt-4 sm:mt-0">
          <div className="text-sm text-gray-500">
            Last updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShuffle}
            disabled={isShuffling}
          >
            <Shuffle className={clsx('h-4 w-4 mr-2', isShuffling && 'animate-spin')} />
            Shuffle
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Idea Tiles Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <Card className="h-48">
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  </div>
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  <div className="h-6 bg-gray-200 rounded w-1/3 mt-4"></div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      ) : tiles.length > 0 ? (
        <div className={clsx(
          'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 transition-all duration-500',
          isShuffling && 'opacity-50 scale-95'
        )}>
          {tiles.map((tile, index) => (
            <div
              key={tile.id}
              onClick={() => handleTileClick(tile)}
              className={clsx(
                'cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-lg',
                `animation-delay-${index % 4}`
              )}
              style={{
                animationDelay: `${index * 100}ms`
              }}
            >
              <Card className={clsx(
                'h-48 relative overflow-hidden border-2 hover:border-opacity-50 transition-all duration-300',
                getUrgencyBorder(tile.urgency)
              )}>
                {/* Background gradient */}
                <div 
                  className="absolute inset-0 opacity-5"
                  style={{ backgroundColor: tile.color }}
                />
                
                {/* Priority indicator */}
                {tile.priority === 'high' && (
                  <div className="absolute top-2 right-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  </div>
                )}

                <div className="relative z-10 h-full flex flex-col">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div 
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                        style={{ backgroundColor: tile.color }}
                      >
                        {tile.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">
                          {tile.title}
                        </h3>
                        {tile.subtitle && (
                          <p className="text-xs text-gray-600 truncate">
                            {tile.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 mb-4">
                    <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">
                      {tile.content}
                    </p>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {tile.priority && (
                        <Badge 
                          variant={tile.priority === 'high' ? 'error' : tile.priority === 'medium' ? 'warning' : 'success'} 
                          size="sm"
                        >
                          {tile.priority}
                        </Badge>
                      )}
                      <Badge variant="default" size="sm">
                        {tile.type.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center text-xs text-gray-500">
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                      {tile.actionText}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <div className="w-20 h-20 bg-gradient-to-r from-purple-100 to-pink-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lightbulb className="h-10 w-10 text-purple-600" />
          </div>
          <h3 className="text-xl font-medium text-gray-900 mb-2">No Ideas Generated Yet</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            Start adding assets, notes, and research to your system. The Idea Generator will analyze your data and suggest actionable insights.
          </p>
          <Button onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Generate Ideas
          </Button>
        </div>
      )}

      {/* Stats Footer */}
      {ideaData && (
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{ideaData.assets?.length || 0}</p>
              <p className="text-sm text-gray-600">Assets</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{ideaData.notes?.length || 0}</p>
              <p className="text-sm text-gray-600">Notes</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{ideaData.priceTargets?.length || 0}</p>
              <p className="text-sm text-gray-600">Price Targets</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{ideaData.themes?.length || 0}</p>
              <p className="text-sm text-gray-600">Themes</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{tiles.length}</p>
              <p className="text-sm text-gray-600">Ideas Generated</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}