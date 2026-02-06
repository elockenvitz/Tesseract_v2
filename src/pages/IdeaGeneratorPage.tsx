import { useState, useCallback, useEffect } from 'react'
import {
  Lightbulb, Shuffle, Activity, RefreshCw, Search, Filter, X, User, Users, Globe, UserCheck
} from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../components/ui/Button'
import { MasonryGrid } from '../components/ideas/MasonryGrid'
import { ReelsFeed } from '../components/feed/ReelsFeed'
import { ShareToUserModal } from '../components/feed/ShareToUserModal'
import { QuickThoughtCapture } from '../components/thoughts/QuickThoughtCapture'
import { PromoteToTradeIdeaModal } from '../components/ideas/PromoteToTradeIdeaModal'
import { useDiscoveryFeed, type FeedFilters, type ItemType, type ScoredFeedItem } from '../hooks/ideas'
import { useQuickThoughtsFeed } from '../hooks/useQuickThoughtsFeed'
import { useTradeExpressionCounts } from '../hooks/useTradeExpressionCounts'
import { useAuth } from '../hooks/useAuth'
import {
  useIdeasRouting,
  mapTimeRangeToFeedFilter,
  mapTypeToFeedFilter,
  type IdeasScope,
  type IdeasTypeFilter,
  type IdeasTimeRange,
  type IdeasInitialFilters,
} from '../hooks/useIdeasRouting'

// ============================================================================
// IDEAS GENERATOR PAGE
// URL-driven filtering with deep-link support
// URL is the source of truth for all filter state
// ============================================================================

interface IdeaGeneratorPageProps {
  onItemSelect?: (item: any) => void
  /** Initial filters passed from tab data (e.g., from "View all" navigation) */
  initialFilters?: IdeasInitialFilters
}

// Filter option configs
const filterOptions: { value: IdeasTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'quick_thought', label: 'Thoughts' },
  { value: 'trade_idea', label: 'Trades' },
  { value: 'note', label: 'Notes' },
  { value: 'thesis_update', label: 'Thesis' },
  { value: 'insight', label: 'Insights' }
]

const timeRangeOptions: { value: IdeasTimeRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' }
]

const scopeOptions: { value: IdeasScope; label: string; icon: typeof User }[] = [
  { value: 'mine', label: 'Mine', icon: User },
  { value: 'team', label: 'Team', icon: Users },
  { value: 'following', label: 'Following', icon: UserCheck },
  { value: 'all', label: 'All', icon: Globe },
]

export function IdeaGeneratorPage({ onItemSelect, initialFilters }: IdeaGeneratorPageProps) {
  // ============================================================================
  // TAB STATE (source of truth)
  // Filter state persisted via TabStateManager
  // Supports initial filters from tab data for deep-linking
  // ============================================================================
  const {
    typeFilter,
    scope,
    view,
    timeRange,
    sort,
    assetId,
    portfolioId,
    themeId,
    hasActiveFilters,
    isQuickThoughtsView,
    setTypeFilter,
    setScope,
    setView,
    setTimeRange,
    clearContextFilters,
    resetFilters,
  } = useIdeasRouting(initialFilters)

  // Get current user for edit permissions
  const { user } = useAuth()

  // ============================================================================
  // LOCAL UI STATE (not persisted to URL)
  // ============================================================================
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [itemToShare, setItemToShare] = useState<ScoredFeedItem | null>(null)
  const [createIdeaModalOpen, setCreateIdeaModalOpen] = useState(false)
  const [itemForNewIdea, setItemForNewIdea] = useState<ScoredFeedItem | null>(null)
  const [promoteModalOpen, setPromoteModalOpen] = useState(false)
  const [itemToPromote, setItemToPromote] = useState<ScoredFeedItem | null>(null)

  // ============================================================================
  // DATA FETCHING
  // Use optimized Quick Thoughts query when type=quick_thought,
  // otherwise use general discovery feed
  // ============================================================================

  // Build filters for general feed
  const feedFilters: FeedFilters = {
    types: mapTypeToFeedFilter(typeFilter) as ItemType[] | undefined,
    timeRange: mapTimeRangeToFeedFilter(timeRange),
    assets: assetId ? [assetId] : undefined,
    // Note: scope filtering is handled differently in the general feed
    // The unified feed doesn't support scope, so we use the Quick Thoughts feed for that
  }

  // General discovery feed (for non-quick_thought views)
  const {
    items: discoveryItems,
    isLoading: discoveryLoading,
    refetch: refetchDiscovery
  } = useDiscoveryFeed(feedFilters)

  // Optimized Quick Thoughts feed (when type=quick_thought)
  const {
    items: quickThoughtItems,
    isLoading: quickThoughtsLoading,
    refetch: refetchQuickThoughts,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useQuickThoughtsFeed({
    scope,
    timeRange,
    assetId,
    portfolioId,
    themeId,
    enabled: isQuickThoughtsView,
  })

  // Select which items to show
  const items = isQuickThoughtsView ? quickThoughtItems : discoveryItems
  const isLoading = isQuickThoughtsView ? quickThoughtsLoading : discoveryLoading
  const refetch = isQuickThoughtsView ? refetchQuickThoughts : refetchDiscovery

  // Get lab inclusions for trade ideas
  const { data: labInclusionsMap } = useTradeExpressionCounts()

  // ============================================================================
  // FILTER ITEMS BY SEARCH QUERY (client-side)
  // ============================================================================
  const filteredItems = searchQuery
    ? items.filter(item =>
        item.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ('title' in item && (item as any).title?.toLowerCase().includes(searchQuery.toLowerCase())) ||
        item.author?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleLabClick = useCallback((labId: string, labName: string, portfolioId: string) => {
    window.dispatchEvent(new CustomEvent('openTradeLab', {
      detail: { labId, labName, portfolioId }
    }))
  }, [])

  // Handle item click - open sidebar for quick_thoughts, navigate for others
  const handleItemClick = useCallback((item: ScoredFeedItem) => {
    // Quick thoughts open in the main Quick Ideas sidebar
    if (item.type === 'quick_thought') {
      window.dispatchEvent(new CustomEvent('openThoughtDetail', {
        detail: { thoughtId: item.id }
      }))
      return
    }

    // Other item types navigate to their context
    let navigationData
    switch (item.type) {
      case 'trade_idea':
        if ('asset' in item && item.asset) {
          navigationData = {
            id: item.asset.id,
            title: item.asset.symbol,
            type: 'asset',
            data: item.asset
          }
        }
        break

      case 'note':
        if ('source' in item && item.source) {
          navigationData = {
            id: item.source.id,
            title: item.source.name,
            type: item.source.type,
            data: item.source
          }
        }
        break

      case 'thesis_update':
        if ('asset' in item && item.asset) {
          const section = 'section' in item ? item.section : undefined
          navigationData = {
            id: item.asset.id,
            title: item.asset.symbol,
            type: 'asset',
            data: { ...item.asset, scrollToSection: section }
          }
        }
        break

      default:
        navigationData = {
          id: item.id,
          title: 'title' in item ? item.title : 'Idea',
          type: item.type,
          data: item
        }
    }

    if (navigationData) {
      onItemSelect?.(navigationData)
    }
  }, [onItemSelect])

  const handleAssetClick = useCallback((assetId: string, symbol: string) => {
    onItemSelect?.({
      id: assetId,
      title: symbol,
      type: 'asset',
      data: { id: assetId, symbol }
    })
  }, [onItemSelect])

  const handleAuthorClick = useCallback((authorId: string) => {
    console.log('Author clicked:', authorId)
  }, [])

  const handleOpenFullChart = useCallback((symbol: string) => {
    onItemSelect?.({
      id: 'charting',
      title: 'Charting',
      type: 'charting',
      data: { symbol }
    })
  }, [onItemSelect])

  const handleShare = useCallback((item: ScoredFeedItem) => {
    setItemToShare(item)
    setShareModalOpen(true)
  }, [])

  const handleCreateIdea = useCallback((item: ScoredFeedItem) => {
    setItemForNewIdea(item)
    setCreateIdeaModalOpen(true)
  }, [])

  const handlePortfolioClick = useCallback((portfolioId: string) => {
    onItemSelect?.({
      id: portfolioId,
      title: 'Portfolio',
      type: 'portfolio',
      data: { id: portfolioId }
    })
  }, [onItemSelect])

  const handleSourceClick = useCallback((sourceId: string, sourceType: string, sourceName?: string) => {
    onItemSelect?.({
      id: sourceId,
      title: sourceName || (sourceType === 'asset' ? 'Asset' : sourceType === 'portfolio' ? 'Portfolio' : sourceType === 'theme' ? 'Theme' : 'Notebook'),
      type: sourceType === 'notebook' ? 'custom_notebook' : sourceType,
      data: { id: sourceId, symbol: sourceName }
    })
  }, [onItemSelect])

  const handleNavigateToTradeIdea = useCallback((tradeIdeaId: string) => {
    // TODO: Open trade idea modal or navigate to trade queue
    console.log('Navigate to trade idea:', tradeIdeaId)
  }, [])

  // Get prefill data for create idea modal
  const getCreateIdeaPrefill = () => {
    if (!itemForNewIdea) return {}
    const asset = 'asset' in itemForNewIdea && itemForNewIdea.asset ? itemForNewIdea.asset : null
    const noteSource = itemForNewIdea.type === 'note' && 'source' in itemForNewIdea ? (itemForNewIdea as any).source : null
    return {
      assetId: asset?.id || noteSource?.id,
      content: itemForNewIdea.content?.substring(0, 500) || ''
    }
  }

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const renderViewToggle = () => (
    <div className="flex space-x-1 bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => setView('discovery')}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          view === 'discovery'
            ? 'bg-white text-primary-700 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        )}
      >
        <Shuffle className="w-4 h-4" />
        <span>Discovery</span>
      </button>
      <button
        onClick={() => setView('feed')}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          view === 'feed'
            ? 'bg-white text-primary-700 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        )}
      >
        <Activity className="w-4 h-4" />
        <span>Feed</span>
      </button>
    </div>
  )

  const renderScopeSelector = () => (
    <div className="flex items-center gap-1">
      {scopeOptions.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            onClick={() => setScope(option.value)}
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors',
              scope === option.value
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <Icon className="h-3 w-3" />
            {option.label}
          </button>
        )
      })}
    </div>
  )

  const renderContextBadges = () => {
    if (!assetId && !portfolioId && !themeId) return null
    return (
      <div className="flex items-center gap-2">
        {/* Context badges would show asset/portfolio/theme names */}
        {(assetId || portfolioId || themeId) && (
          <button
            onClick={clearContextFilters}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear context
          </button>
        )}
      </div>
    )
  }

  // ============================================================================
  // FEED VIEW
  // ============================================================================
  if (view === 'feed') {
    return (
      <div className="h-full flex">
        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between flex-shrink-0 mb-3">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Lightbulb className="w-6 h-6 text-primary-600" />
                <span>Ideas</span>
              </h1>
              {renderViewToggle()}
            </div>
          </div>

          {/* Feed */}
          <div className="flex-1 min-h-0 rounded-xl overflow-hidden">
            <ReelsFeed
              filters={feedFilters}
              onItemClick={handleItemClick}
              onAuthorClick={handleAuthorClick}
              onAssetClick={handleAssetClick}
              onOpenFullChart={handleOpenFullChart}
              onShare={handleShare}
              onCreateIdea={handleCreateIdea}
            />
          </div>
        </div>

        {/* Modals */}
        {itemToShare && (
          <ShareToUserModal
            isOpen={shareModalOpen}
            onClose={() => {
              setShareModalOpen(false)
              setItemToShare(null)
            }}
            item={itemToShare}
          />
        )}
      </div>
    )
  }

  // ============================================================================
  // DISCOVERY VIEW
  // ============================================================================
  return (
    <div className="h-full flex">
      {/* Main content - pt-1 gives room for focus rings */}
      <div className="flex-1 space-y-4 overflow-auto pt-1">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Lightbulb className="w-6 h-6 text-primary-600" />
              <span>Ideas</span>
            </h1>
            {renderViewToggle()}
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(showFilters && 'bg-gray-100')}
            >
              <Filter className="w-4 h-4 mr-1" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 w-2 h-2 bg-primary-500 rounded-full" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="space-y-3">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search ideas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          {showFilters && (
            <div className="flex flex-wrap gap-3 p-3 bg-gray-50 rounded-lg">
              {/* Type filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">Type:</span>
                {filterOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setTypeFilter(option.value)}
                    className={clsx(
                      'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                      typeFilter === option.value
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="w-px h-6 bg-gray-300" />

              {/* Time filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">Time:</span>
                {timeRangeOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setTimeRange(option.value)}
                    className={clsx(
                      'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                      timeRange === option.value
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {/* Scope filter - only show for Quick Thoughts view */}
              {isQuickThoughtsView && (
                <>
                  <div className="w-px h-6 bg-gray-300" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500">Scope:</span>
                    {renderScopeSelector()}
                  </div>
                </>
              )}

              {/* Context badges */}
              {renderContextBadges()}

              {/* Clear all filters */}
              {hasActiveFilters && (
                <>
                  <div className="w-px h-6 bg-gray-300" />
                  <button
                    onClick={resetFilters}
                    className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Clear all
                  </button>
                </>
              )}
            </div>
          )}

          {/* Results count */}
          {searchQuery && (
            <p className="text-sm text-gray-600">
              Found {filteredItems.length} {filteredItems.length === 1 ? 'result' : 'results'}
              {searchQuery && ` for "${searchQuery}"`}
            </p>
          )}
        </div>

        {/* Masonry Grid */}
        <MasonryGrid
          items={filteredItems as ScoredFeedItem[]}
          onItemClick={handleItemClick}
          onAuthorClick={handleAuthorClick}
          onAssetClick={handleAssetClick}
          onPortfolioClick={handlePortfolioClick}
          onLabClick={handleLabClick}
          onSourceClick={handleSourceClick}
          labInclusionsMap={labInclusionsMap}
          isLoading={isLoading}
          showReactions
          showBookmarks
          showCharts
          // New UX spec props
          scope={scope}
          isFilteredToSingleType={typeFilter !== 'all'}
          currentUserId={user?.id}
          onPromote={(item) => {
            setItemToPromote(item)
            setPromoteModalOpen(true)
          }}
          onPromotedClick={handleNavigateToTradeIdea}
        />

        {/* Load more for Quick Thoughts infinite scroll */}
        {isQuickThoughtsView && hasNextPage && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredItems.length === 0 && (
          <div className="text-center py-12">
            <Lightbulb className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {searchQuery ? 'No results found' : isQuickThoughtsView ? 'No Quick Thoughts yet' : 'No ideas yet'}
            </h3>
            <p className="text-gray-600 mb-4">
              {searchQuery
                ? `No ideas match your search for "${searchQuery}"`
                : isQuickThoughtsView
                  ? hasActiveFilters
                    ? 'No Quick Thoughts match your filters.'
                    : 'No Quick Thoughts yet. Capture one from the sidebar.'
                  : 'Start by adding research notes, trade ideas, or quick thoughts'}
            </p>
            {searchQuery && (
              <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                Clear search
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {itemToShare && (
        <ShareToUserModal
          isOpen={shareModalOpen}
          onClose={() => {
            setShareModalOpen(false)
            setItemToShare(null)
          }}
          item={itemToShare}
        />
      )}

      {createIdeaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setCreateIdeaModalOpen(false)
              setItemForNewIdea(null)
            }}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Create New Idea</h3>
              <button
                onClick={() => {
                  setCreateIdeaModalOpen(false)
                  setItemForNewIdea(null)
                }}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <QuickThoughtCapture
                initialContent={getCreateIdeaPrefill().content}
                initialAssetId={getCreateIdeaPrefill().assetId}
                onSuccess={() => {
                  setCreateIdeaModalOpen(false)
                  setItemForNewIdea(null)
                  refetch()
                }}
                onCancel={() => {
                  setCreateIdeaModalOpen(false)
                  setItemForNewIdea(null)
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Promote to Trade Idea Modal */}
      {itemToPromote && (
        <PromoteToTradeIdeaModal
          isOpen={promoteModalOpen}
          onClose={() => {
            setPromoteModalOpen(false)
            setItemToPromote(null)
          }}
          onSuccess={() => {
            setPromoteModalOpen(false)
            setItemToPromote(null)
            refetch()
          }}
          quickThoughtId={itemToPromote.id}
          quickThoughtContent={itemToPromote.content}
          assetId={itemToPromote.asset?.id}
          assetSymbol={itemToPromote.asset?.symbol}
          portfolioId={(itemToPromote as any).portfolio?.id}
          portfolioName={(itemToPromote as any).portfolio?.name}
          visibility={(itemToPromote as any).visibility}
        />
      )}
    </div>
  )
}

export default IdeaGeneratorPage
