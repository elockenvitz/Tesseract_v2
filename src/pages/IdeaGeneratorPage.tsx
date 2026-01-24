import { useState, useEffect } from 'react'
import {
  Lightbulb, Shuffle, Activity, RefreshCw, Search, Filter, X
} from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { MasonryGrid } from '../components/ideas/MasonryGrid'
import { ReelsFeed } from '../components/feed/ReelsFeed'
import { ShareToUserModal } from '../components/feed/ShareToUserModal'
import { QuickThoughtCapture } from '../components/thoughts/QuickThoughtCapture'
import { useDiscoveryFeed, type FeedFilters, type ItemType, type ScoredFeedItem } from '../hooks/ideas'
import { TabStateManager } from '../lib/tabStateManager'

interface IdeaGeneratorPageProps {
  onItemSelect?: (item: any) => void
}

type ViewType = 'discovery' | 'feed'

const filterOptions: { value: ItemType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'quick_thought', label: 'Thoughts' },
  { value: 'trade_idea', label: 'Trades' },
  { value: 'note', label: 'Notes' },
  { value: 'thesis_update', label: 'Thesis' },
  { value: 'insight', label: 'Insights' }
]

const timeRangeOptions: { value: FeedFilters['timeRange']; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' }
]

export function IdeaGeneratorPage({ onItemSelect }: IdeaGeneratorPageProps) {
  // Load initial state from TabStateManager
  const loadedState = TabStateManager.loadTabState('idea-generator')

  const [activeView, setActiveView] = useState<ViewType>(loadedState?.activeView || 'discovery')
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all')
  const [timeRange, setTimeRange] = useState<FeedFilters['timeRange']>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [itemToShare, setItemToShare] = useState<ScoredFeedItem | null>(null)
  const [createIdeaModalOpen, setCreateIdeaModalOpen] = useState(false)
  const [itemForNewIdea, setItemForNewIdea] = useState<ScoredFeedItem | null>(null)

  // Build filters object
  const filters: FeedFilters = {
    types: typeFilter === 'all' ? undefined : [typeFilter],
    timeRange
  }

  // Fetch data using hooks
  const {
    items: discoveryItems,
    isLoading: discoveryLoading,
    refetch: refetchDiscovery
  } = useDiscoveryFeed(filters)

  // Filter items by search query
  const filteredDiscoveryItems = searchQuery
    ? discoveryItems.filter(item =>
        item.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ('title' in item && item.title?.toLowerCase().includes(searchQuery.toLowerCase())) ||
        item.author.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : discoveryItems

  // Save state to TabStateManager
  useEffect(() => {
    TabStateManager.saveTabState('idea-generator', {
      activeView,
      typeFilter,
      timeRange
    })
  }, [activeView, typeFilter, timeRange])

  // Handle item click - navigate to the relevant page
  const handleItemClick = (item: ScoredFeedItem) => {
    let navigationData

    switch (item.type) {
      case 'quick_thought':
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
          // Include section info for navigation to specific thesis section
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
  }

  const handleAssetClick = (assetId: string, symbol: string) => {
    onItemSelect?.({
      id: assetId,
      title: symbol,
      type: 'asset',
      data: { id: assetId, symbol }
    })
  }

  const handleAuthorClick = (authorId: string) => {
    // Could navigate to author profile or filter by author
    console.log('Author clicked:', authorId)
  }

  const handleOpenFullChart = (symbol: string) => {
    // Navigate to the charting tab with this symbol
    // Using id 'charting' ensures we reuse the same charting tab
    // The symbol is passed in data and will be added as a new panel
    onItemSelect?.({
      id: 'charting',
      title: 'Charting',
      type: 'charting',
      data: { symbol }
    })
  }

  const handleShare = (item: ScoredFeedItem) => {
    setItemToShare(item)
    setShareModalOpen(true)
  }

  const handleCreateIdea = (item: ScoredFeedItem) => {
    setItemForNewIdea(item)
    setCreateIdeaModalOpen(true)
  }

  // Get prefill data for create idea modal
  const getCreateIdeaPrefill = () => {
    if (!itemForNewIdea) return {}
    const asset = 'asset' in itemForNewIdea && itemForNewIdea.asset ? itemForNewIdea.asset : null
    const noteSource = itemForNewIdea.type === 'note' && 'source' in itemForNewIdea ? itemForNewIdea.source : null
    return {
      assetId: asset?.id || noteSource?.id,
      content: itemForNewIdea.content?.substring(0, 500) || ''
    }
  }

  const handlePortfolioClick = (portfolioId: string) => {
    onItemSelect?.({
      id: portfolioId,
      title: 'Portfolio',
      type: 'portfolio',
      data: { id: portfolioId }
    })
  }

  const handleSourceClick = (sourceId: string, sourceType: string, sourceName?: string) => {
    onItemSelect?.({
      id: sourceId,
      title: sourceName || (sourceType === 'asset' ? 'Asset' : sourceType === 'portfolio' ? 'Portfolio' : sourceType === 'theme' ? 'Theme' : 'Notebook'),
      type: sourceType === 'notebook' ? 'custom_notebook' : sourceType,
      data: { id: sourceId, symbol: sourceName }
    })
  }

  const renderTabButton = (view: ViewType, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setActiveView(view)}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
        activeView === view
          ? 'bg-white text-primary-700 shadow-sm'
          : 'text-gray-600 hover:text-gray-900'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )

  // When in feed mode, we need the container to fill available height without scroll
  if (activeView === 'feed') {
    return (
      <>
        <div className="h-full flex flex-col overflow-hidden">
          {/* Header with Tab Navigation */}
          <div className="flex items-center justify-between flex-shrink-0 mb-3">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Lightbulb className="w-6 h-6 text-primary-600" />
                <span>Ideas</span>
              </h1>
              <div className="flex space-x-1 bg-gray-100 rounded-lg p-0.5">
                {renderTabButton('discovery', <Shuffle className="w-4 h-4" />, 'Discovery')}
                {renderTabButton('feed', <Activity className="w-4 h-4" />, 'Feed')}
              </div>
            </div>
          </div>

          {/* Feed takes remaining space */}
          <div className="flex-1 min-h-0 rounded-xl overflow-hidden">
            <ReelsFeed
              filters={filters}
              onItemClick={handleItemClick}
              onAuthorClick={handleAuthorClick}
              onAssetClick={handleAssetClick}
              onOpenFullChart={handleOpenFullChart}
              onShare={handleShare}
              onCreateIdea={handleCreateIdea}
            />
          </div>
        </div>

        {/* Share Modal */}
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

        {/* Create Idea Modal */}
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
                    refetchDiscovery()
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
      </>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with Tab Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Lightbulb className="w-6 h-6 text-primary-600" />
            <span>Ideas</span>
          </h1>
          <div className="flex space-x-1 bg-gray-100 rounded-lg p-0.5">
            {renderTabButton('discovery', <Shuffle className="w-4 h-4" />, 'Discovery')}
            {renderTabButton('feed', <Activity className="w-4 h-4" />, 'Feed')}
          </div>
        </div>

        {activeView === 'discovery' && (
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(showFilters && 'bg-gray-100')}
            >
              <Filter className="w-4 h-4 mr-1" />
              Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchDiscovery()}
              disabled={discoveryLoading}
            >
              <RefreshCw className={clsx('w-4 h-4', discoveryLoading && 'animate-spin')} />
            </Button>
          </div>
        )}
      </div>

      {/* Discovery View */}
      {activeView === 'discovery' && (
        <div className="space-y-4">
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
              <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg">
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

                <div className="w-px h-6 bg-gray-300 mx-2" />

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
              </div>
            )}

            {/* Results count */}
            {searchQuery && (
              <p className="text-sm text-gray-600">
                Found {filteredDiscoveryItems.length} {filteredDiscoveryItems.length === 1 ? 'result' : 'results'}
                {searchQuery && ` for "${searchQuery}"`}
              </p>
            )}
          </div>

          {/* Masonry Grid */}
          <MasonryGrid
            items={filteredDiscoveryItems}
            onAuthorClick={handleAuthorClick}
            onAssetClick={handleAssetClick}
            onPortfolioClick={handlePortfolioClick}
            onSourceClick={handleSourceClick}
            isLoading={discoveryLoading}
            showReactions
            showBookmarks
            showCharts
          />

          {/* Empty state */}
          {!discoveryLoading && filteredDiscoveryItems.length === 0 && (
            <div className="text-center py-12">
              <Lightbulb className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {searchQuery ? 'No results found' : 'No ideas yet'}
              </h3>
              <p className="text-gray-600 mb-4">
                {searchQuery
                  ? `No ideas match your search for "${searchQuery}"`
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
      )}

      {/* Share Modal */}
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

      {/* Create Idea Modal */}
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
                  refetchDiscovery()
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
    </div>
  )
}

export default IdeaGeneratorPage
