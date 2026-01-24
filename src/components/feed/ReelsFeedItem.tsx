import React, { useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  TrendingUp, TrendingDown, Lightbulb, FileText, GitBranch, Sparkles,
  MessageSquare, User, ChevronDown, ChevronUp, Share2, PlusCircle
} from 'lucide-react'
import { ReelsChartPanel } from './ReelsChartPanel'
import type { ScoredFeedItem, ItemType } from '../../hooks/ideas/types'

// Strip HTML tags from content for clean display
function stripHtml(html: string): string {
  if (!html) return ''
  const text = html.replace(/<[^>]*>/g, ' ')
  const decoded = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return decoded.replace(/\s+/g, ' ').trim()
}

interface ReelsFeedItemProps {
  item: ScoredFeedItem
  onItemClick?: (item: ScoredFeedItem) => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onOpenFullChart?: (symbol: string) => void
  onShare?: (item: ScoredFeedItem) => void
  onCreateIdea?: (item: ScoredFeedItem) => void
}

const typeConfig: Record<ItemType, {
  icon: typeof Lightbulb
  label: string
  bgColor: string
  badgeColor: string
  iconColor: string
}> = {
  quick_thought: {
    icon: Lightbulb,
    label: 'Thought',
    bgColor: 'bg-white',
    badgeColor: 'bg-amber-100 text-amber-700 border-amber-200',
    iconColor: 'text-amber-500'
  },
  trade_idea: {
    icon: TrendingUp,
    label: 'Trade Idea',
    bgColor: 'bg-white',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    iconColor: 'text-emerald-500'
  },
  note: {
    icon: FileText,
    label: 'Research Note',
    bgColor: 'bg-white',
    badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
    iconColor: 'text-blue-500'
  },
  thesis_update: {
    icon: GitBranch,
    label: 'Thesis Update',
    bgColor: 'bg-white',
    badgeColor: 'bg-purple-100 text-purple-700 border-purple-200',
    iconColor: 'text-purple-500'
  },
  insight: {
    icon: Sparkles,
    label: 'AI Insight',
    bgColor: 'bg-white',
    badgeColor: 'bg-orange-100 text-orange-700 border-orange-200',
    iconColor: 'text-orange-500'
  },
  message: {
    icon: MessageSquare,
    label: 'Discussion',
    bgColor: 'bg-white',
    badgeColor: 'bg-gray-100 text-gray-700 border-gray-200',
    iconColor: 'text-gray-500'
  }
}

export function ReelsFeedItem({
  item,
  onItemClick,
  onAuthorClick,
  onAssetClick,
  onOpenFullChart,
  onShare,
  onCreateIdea
}: ReelsFeedItemProps) {
  const [isContentExpanded, setIsContentExpanded] = useState(false)

  const config = typeConfig[item.type]
  const TypeIcon = config.icon

  // Get asset info if available (notes use 'source' instead of 'asset')
  const asset = 'asset' in item && item.asset ? item.asset : null
  const noteSource = item.type === 'note' && 'source' in item ? item.source : null
  const hasSource = !!noteSource && noteSource.type === 'asset'
  const displaySymbol = asset?.symbol || (hasSource ? noteSource?.name : null)

  // Debug logging for trade ideas
  if (item.type === 'trade_idea') {
    console.log('[ReelsFeedItem] Trade idea:', { id: item.id, asset, displaySymbol, item })
  }

  // Get the event date for chart marker (trade idea creation date)
  const eventDate = item.type === 'trade_idea' ? item.created_at : undefined
  const eventLabel = item.type === 'trade_idea' && 'action' in item
    ? `${item.action?.toUpperCase()} idea`
    : undefined

  // Get clean content
  const cleanContent = stripHtml(item.content)
  const isLongContent = cleanContent.length > 200
  const displayContent = isContentExpanded || !isLongContent
    ? cleanContent
    : cleanContent.substring(0, 200) + '...'

  return (
    <div className={clsx(
      'relative w-full h-full overflow-hidden',
      config.bgColor
    )}>
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          {/* Type badge */}
          <span className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border',
            config.badgeColor
          )}>
            <TypeIcon className={clsx('h-4 w-4', config.iconColor)} />
            {config.label}
          </span>

          {/* Author */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAuthorClick?.(item.author.id)
            }}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors"
          >
            {item.author.avatar_url ? (
              <img
                src={item.author.avatar_url}
                alt={item.author.full_name || ''}
                className="w-7 h-7 rounded-full object-cover border border-gray-200"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200">
                <User className="h-4 w-4 text-gray-500" />
              </div>
            )}
            <span className="text-sm font-medium hidden sm:inline">
              {item.author.full_name ||
                (item.author.first_name && item.author.last_name
                  ? `${item.author.first_name} ${item.author.last_name}`
                  : item.author.email?.split('@')[0] || 'Unknown')}
            </span>
          </button>

          {/* Time */}
          <span className="text-gray-400 text-sm hidden md:inline">
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* Share button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onShare?.(item)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-full text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
            title="Share"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </button>

          {/* Create Idea button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateIdea?.(item)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 rounded-full text-white text-sm font-medium hover:bg-primary-600 transition-colors"
            title="Create Idea"
          >
            <PlusCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Create Idea</span>
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="absolute top-[52px] left-0 right-0 h-[50%] px-4 py-2">
        {displaySymbol ? (
          <ReelsChartPanel
            symbol={displaySymbol}
            companyName={asset?.company_name}
            onOpenFullChart={onOpenFullChart}
            eventDate={eventDate}
            eventLabel={eventLabel}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-center text-gray-400 p-8">
              <TypeIcon className={clsx('w-12 h-12 mx-auto mb-3', config.iconColor, 'opacity-50')} />
              <p className="text-base text-gray-500">No chart available</p>
              <p className="text-sm mt-1 text-gray-400">This item doesn't have an associated asset</p>
            </div>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="absolute top-[calc(52px+50%)] left-0 right-0 bottom-0 px-4 py-3 overflow-y-auto">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-h-full overflow-y-auto">
          {/* Title for notes/insights */}
          {'title' in item && item.title && (
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              {item.title}
            </h2>
          )}

          {/* Content */}
          <p className="text-gray-700 text-base leading-relaxed">
            {displayContent}
          </p>

          {/* Expand/collapse for long content */}
          {isLongContent && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsContentExpanded(!isContentExpanded)
              }}
              className="flex items-center gap-1 text-primary-600 hover:text-primary-700 mt-2 text-sm font-medium"
            >
              {isContentExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Read more
                </>
              )}
            </button>
          )}

          {/* Trade idea specific info */}
          {item.type === 'trade_idea' && 'action' in item && (
            <div className="flex items-center gap-2 mt-3">
              <span className={clsx(
                'px-3 py-1 rounded-full text-sm font-medium',
                item.action === 'buy'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              )}>
                {item.action === 'buy' ? (
                  <TrendingUp className="h-4 w-4 inline-block mr-1" />
                ) : (
                  <TrendingDown className="h-4 w-4 inline-block mr-1" />
                )}
                {item.action?.toUpperCase()}
              </span>
              {'urgency' in item && item.urgency && (
                <span className={clsx(
                  'px-2 py-1 rounded-full text-xs font-medium',
                  item.urgency === 'urgent' && 'bg-red-100 text-red-700',
                  item.urgency === 'high' && 'bg-orange-100 text-orange-700',
                  item.urgency === 'medium' && 'bg-yellow-100 text-yellow-700',
                  item.urgency === 'low' && 'bg-gray-100 text-gray-600'
                )}>
                  {item.urgency}
                </span>
              )}
            </div>
          )}

          {/* Asset badge */}
          {displaySymbol && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (asset) {
                  onAssetClick?.(asset.id, asset.symbol)
                } else if (noteSource) {
                  onAssetClick?.(noteSource.id, noteSource.name)
                }
              }}
              className="inline-flex items-center gap-1 mt-3 px-3 py-1 bg-primary-100 rounded-full text-primary-700 hover:bg-primary-200 transition-colors font-medium"
            >
              <span>${displaySymbol}</span>
            </button>
          )}

          {/* Tags */}
          {'tags' in item && item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {item.tags.slice(0, 5).map(tag => (
                <span
                  key={tag}
                  className="px-2 py-0.5 bg-gray-200 rounded-full text-gray-600 text-xs"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ReelsFeedItem
