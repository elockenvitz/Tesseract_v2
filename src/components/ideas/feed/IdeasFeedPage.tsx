/**
 * IdeasFeedPage — Primary Ideas experience.
 *
 * Single-column infinite-scroll feed combining human-authored content
 * with system-generated signal cards. Replaces the masonry grid as
 * the default Ideas view.
 *
 * Layout:
 * - Header: title, mode selector, search, create button
 * - Filter chips: type filtering
 * - Centered feed column (~760px max-width)
 * - Optional detail pane (right side) on card selection
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  Lightbulb, Search, Plus, X, RefreshCw,
  SlidersHorizontal, Sparkles, Users, Clock as ClockIcon,
  FileText, TrendingUp, GitBranch, Zap,
} from 'lucide-react'
import { useIdeasFeed, type FeedMode, type IdeasFeedFilters, type MixedFeedItem, isSignalCard } from '../../../hooks/ideas/useIdeasFeed'
import { useSignalCards, insertSignalsIntoFeed } from '../../../hooks/ideas/useSignalCards'
import { FeedCard } from './FeedCard'
import { SignalFeedCard } from './SignalFeedCard'
import { FeedSkeleton } from './FeedSkeleton'
import type { ScoredFeedItem, ItemType } from '../../../hooks/ideas/types'

// ============================================================
// Type filter chips
// ============================================================

const TYPE_CHIPS: Array<{ value: ItemType | null; label: string; icon: React.ElementType }> = [
  { value: null, label: 'All', icon: Sparkles },
  { value: 'quick_thought', label: 'Thoughts', icon: Lightbulb },
  { value: 'trade_idea', label: 'Trade Ideas', icon: TrendingUp },
  { value: 'note', label: 'Notes', icon: FileText },
  { value: 'thesis_update', label: 'Thesis', icon: GitBranch },
]

// ============================================================
// Mode config
// ============================================================

const MODE_OPTIONS: Array<{ value: FeedMode; label: string; icon: React.ElementType }> = [
  { value: 'for_you', label: 'For You', icon: Sparkles },
  { value: 'following', label: 'Following', icon: Users },
  { value: 'latest', label: 'Latest', icon: ClockIcon },
]

// ============================================================
// Props
// ============================================================

interface IdeasFeedPageProps {
  onItemSelect?: (item: any) => void
}

// ============================================================
// Component
// ============================================================

export function IdeasFeedPage({ onItemSelect }: IdeasFeedPageProps) {
  // ── State ──
  const [mode, setMode] = useState<FeedMode>('for_you')
  const [typeFilter, setTypeFilter] = useState<ItemType | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ScoredFeedItem | null>(null)

  // ── Feed filters ──
  const filters: IdeasFeedFilters = {
    mode,
    types: typeFilter ? [typeFilter] : undefined,
    search: searchQuery || undefined,
  }

  // ── Data ──
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, isError } = useIdeasFeed(filters)
  const { signals } = useSignalCards()

  // ── Mix signals into feed ──
  const mixedFeed = insertSignalsIntoFeed(items, signals)

  // ── Search filtering (client-side for instant results) ──
  const displayItems = searchQuery
    ? mixedFeed.filter(item => {
        if (isSignalCard(item)) {
          return item.headline.toLowerCase().includes(searchQuery.toLowerCase()) ||
                 item.body.toLowerCase().includes(searchQuery.toLowerCase())
        }
        const content = (item.content || '').toLowerCase()
        const symbol = ('asset' in item && item.asset?.symbol || '').toLowerCase()
        const author = [item.author?.first_name, item.author?.last_name].filter(Boolean).join(' ').toLowerCase()
        return content.includes(searchQuery.toLowerCase()) ||
               symbol.includes(searchQuery.toLowerCase()) ||
               author.includes(searchQuery.toLowerCase())
      })
    : mixedFeed

  // ── Infinite scroll trigger ──
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: '300px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // ── Handlers ──
  const handleCardClick = useCallback((item: ScoredFeedItem) => {
    setSelectedItem(item)
    // Navigate to detail view
    if (onItemSelect) {
      if (item.type === 'quick_thought') {
        onItemSelect({ id: item.id, title: 'Quick Thought', type: 'quick-thought-detail', data: item })
      } else if (item.type === 'trade_idea' && 'asset' in item && item.asset) {
        onItemSelect({ id: item.id, title: item.asset.symbol, type: 'trade-queue', data: item })
      } else if (item.type === 'note' && 'source' in item) {
        const noteItem = item as any
        if (noteItem.source?.type === 'asset') {
          onItemSelect({ id: noteItem.source.id, title: noteItem.source.name, type: 'asset', data: { defaultTab: 'notes' } })
        }
      }
    }
  }, [onItemSelect])

  const handleSignalClick = useCallback((signal: any) => {
    if (signal.relatedAssets?.[0] && onItemSelect) {
      onItemSelect({ id: signal.relatedAssets[0].id, title: signal.relatedAssets[0].symbol, type: 'asset' })
    }
  }, [onItemSelect])

  const handleAuthorClick = useCallback((authorId: string) => {
    // Could open author profile or filter to author
  }, [])

  const handleAssetClick = useCallback((assetId: string, symbol: string) => {
    onItemSelect?.({ id: assetId, title: symbol, type: 'asset' })
  }, [onItemSelect])

  const handleExpandChart = useCallback((symbol: string) => {
    onItemSelect?.({ id: 'charting', title: 'Charting', type: 'charting', data: { symbol } })
  }, [onItemSelect])

  const handleCreate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openThoughtsCapture', { detail: {} }))
  }, [])

  // ── Render ──
  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      {/* ═══ HEADER ═══ */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 shrink-0">
        <div className="max-w-[1060px] mx-auto">
          {/* Title + mode + actions row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <h1 className="text-[16px] font-semibold text-gray-900 flex items-center gap-2">
                <Lightbulb className="w-4.5 h-4.5 text-primary-600" />
                Ideas
              </h1>

              {/* Mode selector */}
              <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
                {MODE_OPTIONS.map(opt => {
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value)}
                      className={clsx(
                        'flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium transition-colors',
                        mode === opt.value
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Search toggle */}
              <button
                onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery('') }}
                className={clsx(
                  'p-2 rounded-lg transition-colors',
                  showSearch ? 'bg-primary-50 text-primary-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
                )}
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Refresh */}
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
              </button>

              {/* Create */}
              <button
                onClick={handleCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-[12px] font-semibold rounded-lg transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Post
              </button>
            </div>
          </div>

          {/* Search bar */}
          {showSearch && (
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search ideas, assets, people..."
                className="w-full pl-9 pr-8 py-2 text-[13px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Type filter chips */}
          <div className="flex items-center gap-1.5">
            {TYPE_CHIPS.map(chip => {
              const Icon = chip.icon
              const isActive = typeFilter === chip.value
              return (
                <button
                  key={chip.value || 'all'}
                  onClick={() => setTypeFilter(chip.value)}
                  className={clsx(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                    isActive
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700',
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ═══ FEED ═══ */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1060px] mx-auto px-4 py-3">
          {/* Loading state */}
          {isLoading && <FeedSkeleton count={5} />}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="text-center py-16">
              <p className="text-[13px] text-gray-500 mb-3">Failed to load feed</p>
              <button
                onClick={() => refetch()}
                className="text-[12px] font-medium text-primary-600 hover:text-primary-700"
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && displayItems.length === 0 && (
            <div className="text-center py-20">
              <Lightbulb className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-[15px] font-semibold text-gray-700 mb-1">
                {searchQuery ? 'No matches' : 'No ideas yet'}
              </h3>
              <p className="text-[13px] text-gray-400 mb-4 max-w-xs mx-auto">
                {searchQuery
                  ? `Nothing matches "${searchQuery}"`
                  : 'Capture a quick thought to get started.'}
              </p>
              {!searchQuery && (
                <button
                  onClick={handleCreate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Post an idea
                </button>
              )}
            </div>
          )}

          {/* Feed items */}
          {!isLoading && displayItems.length > 0 && (
            <div className="space-y-3">
              {displayItems.map((item, idx) => {
                if (isSignalCard(item)) {
                  return (
                    <SignalFeedCard
                      key={item.id}
                      signal={item}
                      onAssetClick={handleAssetClick}
                      onCardClick={handleSignalClick}
                      onExpandChart={handleExpandChart}
                    />
                  )
                }

                return (
                  <FeedCard
                    key={item.id}
                    item={item}
                    onAuthorClick={handleAuthorClick}
                    onAssetClick={handleAssetClick}
                    onCardClick={handleCardClick}
                    onExpandChart={handleExpandChart}
                    isSelected={selectedItem?.id === item.id}
                  />
                )
              })}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-px" />

              {/* Loading more indicator */}
              {isFetchingNextPage && (
                <div className="py-4">
                  <FeedSkeleton count={2} />
                </div>
              )}

              {/* End of feed */}
              {!hasNextPage && !isFetchingNextPage && items.length > 0 && (
                <div className="text-center py-8">
                  <p className="text-[11px] text-gray-400">You're all caught up</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
