import React, { useCallback, useState } from 'react'
import { clsx } from 'clsx'
import { Lightbulb, Sparkles, BarChart3, ChevronDown, ChevronUp } from 'lucide-react'
import { IdeaCard } from './IdeaCard'
import { TradeIdeaCard } from './cards/TradeIdeaCard'
import { NoteCard } from './cards/NoteCard'
import { ThesisUpdateCard } from './cards/ThesisUpdateCard'
import { InsightCard } from './cards/InsightCard'
import { IdeaReactions } from './social/IdeaReactions'
import { BookmarkButton } from './social/BookmarkButton'
import { FlippableCard } from './FlippableCard'
import type { ScoredFeedItem, CardSize } from '../../hooks/ideas/types'

interface MasonryGridProps {
  items: ScoredFeedItem[]
  onItemClick?: (item: ScoredFeedItem) => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onPortfolioClick?: (portfolioId: string) => void
  onSourceClick?: (sourceId: string, sourceType: string, sourceName?: string) => void
  onTagClick?: (tag: string) => void
  onGenerateIdea?: (item: ScoredFeedItem) => void
  isLoading?: boolean
  className?: string
  showReactions?: boolean
  showBookmarks?: boolean
  showCharts?: boolean
}

export function MasonryGrid({
  items,
  onItemClick,
  onAuthorClick,
  onAssetClick,
  onPortfolioClick,
  onSourceClick,
  onTagClick,
  onGenerateIdea,
  isLoading = false,
  className,
  showReactions = true,
  showBookmarks = true,
  showCharts = true
}: MasonryGridProps) {
  // Track which cards are flipped to show charts
  const [flippedCards, setFlippedCards] = useState<Set<string>>(new Set())
  // Track which cards are expanded
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  const toggleFlip = useCallback((itemId: string) => {
    setFlippedCards(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  const toggleExpand = useCallback((itemId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  const renderCard = useCallback((item: ScoredFeedItem) => {
    // Get asset info for chart flip
    const asset = 'asset' in item && item.asset ? item.asset : null
    const isFlipped = flippedCards.has(item.id)
    const isExpanded = expandedCards.has(item.id)

    // Use fixed size, but allow expansion
    const cardSize: CardSize = isExpanded ? 'large' : 'small'

    // Check if content is truncated (needs expand button)
    const contentLength = item.content?.length || 0
    const maxCharsSmall = 400
    const hasTruncatedContent = contentLength > maxCharsSmall

    // Actions widget with reactions, bookmarks, chart flip button, expand, and generate idea
    const actionsWidget = (showReactions || showBookmarks || onGenerateIdea || (showCharts && asset) || hasTruncatedContent) && (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {showReactions && (
            <IdeaReactions
              itemId={item.id}
              itemType={item.type}
              compact
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          {showCharts && asset && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleFlip(item.id)
              }}
              className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              title="View chart"
            >
              <BarChart3 className="h-4 w-4" />
            </button>
          )}
          {onGenerateIdea && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onGenerateIdea(item)
              }}
              className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
              title="Generate idea from this"
            >
              <Lightbulb className="h-4 w-4" />
            </button>
          )}
          {hasTruncatedContent && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(item.id)
              }}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
          {showBookmarks && (
            <BookmarkButton
              itemId={item.id}
              itemType={item.type}
            />
          )}
        </div>
      </div>
    )

    const commonProps = {
      size: cardSize,
      onClick: () => onItemClick?.(item),
      onAuthorClick,
      onAssetClick,
      actionsWidget
    }

    let cardContent: React.ReactNode

    switch (item.type) {
      case 'trade_idea':
        cardContent = (
          <TradeIdeaCard
            item={item as any}
            onPortfolioClick={onPortfolioClick}
            {...commonProps}
          />
        )
        break
      case 'note':
        cardContent = (
          <NoteCard
            item={item as any}
            onSourceClick={onSourceClick}
            {...commonProps}
          />
        )
        break
      case 'thesis_update':
        cardContent = (
          <ThesisUpdateCard
            item={item as any}
            showDiff
            {...commonProps}
          />
        )
        break
      case 'insight':
        cardContent = (
          <InsightCard
            item={item as any}
            onTagClick={onTagClick}
            {...commonProps}
          />
        )
        break
      default:
        cardContent = (
          <IdeaCard
            item={item}
            {...commonProps}
          />
        )
    }

    // Wrap in FlippableCard if asset exists
    if (asset && showCharts) {
      return (
        <FlippableCard
          symbol={asset.symbol}
          companyName={asset.company_name}
          isFlipped={isFlipped}
          onFlip={() => toggleFlip(item.id)}
          size={cardSize}
        >
          {cardContent}
        </FlippableCard>
      )
    }

    return cardContent
  }, [onItemClick, onAuthorClick, onAssetClick, onPortfolioClick, onSourceClick, onTagClick, onGenerateIdea, showReactions, showBookmarks, showCharts, flippedCards, toggleFlip, expandedCards, toggleExpand])

  if (isLoading) {
    return (
      <div className={clsx(
        'grid grid-cols-1 lg:grid-cols-2 gap-4',
        className
      )}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-200 rounded-xl h-56" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No ideas to display</p>
      </div>
    )
  }

  return (
    <div className={clsx(
      'grid grid-cols-1 lg:grid-cols-2 gap-4',
      className
    )}>
      {items.map(item => {
        const isExpanded = expandedCards.has(item.id)
        return (
          <div
            key={item.id}
            className={clsx(
              'w-full min-w-0 overflow-hidden',
              isExpanded ? 'h-auto' : 'h-56'
            )}
          >
            {renderCard(item)}
          </div>
        )
      })}
    </div>
  )
}

// Alternative: CSS Grid Masonry (when browser support is better)
export function CSSMasonryGrid({
  items,
  onItemClick,
  onAuthorClick,
  onAssetClick,
  isLoading = false,
  className
}: MasonryGridProps) {
  if (isLoading) {
    return (
      <div className={clsx(
        'columns-1 md:columns-2 lg:columns-3 gap-4',
        className
      )}>
        {[...Array(9)].map((_, i) => (
          <div key={i} className="animate-pulse break-inside-avoid mb-4">
            <div className={clsx(
              'bg-gray-200 rounded-xl',
              i % 3 === 0 ? 'h-64' : i % 3 === 1 ? 'h-48' : 'h-40'
            )} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={clsx(
      'columns-1 md:columns-2 lg:columns-3 gap-4',
      className
    )}>
      {items.map(item => (
        <div key={item.id} className="break-inside-avoid mb-4">
          <IdeaCard
            item={item}
            size={item.cardSize}
            onClick={() => onItemClick?.(item)}
            onAuthorClick={onAuthorClick}
            onAssetClick={onAssetClick}
          />
        </div>
      ))}
    </div>
  )
}

export default MasonryGrid
