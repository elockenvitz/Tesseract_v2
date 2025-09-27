import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Lightbulb, TrendingUp, Target, FileText, Briefcase, Tag, Shuffle, RefreshCw,
  Calendar, ArrowUpRight, AlertTriangle, Star, Clock, List, Activity,
  ChevronRight, Users, Eye, Heart, MessageSquare, Share2, Bookmark,
  Play, Pause, Volume2, VolumeX, MoreHorizontal, ThumbsUp, ThumbsDown,
  ArrowLeft, ArrowRight, Filter, SortDesc, Workflow, BarChart3, Brain,
  Zap, TrendingDown, Award, Bell, Search, Plus
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { TabStateManager } from '../lib/tabStateManager'

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

interface FeedContent {
  id: string
  type: 'market_insight' | 'research_tip' | 'portfolio_alert' | 'trend_analysis' | 'educational'
  title: string
  content: string
  visual?: string
  author: string
  timestamp: string
  likes: number
  comments: number
  shares: number
  tags: string[]
}

interface WorkflowAsset {
  id: string
  symbol: string
  company_name: string
  stage: string
  priority: 'high' | 'medium' | 'low'
  last_updated: string
  assigned_to?: string
  due_date?: string
  progress_percentage: number
  is_started: boolean
}

type ViewType = 'discovery' | 'prioritizer' | 'feed'

export function IdeaGeneratorPage({ onItemSelect }: IdeaGeneratorPageProps) {
  // Priority configuration to match AssetWorkflowSelector
  const priorityConfig = {
    'critical': { color: 'bg-red-600 text-white', icon: AlertTriangle, label: 'Critical' },
    'high': { color: 'bg-orange-500 text-white', icon: Zap, label: 'High' },
    'medium': { color: 'bg-blue-500 text-white', icon: Target, label: 'Medium' },
    'low': { color: 'bg-green-500 text-white', icon: Clock, label: 'Low' }
  }

  // Load initial state from TabStateManager
  const loadedState = TabStateManager.loadTabState('idea-generator')

  const [activeView, setActiveView] = useState<ViewType>(loadedState?.activeView || 'discovery')
  const [tiles, setTiles] = useState<IdeaTile[]>([])
  const [isShuffling, setIsShuffling] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [currentFeedIndex, setCurrentFeedIndex] = useState(loadedState?.currentFeedIndex || 0)
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(loadedState?.selectedWorkflow || null)

  // Prioritizer filtering and sorting state
  const [prioritizerView, setPrioritizerView] = useState<'all' | 'in-progress' | 'by-stage' | 'by-priority'>(loadedState?.prioritizerView || 'all')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [sortBy, setSortBy] = useState<'priority' | 'stage' | 'updated' | 'symbol' | 'progress'>(loadedState?.sortBy || 'updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(loadedState?.sortOrder || 'desc')
  const [filterByStatus, setFilterByStatus] = useState<'all' | 'in-progress' | 'not-started'>(loadedState?.filterByStatus || 'all')
  const [filterByPriority, setFilterByPriority] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>(loadedState?.filterByPriority || 'all')
  const [filterByStage, setFilterByStage] = useState<string>(loadedState?.filterByStage || 'all')

  console.log('IdeaGeneratorPage: Loaded state:', loadedState)
  console.log('IdeaGeneratorPage: Current activeView:', activeView)
  console.log('IdeaGeneratorPage: Initialized prioritizer state:', {
    prioritizerView,
    sortBy,
    sortOrder,
    filterByStatus,
    filterByPriority,
    filterByStage,
    selectedWorkflow
  })

  // Sample feed content for demonstration
  const sampleFeedContent: FeedContent[] = [
    {
      id: '1',
      type: 'market_insight',
      title: 'Tech Stocks Rally Continues',
      content: 'The technology sector is showing strong momentum with FAANG stocks leading the charge. Key drivers include strong Q3 earnings, AI adoption, and cloud growth. Watch for potential resistance at key technical levels.',
      author: 'AI Market Analyst',
      timestamp: '2 hours ago',
      likes: 1247,
      comments: 89,
      shares: 156,
      tags: ['Technology', 'FAANG', 'Earnings', 'AI']
    },
    {
      id: '2',
      type: 'research_tip',
      title: 'How to Analyze P/E Ratios',
      content: 'When evaluating P/E ratios, consider: 1) Industry averages 2) Growth rates (PEG ratio) 3) Economic cycles 4) Company lifecycle stage. A high P/E isn\'t always bad if justified by growth prospects.',
      author: 'Research Expert',
      timestamp: '4 hours ago',
      likes: 892,
      comments: 45,
      shares: 203,
      tags: ['Education', 'Valuation', 'P/E Ratio', 'Research']
    },
    {
      id: '3',
      type: 'portfolio_alert',
      title: 'Rebalancing Opportunity',
      content: 'Your tech allocation has grown to 35% of your portfolio, above your 30% target. Consider taking some profits and rebalancing into undervalued sectors like healthcare or utilities.',
      author: 'Portfolio Manager AI',
      timestamp: '1 day ago',
      likes: 234,
      comments: 12,
      shares: 67,
      tags: ['Portfolio', 'Rebalancing', 'Risk Management']
    },
    {
      id: '4',
      type: 'trend_analysis',
      title: 'ESG Investing Momentum',
      content: 'ESG-focused funds have seen 23% increased inflows this quarter. Companies with strong ESG ratings are trading at premium valuations. This trend is driven by millennial investors and regulatory pressure.',
      author: 'Trend Analyst',
      timestamp: '2 days ago',
      likes: 567,
      comments: 78,
      shares: 134,
      tags: ['ESG', 'Sustainability', 'Trends', 'Millennials']
    },
    {
      id: '5',
      type: 'educational',
      title: 'Understanding Options Greeks',
      content: 'Delta measures price sensitivity, Gamma shows delta\'s rate of change, Theta represents time decay, and Vega indicates volatility sensitivity. Master these to improve your options trading strategy.',
      author: 'Options Educator',
      timestamp: '3 days ago',
      likes: 1156,
      comments: 167,
      shares: 289,
      tags: ['Options', 'Greeks', 'Education', 'Trading']
    }
  ]

  // Fetch data for discovery view (existing functionality)
  const { data: ideaData, isLoading, refetch } = useQuery({
    queryKey: ['idea-generator-data'],
    queryFn: async () => {
      console.log('🔍 Fetching data for idea generator...')

      const [
        assetsResult,
        notesResult,
        priceTargetsResult,
        themesResult,
        portfoliosResult
      ] = await Promise.all([
        supabase
          .from('assets')
          .select('*')
          .order('updated_at', { ascending: false }),

        Promise.all([
          supabase.from('asset_notes').select('*, assets(symbol, company_name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('portfolio_notes').select('*, portfolios(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('theme_notes').select('*, themes(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10),
          supabase.from('custom_notebook_notes').select('*, custom_notebooks(name)').neq('is_deleted', true).order('updated_at', { ascending: false }).limit(10)
        ]),

        supabase
          .from('price_targets')
          .select('*, assets(symbol, company_name, current_price)')
          .order('updated_at', { ascending: false }),

        supabase
          .from('themes')
          .select('*')
          .order('created_at', { ascending: false }),

        supabase
          .from('portfolios')
          .select('*, portfolio_holdings(id)')
          .order('updated_at', { ascending: false })
      ])

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
    staleTime: 30000,
    refetchOnWindowFocus: false,
  })

  // Fetch workflows and their assets for prioritizer view
  const { data: workflowData, isLoading: workflowLoading, refetch: refetchWorkflowData } = useQuery({
    queryKey: ['prioritizer-workflows'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return { workflows: [], workflowAssets: {} }

      // Get workflows
      const { data: workflows, error: workflowError } = await supabase
        .from('workflows')
        .select('*')
        .or(`is_public.eq.true,created_by.eq.${userId}`)
        .order('name')

      if (workflowError) throw workflowError

      // Get assets in progress for each workflow
      const workflowAssets: Record<string, WorkflowAsset[]> = {}

      for (const workflow of workflows || []) {
        console.log(`🔍 Fetching assets for workflow: ${workflow.name} (${workflow.id})`)

        // First get the workflow stages to calculate progress and get display names
        const { data: workflowStages, error: stagesError } = await supabase
          .from('workflow_stages')
          .select('stage_key, stage_label, sort_order')
          .eq('workflow_id', workflow.id)
          .order('sort_order')

        if (stagesError) {
          console.error(`❌ Error fetching stages for workflow ${workflow.name}:`, stagesError)
          continue
        }

        // Create a map for stage position lookup
        const stagePositions = new Map()
        workflowStages?.forEach((stage, index) => {
          stagePositions.set(stage.stage_key, index)
        })
        const totalStages = workflowStages?.length || 1

        // Get ALL workflow progress assets (both started and not started)
        const { data: progressAssets, error: progressError } = await supabase
          .from('asset_workflow_progress')
          .select(`
            *,
            assets(id, symbol, company_name, priority)
          `)
          .eq('workflow_id', workflow.id)
          .eq('is_completed', false)

        if (progressError) {
          console.error(`❌ Error fetching progress for workflow ${workflow.name}:`, progressError)
          continue
        }

        // Then get workflow-specific priorities for these assets
        const assetIds = progressAssets?.map(a => a.assets.id) || []
        let workflowPriorities: any[] = []

        if (assetIds.length > 0) {
          const { data: priorities, error: prioritiesError } = await supabase
            .from('asset_workflow_priorities')
            .select('asset_id, priority')
            .eq('workflow_id', workflow.id)
            .in('asset_id', assetIds)

          if (prioritiesError) {
            console.error(`❌ Error fetching priorities for workflow ${workflow.name}:`, prioritiesError)
          } else {
            workflowPriorities = priorities || []
          }
        }

        const assets = progressAssets

        if (assets) {
          workflowAssets[workflow.id] = assets.map(asset => {
            // Find the workflow-specific priority for this asset
            const workflowPriority = workflowPriorities.find(p => p.asset_id === asset.assets.id)

            // Calculate actual progress percentage based on current stage
            const currentStageIndex = stagePositions.get(asset.current_stage_key) ?? 0
            const stageProgressPercentage = Math.round((currentStageIndex / totalStages) * 100)

            // If asset is not started, progress should be 0, otherwise use stage-based calculation
            const progressPercentage = asset.is_started ? stageProgressPercentage : 0

            // Get the display name for the stage
            const stageDisplayName = workflowStages?.find(s => s.stage_key === asset.current_stage_key)?.stage_label
            const stageName = stageDisplayName || asset.current_stage_key || 'Not Started'

            return {
              id: asset.assets.id,
              symbol: asset.assets.symbol,
              company_name: asset.assets.company_name,
              stage: stageName,
              priority: workflowPriority?.priority || asset.assets.priority || 'medium',
              last_updated: asset.updated_at,
              progress_percentage: progressPercentage,
              is_started: asset.is_started
            }
          })
        }
      }

      console.log(`🎯 Final prioritizer data:`, {
        workflowCount: workflows?.length || 0,
        workflowAssets: Object.keys(workflowAssets).reduce((acc, key) => {
          acc[key] = workflowAssets[key].length
          return acc
        }, {} as Record<string, number>)
      })

      return { workflows: workflows || [], workflowAssets }
    },
    enabled: activeView === 'prioritizer',
    staleTime: 5000, // Reduced to 5 seconds for more frequent updates
    refetchOnWindowFocus: true, // Refetch when returning to the tab
    refetchOnMount: true, // Always refetch when component mounts
  })

  // Save state to TabStateManager whenever key state changes
  useEffect(() => {
    const stateToSave = {
      activeView,
      currentFeedIndex,
      selectedWorkflow,
      // Prioritizer state
      prioritizerView,
      sortBy,
      sortOrder,
      filterByStatus,
      filterByPriority,
      filterByStage
    }

    console.log('IdeaGeneratorPage: Saving state:', stateToSave)
    TabStateManager.saveTabState('idea-generator', stateToSave)
  }, [activeView, currentFeedIndex, selectedWorkflow, prioritizerView, sortBy, sortOrder, filterByStatus, filterByPriority, filterByStage])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close filter dropdown if clicking outside
      if (showFilterDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('.filter-dropdown')) {
          setShowFilterDropdown(false)
        }
      }
      // Close sort dropdown if clicking outside
      if (showSortDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('.sort-dropdown')) {
          setShowSortDropdown(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilterDropdown, showSortDropdown])

  // Generate idea tiles (existing logic)
  useEffect(() => {
    if (ideaData && activeView === 'discovery') {
      generateIdeaTiles()
    }
  }, [ideaData, activeView])

  // Refetch prioritizer data when switching to prioritizer view
  useEffect(() => {
    if (activeView === 'prioritizer') {
      refetchWorkflowData()
    }
  }, [activeView, refetchWorkflowData])

  const generateIdeaTiles = () => {
    if (!ideaData) return

    const newTiles: IdeaTile[] = []
    const maxTiles = 6

    // Add high-priority assets
    const highPriorityAssets = ideaData.assets.filter(a => a.priority === 'high').slice(0, 2)
    highPriorityAssets.forEach(asset => {
      newTiles.push({
        id: asset.id,
        type: 'asset',
        title: asset.symbol,
        subtitle: asset.company_name,
        content: `High priority asset that needs attention. Last updated ${formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}.`,
        priority: 'high',
        urgency: 'urgent',
        data: asset,
        color: 'bg-red-50 border-red-200',
        icon: <AlertTriangle className="w-5 h-5 text-red-600" />,
        actionText: 'Review Now'
      })
    })

    // Add recent notes from other users (prioritize collaborative content)
    const recentNotes = ideaData.notes.slice(0, 2)
    recentNotes.forEach(note => {
      newTiles.push({
        id: note.id,
        type: 'note',
        title: note.title,
        subtitle: note.source_name ? `${note.source_type}: ${note.source_name}` : note.source_type,
        content: note.content.substring(0, 100) + '...',
        priority: 'medium',
        urgency: 'normal',
        data: note,
        color: 'bg-blue-50 border-blue-200',
        icon: <FileText className="w-5 h-5 text-blue-600" />,
        actionText: 'Read More'
      })
    })

    // Add overdue price targets
    const overduePriceTargets = ideaData.priceTargets.filter(pt => {
      if (!pt.target_date) return false
      return new Date(pt.target_date) < new Date()
    }).slice(0, 1)

    overduePriceTargets.forEach(target => {
      newTiles.push({
        id: target.id,
        type: 'price_target',
        title: `${target.assets?.symbol} Price Target`,
        subtitle: target.assets?.company_name,
        content: `Target of $${target.target_price} was set for ${formatDistanceToNow(new Date(target.target_date), { addSuffix: true })}. Current price: $${target.assets?.current_price || 'N/A'}`,
        priority: 'high',
        urgency: 'urgent',
        data: target,
        color: 'bg-yellow-50 border-yellow-200',
        icon: <Target className="w-5 h-5 text-yellow-600" />,
        actionText: 'Update Target'
      })
    })

    // Fill remaining slots with insights and recent themes
    while (newTiles.length < maxTiles && ideaData.themes.length > 0) {
      const theme = ideaData.themes[newTiles.length - (maxTiles - ideaData.themes.length)]
      if (theme) {
        newTiles.push({
          id: theme.id,
          type: 'theme',
          title: theme.name,
          subtitle: 'Investment Theme',
          content: theme.description || 'Explore this investment theme and related opportunities.',
          priority: 'medium',
          urgency: 'normal',
          data: theme,
          color: 'bg-purple-50 border-purple-200',
          icon: <Tag className="w-5 h-5 text-purple-600" />,
          actionText: 'Explore Theme'
        })
      }
    }

    setTiles(newTiles.slice(0, maxTiles))
  }

  const handleShuffle = async () => {
    setIsShuffling(true)
    await refetch()
    setLastRefresh(new Date())
    setTimeout(() => setIsShuffling(false), 500)
  }

  const renderTabButton = (view: ViewType, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setActiveView(view)}
      className={clsx(
        'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
        activeView === view
          ? 'bg-primary-100 text-primary-700 border border-primary-200'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )

  const renderDiscoveryView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Discovery</h2>
          <p className="text-sm text-gray-600">
            Personalized insights and collaborative content that needs your attention
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="text-xs text-gray-500">
            Last updated: {formatDistanceToNow(lastRefresh, { addSuffix: true })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShuffle}
            disabled={isShuffling || isLoading}
            className="flex items-center space-x-2"
          >
            <RefreshCw className={clsx('w-4 h-4', isShuffling && 'animate-spin')} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-48 bg-gray-200 rounded-xl"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tiles.map((tile) => (
            <Card
              key={tile.id}
              className={clsx(
                'p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-105',
                tile.color,
                isShuffling && 'animate-pulse'
              )}
              onClick={() => onItemSelect?.(tile.data)}
            >
              <div className="flex items-start space-x-3 mb-4">
                {tile.icon}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{tile.title}</h3>
                  {tile.subtitle && (
                    <p className="text-sm text-gray-600 truncate">{tile.subtitle}</p>
                  )}
                </div>
                <div className="flex items-center space-x-1">
                  {tile.urgency === 'urgent' && (
                    <Badge variant="error" size="sm">Urgent</Badge>
                  )}
                  {tile.priority && (
                    <Badge
                      variant={tile.priority === 'high' ? 'error' : tile.priority === 'medium' ? 'warning' : 'default'}
                      size="sm"
                    >
                      {tile.priority}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-700 mb-4 line-clamp-3">{tile.content}</p>
              <div className="flex items-center justify-between">
                <Badge variant="outline" size="sm">{tile.type}</Badge>
                <span className="text-sm font-medium text-gray-900">{tile.actionText}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )

  // Filtering and sorting logic for prioritizer
  const filterAndSortAssets = (assets: WorkflowAsset[]) => {
    let filtered = assets

    // Filter by status (in-progress vs not-started)
    if (filterByStatus !== 'all') {
      filtered = filtered.filter(asset => {
        const isInProgress = asset.is_started
        return filterByStatus === 'in-progress' ? isInProgress : !isInProgress
      })
    }

    // Filter by priority
    if (filterByPriority !== 'all') {
      filtered = filtered.filter(asset => asset.priority === filterByPriority)
    }

    // Filter by stage
    if (filterByStage !== 'all') {
      filtered = filtered.filter(asset => asset.stage === filterByStage)
    }

    // Sort assets
    filtered.sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'priority':
          const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
          comparison = priorityOrder[b.priority as keyof typeof priorityOrder] - priorityOrder[a.priority as keyof typeof priorityOrder]
          break
        case 'stage':
          comparison = a.stage.localeCompare(b.stage)
          break
        case 'updated':
          comparison = new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
          break
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol)
          break
        case 'progress':
          comparison = b.progress_percentage - a.progress_percentage
          break
      }

      return sortOrder === 'desc' ? comparison : -comparison
    })

    return filtered
  }

  // Get all available stages for filtering
  const getAllStages = () => {
    const stages = new Set<string>()
    Object.values(workflowData?.workflowAssets || {}).forEach(assets => {
      assets.forEach(asset => stages.add(asset.stage))
    })
    return Array.from(stages).sort()
  }

  const renderPrioritizerView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Prioritizer</h2>
          <p className="text-sm text-gray-600">
            Workflow-based task management for all your active investments
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {/* View Selector */}
          <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setPrioritizerView('all')}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                prioritizerView === 'all'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              All
            </button>
            <button
              onClick={() => setPrioritizerView('in-progress')}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                prioritizerView === 'in-progress'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              In Progress
            </button>
            <button
              onClick={() => setPrioritizerView('by-stage')}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                prioritizerView === 'by-stage'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              By Stage
            </button>
            <button
              onClick={() => setPrioritizerView('by-priority')}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                prioritizerView === 'by-priority'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              By Priority
            </button>
          </div>

          {/* Filter Dropdown */}
          <div className="relative filter-dropdown">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className={clsx(
                filterByStatus !== 'all' || filterByPriority !== 'all' || filterByStage !== 'all'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : ''
              )}
            >
              <Filter className="w-4 h-4 mr-2" />
              Filter
              {(filterByStatus !== 'all' || filterByPriority !== 'all' || filterByStage !== 'all') && (
                <div className="w-2 h-2 bg-blue-500 rounded-full ml-1"></div>
              )}
            </Button>

            {showFilterDropdown && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Status</label>
                    <select
                      value={filterByStatus}
                      onChange={(e) => setFilterByStatus(e.target.value as any)}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All</option>
                      <option value="in-progress">In Progress</option>
                      <option value="not-started">Not Started</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Priority</label>
                    <select
                      value={filterByPriority}
                      onChange={(e) => setFilterByPriority(e.target.value as any)}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Priorities</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Stage</label>
                    <select
                      value={filterByStage}
                      onChange={(e) => setFilterByStage(e.target.value)}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Stages</option>
                      {getAllStages().map(stage => (
                        <option key={stage} value={stage}>{stage}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-between pt-2 border-t border-gray-200">
                    <button
                      onClick={() => {
                        setFilterByStatus('all')
                        setFilterByPriority('all')
                        setFilterByStage('all')
                      }}
                      className="text-xs text-gray-600 hover:text-gray-900"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={() => setShowFilterDropdown(false)}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sort Dropdown */}
          <div className="relative sort-dropdown">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSortDropdown(!showSortDropdown)}
            >
              <SortDesc className="w-4 h-4 mr-2" />
              Sort
            </Button>

            {showSortDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Sort By</label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="updated">Last Updated</option>
                      <option value="priority">Priority</option>
                      <option value="stage">Stage</option>
                      <option value="symbol">Symbol</option>
                      <option value="progress">Progress</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Order</label>
                    <select
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value as any)}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="desc">Descending</option>
                      <option value="asc">Ascending</option>
                    </select>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-gray-200">
                    <button
                      onClick={() => setShowSortDropdown(false)}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {workflowLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-12 bg-gray-200 rounded-lg mb-4"></div>
              <div className="space-y-2">
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="h-16 bg-gray-100 rounded-lg"></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Workflow Tabs */}
          <div className="flex space-x-2 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedWorkflow(null)}
              className={clsx(
                'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium whitespace-nowrap',
                selectedWorkflow === null
                  ? 'bg-primary-100 text-primary-700 border border-primary-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              )}
            >
              <Activity className="w-4 h-4" />
              <span>All Workflows</span>
            </button>
            {workflowData?.workflows.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() => setSelectedWorkflow(workflow.id)}
                className={clsx(
                  'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium whitespace-nowrap',
                  selectedWorkflow === workflow.id
                    ? 'bg-primary-100 text-primary-700 border border-primary-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                )}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: workflow.color }}
                />
                <span>{workflow.name}</span>
                <Badge variant="outline" size="sm">
                  {workflowData?.workflowAssets[workflow.id]?.length || 0}
                </Badge>
              </button>
            ))}
          </div>

          {/* Assets List */}
          <div className="space-y-4">
            {(() => {
              // Get all assets from selected workflow or all workflows
              const getAllAssets = () => {
                if (selectedWorkflow === null) {
                  // Combine all assets from all workflows
                  const allAssets = Object.values(workflowData?.workflowAssets || {}).flat()
                  return allAssets
                } else {
                  return workflowData?.workflowAssets[selectedWorkflow] || []
                }
              }

              const allAssets = getAllAssets()
              const filteredAndSortedAssets = filterAndSortAssets(allAssets)

              // Function to render asset item
              const renderAssetItem = (asset: WorkflowAsset, showWorkflow: boolean = false) => {
                // If we have a selected workflow, prioritize that workflow for the asset context
                let workflow
                if (selectedWorkflow && workflowData?.workflowAssets[selectedWorkflow]?.some(a => a.id === asset.id)) {
                  // Asset exists in the selected workflow, use that workflow
                  workflow = workflowData?.workflows.find(w => w.id === selectedWorkflow)
                } else {
                  // Fallback to finding any workflow that contains this asset
                  workflow = workflowData?.workflows.find(w =>
                    workflowData.workflowAssets[w.id]?.some(a => a.id === asset.id)
                  )
                }

                console.log(`🔍 IdeaGeneratorPage: renderAssetItem for ${asset.symbol}:`, {
                  assetId: asset.id,
                  selectedWorkflow,
                  foundWorkflow: workflow ? { id: workflow.id, name: workflow.name } : null,
                  allWorkflows: workflowData?.workflows.map(w => ({ id: w.id, name: w.name })),
                  usedSelectedWorkflow: selectedWorkflow && workflowData?.workflowAssets[selectedWorkflow]?.some(a => a.id === asset.id)
                })

                return (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      const assetData = {
                        ...asset,
                        workflow: workflow,
                        workflow_id: workflow?.id
                      }
                      console.log(`🎯 IdeaGeneratorPage: Clicking on asset ${asset.symbol} with workflow context:`, {
                        assetSymbol: asset.symbol,
                        workflowName: workflow?.name,
                        workflowId: workflow?.id,
                        fullAssetData: assetData
                      })
                      onItemSelect?.({
                        id: asset.id,
                        title: asset.symbol,
                        type: 'asset',
                        data: assetData
                      })
                    }}
                  >
                    <div className="flex items-center space-x-3">
                      <TrendingUp className="w-4 h-4 text-gray-600" />
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">{asset.symbol}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              priorityConfig[asset.priority as keyof typeof priorityConfig]?.color || priorityConfig['medium'].color
                            }`}
                          >
                            {priorityConfig[asset.priority as keyof typeof priorityConfig]?.label || asset.priority}
                          </span>
                          {showWorkflow && workflow && (
                            <div className="flex items-center space-x-1">
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: workflow.color }}
                              />
                              <span className="text-xs text-gray-500">{workflow.name}</span>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{asset.company_name}</p>
                        <div className="flex items-center space-x-4 mt-1">
                          <div className="text-xs text-gray-500">
                            Progress: {asset.progress_percentage}%
                          </div>
                          <div className="text-xs text-gray-500">
                            Stage: {asset.stage}
                          </div>
                          <div className="text-xs text-gray-500">
                            Updated {formatDistanceToNow(new Date(asset.last_updated), { addSuffix: true })}
                          </div>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                )
              }

              // Render based on prioritizer view
              if (prioritizerView === 'all') {
                // Show all assets in a single list
                return (
                  <Card className="p-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900">
                          {selectedWorkflow === null ? 'All Assets' : workflowData?.workflows.find(w => w.id === selectedWorkflow)?.name}
                        </h3>
                        <Badge variant="outline" size="sm">{filteredAndSortedAssets.length} assets</Badge>
                      </div>
                      <div className="space-y-2">
                        {filteredAndSortedAssets.map((asset) => renderAssetItem(asset, selectedWorkflow === null))}
                      </div>
                    </div>
                  </Card>
                )
              } else if (prioritizerView === 'in-progress') {
                // Show both in-progress and not-started assets in separate sections
                const inProgressAssets = filteredAndSortedAssets.filter(asset => asset.is_started)
                const notStartedAssets = filteredAndSortedAssets.filter(asset => !asset.is_started)

                // Debug: Log AAPL and ZOOM specifically
                const debugAssets = filteredAndSortedAssets.filter(asset =>
                  asset.symbol === 'AAPL' || asset.symbol === 'ZOOM'
                )
                if (debugAssets.length > 0) {
                  console.log('🔍 AAPL/ZOOM Debug:', debugAssets.map(asset => ({
                    symbol: asset.symbol,
                    is_started: asset.is_started,
                    stage: asset.stage,
                    progress_percentage: asset.progress_percentage
                  })))
                }

                return (
                  <div className="space-y-4">
                    {/* In Progress Section */}
                    <Card className="p-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-gray-900">In Progress</h3>
                          <Badge variant="outline" size="sm">{inProgressAssets.length} assets</Badge>
                        </div>
                        <div className="space-y-2">
                          {inProgressAssets.map((asset) => renderAssetItem(asset, selectedWorkflow === null))}
                        </div>
                        {inProgressAssets.length === 0 && (
                          <div className="text-center py-8 text-gray-500">
                            No assets in progress
                          </div>
                        )}
                      </div>
                    </Card>

                    {/* Not Started Section */}
                    <Card className="p-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-gray-900">Not Started</h3>
                          <Badge variant="outline" size="sm">{notStartedAssets.length} assets</Badge>
                        </div>
                        <div className="space-y-2">
                          {notStartedAssets.map((asset) => renderAssetItem(asset, selectedWorkflow === null))}
                        </div>
                        {notStartedAssets.length === 0 && (
                          <div className="text-center py-8 text-gray-500">
                            No assets waiting to start
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>
                )
              } else if (prioritizerView === 'by-stage') {
                // Group assets by stage
                const groupedByStage = filteredAndSortedAssets.reduce((acc, asset) => {
                  const stage = asset.stage
                  if (!acc[stage]) acc[stage] = []
                  acc[stage].push(asset)
                  return acc
                }, {} as Record<string, WorkflowAsset[]>)

                return (
                  <div className="space-y-4">
                    {Object.entries(groupedByStage).map(([stage, stageAssets]) => (
                      <Card key={stage} className="p-6">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-gray-900">{stage}</h3>
                            <Badge variant="outline" size="sm">{stageAssets.length} assets</Badge>
                          </div>
                          <div className="space-y-2">
                            {stageAssets.map((asset) => renderAssetItem(asset, selectedWorkflow === null))}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )
              } else if (prioritizerView === 'by-priority') {
                // Group assets by priority
                const groupedByPriority = filteredAndSortedAssets.reduce((acc, asset) => {
                  const priority = asset.priority
                  if (!acc[priority]) acc[priority] = []
                  acc[priority].push(asset)
                  return acc
                }, {} as Record<string, WorkflowAsset[]>)

                // Sort priority groups by importance
                const priorityOrder = ['critical', 'high', 'medium', 'low']
                return (
                  <div className="space-y-4">
                    {priorityOrder.map(priority => {
                      const priorityAssets = groupedByPriority[priority]
                      if (!priorityAssets || priorityAssets.length === 0) return null

                      const PriorityIcon = priorityConfig[priority as keyof typeof priorityConfig]?.icon || Clock

                      return (
                        <Card key={priority} className="p-6">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <PriorityIcon className="w-4 h-4" />
                                <h3 className="font-semibold text-gray-900 capitalize">
                                  {priorityConfig[priority as keyof typeof priorityConfig]?.label || priority} Priority
                                </h3>
                              </div>
                              <Badge
                                variant={priority === 'critical' || priority === 'high' ? 'error' : priority === 'medium' ? 'warning' : 'default'}
                                size="sm"
                              >
                                {priorityAssets.length} assets
                              </Badge>
                            </div>
                            <div className="space-y-2">
                              {priorityAssets.map((asset) => renderAssetItem(asset, selectedWorkflow === null))}
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                )
              }

              // Fallback to showing all assets
              return (
                <Card className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900">All Assets</h3>
                      <Badge variant="outline" size="sm">{filteredAndSortedAssets.length} assets</Badge>
                    </div>
                    <div className="space-y-2">
                      {filteredAndSortedAssets.map((asset) => renderAssetItem(asset, selectedWorkflow === null))}
                    </div>
                  </div>
                </Card>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )

  const renderFeedView = () => (
    <div className="max-w-md mx-auto space-y-1 bg-black rounded-xl overflow-hidden" style={{ height: '600px' }}>
      {/* Feed Header */}
      <div className="flex items-center justify-between p-4 bg-black text-white">
        <div className="flex items-center space-x-3">
          <Brain className="w-6 h-6 text-blue-400" />
          <span className="font-semibold">AI Insights</span>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="sm" className="text-white hover:bg-gray-800">
            <Search className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-gray-800">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Current Content */}
      <div className="relative h-full bg-gradient-to-br from-blue-900 to-purple-900 text-white overflow-hidden">
        {(() => {
          const content = sampleFeedContent[currentFeedIndex]
          if (!content) return null

          const getTypeIcon = (type: string) => {
            switch (type) {
              case 'market_insight': return <BarChart3 className="w-5 h-5" />
              case 'research_tip': return <Lightbulb className="w-5 h-5" />
              case 'portfolio_alert': return <Bell className="w-5 h-5" />
              case 'trend_analysis': return <TrendingUp className="w-5 h-5" />
              case 'educational': return <Award className="w-5 h-5" />
              default: return <Zap className="w-5 h-5" />
            }
          }

          const getTypeColor = (type: string) => {
            switch (type) {
              case 'market_insight': return 'text-green-400'
              case 'research_tip': return 'text-yellow-400'
              case 'portfolio_alert': return 'text-red-400'
              case 'trend_analysis': return 'text-blue-400'
              case 'educational': return 'text-purple-400'
              default: return 'text-white'
            }
          }

          return (
            <div className="p-6 h-full flex flex-col justify-between">
              {/* Content */}
              <div className="space-y-6">
                <div className="flex items-center space-x-2">
                  <div className={getTypeColor(content.type)}>
                    {getTypeIcon(content.type)}
                  </div>
                  <span className="text-sm font-medium capitalize text-gray-300">
                    {content.type.replace('_', ' ')}
                  </span>
                </div>

                <div>
                  <h2 className="text-2xl font-bold mb-4 leading-tight">{content.title}</h2>
                  <p className="text-lg leading-relaxed opacity-90">{content.content}</p>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-2">
                  {content.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-white bg-opacity-20 rounded-full text-sm font-medium"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Interaction Bar */}
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm text-gray-300">
                  <span>By {content.author}</span>
                  <span>{content.timestamp}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-6">
                    <button className="flex items-center space-x-2 text-white hover:text-red-400">
                      <Heart className="w-5 h-5" />
                      <span>{content.likes}</span>
                    </button>
                    <button className="flex items-center space-x-2 text-white hover:text-blue-400">
                      <MessageSquare className="w-5 h-5" />
                      <span>{content.comments}</span>
                    </button>
                    <button className="flex items-center space-x-2 text-white hover:text-green-400">
                      <Share2 className="w-5 h-5" />
                      <span>{content.shares}</span>
                    </button>
                  </div>
                  <button className="text-white hover:text-yellow-400">
                    <Bookmark className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Navigation */}
        <div className="absolute inset-y-0 left-0 w-1/3" onClick={() => {
          setCurrentFeedIndex(prev => prev > 0 ? prev - 1 : sampleFeedContent.length - 1)
        }}></div>
        <div className="absolute inset-y-0 right-0 w-1/3" onClick={() => {
          setCurrentFeedIndex(prev => prev < sampleFeedContent.length - 1 ? prev + 1 : 0)
        }}></div>

        {/* Progress indicators */}
        <div className="absolute top-4 left-4 right-4 flex space-x-1">
          {sampleFeedContent.map((_, index) => (
            <div
              key={index}
              className={clsx(
                'h-0.5 flex-1 rounded-full',
                index === currentFeedIndex ? 'bg-white' : 'bg-white bg-opacity-30'
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center space-x-3">
          <Lightbulb className="w-7 h-7 text-primary-600" />
          <span>Ideas</span>
        </h1>
        <p className="text-gray-600 mt-1">
          Discover insights, prioritize tasks, and stay informed with AI-powered content
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-2 border-b border-gray-200 pb-4">
        {renderTabButton('discovery', <Shuffle className="w-4 h-4" />, 'Discovery')}
        {renderTabButton('prioritizer', <List className="w-4 h-4" />, 'Prioritizer')}
        {renderTabButton('feed', <Activity className="w-4 h-4" />, 'Feed')}
      </div>

      {/* View Content */}
      {activeView === 'discovery' && renderDiscoveryView()}
      {activeView === 'prioritizer' && renderPrioritizerView()}
      {activeView === 'feed' && renderFeedView()}
    </div>
  )
}