import React, { useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  TrendingUp, TrendingDown, Lightbulb, FileText, GitBranch, Sparkles,
  MessageSquare, User, ChevronDown, ChevronUp, ChevronRight, Share2, PlusCircle, GitCompareArrows
} from 'lucide-react'
import { ReelsChartPanel } from './ReelsChartPanel'
import { PairTradeChartCarousel } from './PairTradeChartCarousel'
import { TickerQuoteBadge } from '../mobile/TickerQuoteBadge'
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
  /** Suppresses the header Share / Create Idea buttons. Set on mobile, where
   *  those actions live in the thumb-reachable action rail instead and would
   *  otherwise appear twice on the same card. */
  hideHeaderActions?: boolean
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
    bgColor: 'bg-white dark:bg-gray-800',
    badgeColor: 'bg-amber-100 text-amber-700 border-amber-200',
    iconColor: 'text-amber-500'
  },
  trade_idea: {
    icon: TrendingUp,
    label: 'Trade Idea',
    bgColor: 'bg-white dark:bg-gray-800',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    iconColor: 'text-emerald-500'
  },
  pair_trade: {
    icon: GitCompareArrows,
    label: 'Pair Trade',
    bgColor: 'bg-white dark:bg-gray-800',
    badgeColor: 'bg-teal-100 text-teal-700 border-teal-200',
    iconColor: 'text-teal-500'
  },
  note: {
    icon: FileText,
    label: 'Research Note',
    bgColor: 'bg-white dark:bg-gray-800',
    badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
    iconColor: 'text-blue-500'
  },
  thesis_update: {
    icon: GitBranch,
    label: 'Thesis Update',
    bgColor: 'bg-white dark:bg-gray-800',
    badgeColor: 'bg-purple-100 text-purple-700 border-purple-200',
    iconColor: 'text-purple-500'
  },
  insight: {
    icon: Sparkles,
    label: 'AI Insight',
    bgColor: 'bg-white dark:bg-gray-800',
    badgeColor: 'bg-orange-100 text-orange-700 border-orange-200',
    iconColor: 'text-orange-500'
  },
  message: {
    icon: MessageSquare,
    label: 'Discussion',
    bgColor: 'bg-white dark:bg-gray-800',
    badgeColor: 'bg-gray-100 text-gray-700 border-gray-200 dark:border-gray-700 dark:text-gray-300 dark:bg-gray-800',
    iconColor: 'text-gray-500 dark:text-gray-400'
  }
}

/** Used when an ItemType has no entry above — degrade, don't crash. */
const FALLBACK_TYPE_CONFIG = {
  icon: FileText,
  label: 'Update',
  bgColor: 'bg-white dark:bg-gray-800',
  badgeColor: 'bg-gray-100 text-gray-700 border-gray-200 dark:border-gray-700 dark:text-gray-300 dark:bg-gray-800',
  iconColor: 'text-gray-500 dark:text-gray-400',
}

export function ReelsFeedItem({
  item,
  onItemClick,
  onAuthorClick,
  onAssetClick,
  onOpenFullChart,
  onShare,
  onCreateIdea,
  hideHeaderActions = false
}: ReelsFeedItemProps) {
  const [isContentExpanded, setIsContentExpanded] = useState(false)

  // Fall back rather than destructure a missing entry. `pair_trade` was absent
  // from typeConfig, so a pair trade in the feed made `config` undefined and
  // `config.icon` threw — a white screen on what is now the mobile home. A new
  // ItemType should degrade to a generic card, never crash the feed.
  const config = typeConfig[item.type] ?? FALLBACK_TYPE_CONFIG
  const TypeIcon = config.icon

  // Get asset info if available (notes use 'source' instead of 'asset')
  const asset = 'asset' in item && item.asset ? item.asset : null
  const noteSource = item.type === 'note' && 'source' in item ? item.source : null
  const hasSource = !!noteSource && noteSource.type === 'asset'
  const displaySymbol = asset?.symbol || (hasSource ? noteSource?.name : null)

  // Pair trades carry legs instead of a single asset, so they get a carousel
  // rather than the single-symbol chart path below.
  const isPairTrade =
    item.type === 'pair_trade' &&
    (((item as any).long_legs?.length ?? 0) > 0 || ((item as any).short_legs?.length ?? 0) > 0)

  // Debug logging for trade ideas
  if (item.type === 'trade_idea') {
  }

  // Get the event date for chart marker (trade idea creation date)
  const eventDate = item.type === 'trade_idea' ? item.created_at : undefined
  const eventLabel = item.type === 'trade_idea' && 'action' in item
    ? `${item.action?.toUpperCase()} idea`
    : undefined

  // Get clean content
  // 200 characters truncated most theses mid-sentence and hid the reasoning
  // behind a "Read more" tap. The content area scrolls, so show far more of it
  // before collapsing.
  const cleanContent = stripHtml(item.content)
  const isLongContent = cleanContent.length > 600
  const displayContent = isContentExpanded || !isLongContent
    ? cleanContent
    : cleanContent.substring(0, 600) + '…'

  return (
    // Flex column rather than absolutely-positioned percentage bands. The old
    // layout hard-coded `top-[52px]` and `top-[calc(52px+38%)]`, so the chart's
    // real height depended on the container — and once the action bar took 64px
    // off the bottom, the percentage resolved against a shorter box and the
    // chart collapsed to an unusable sliver. Flex plus explicit min/max keeps
    // the chart legible regardless of what else is on screen.
    <div className={clsx(
      'relative w-full h-full overflow-hidden flex flex-col',
      config.bgColor
    )}>
      {/* Header */}
      <div className="flex-shrink-0 z-30 flex items-center justify-between px-3 py-2 bg-white border-b border-gray-100 dark:border-gray-800 dark:bg-gray-800">
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
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors dark:hover:text-white dark:text-gray-300"
          >
            {item.author.avatar_url ? (
              <img
                src={item.author.avatar_url}
                alt={item.author.full_name || ''}
                className="w-7 h-7 rounded-full object-cover border border-gray-200 dark:border-gray-700"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
                <User className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              </div>
            )}
            {/* Always show the name. A bare avatar glyph with no label tells
                the reader nothing about who wrote the post — which is the
                single most useful piece of context on a research feed. */}
            <span className="text-sm font-medium truncate max-w-[9rem] sm:max-w-none">
              {item.author.full_name ||
                (item.author.first_name && item.author.last_name
                  ? `${item.author.first_name} ${item.author.last_name}`
                  : item.author.email?.split('@')[0] || 'Unknown')}
            </span>
          </button>

          {/* Time */}
          {/* Recency matters on a research feed — keep it on phones too. */}
          <span className="text-gray-400 text-xs md:text-sm whitespace-nowrap">
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
          </span>
        </div>

        {/* Ticker and price fill what was an empty right-hand gap, and let the
            chart below drop its own header row. */}
        {hideHeaderActions && displaySymbol && !isPairTrade && (
          <TickerQuoteBadge
            symbol={displaySymbol}
            companyName={asset?.company_name}
            className="ml-auto"
          />
        )}

        {/* Action buttons */}
        <div className={clsx('items-center gap-2', hideHeaderActions ? 'hidden' : 'flex')}>
          {/* Share button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onShare?.(item)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-full text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors dark:text-gray-300 dark:bg-gray-800"
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
      {/* Chart takes less of a phone screen than a desktop one — the written
          reasoning below it is the part that needs room, and at 50% the text
          area was too short to read a thesis without scrolling. */}
      <div className="flex-shrink-0 h-[52%] min-h-[260px] max-h-[420px] px-3 pt-2 pb-1">
        {isPairTrade ? (
          // A pair trade is a relationship between two positions; one chart
          // misrepresents it. Swipe horizontally between the legs.
          <PairTradeChartCarousel
            longLegs={(item as any).long_legs ?? []}
            shortLegs={(item as any).short_legs ?? []}
          />
        ) : displaySymbol ? (
          <ReelsChartPanel
            symbol={displaySymbol}
            companyName={asset?.company_name}
            onOpenFullChart={onOpenFullChart}
            eventDate={eventDate}
            eventLabel={eventLabel}
            hideHeader={hideHeaderActions}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-900">
            <div className="text-center text-gray-400 p-8">
              <TypeIcon className={clsx('w-12 h-12 mx-auto mb-3', config.iconColor, 'opacity-50')} />
              <p className="text-base text-gray-500 dark:text-gray-400">No chart available</p>
              <p className="text-sm mt-1 text-gray-400">This item doesn't have an associated asset</p>
            </div>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 px-3 py-2 overflow-y-auto">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-h-full overflow-y-auto dark:border-gray-700 dark:bg-gray-900">
          {/* Qualifiers lead, compactly, so they frame the reasoning rather
              than trailing after it as a stack of competing chips. */}
          {item.type === 'trade_idea' && 'action' in item && item.action && (
            <div className="flex items-center gap-2 mb-2">
              <span className={clsx(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide',
                item.action === 'buy'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
              )}>
                {item.action === 'buy'
                  ? <TrendingUp className="h-3 w-3" />
                  : <TrendingDown className="h-3 w-3" />}
                {item.action.toUpperCase()}
              </span>
              {/* Only surfaced when it actually signals something. "medium"
                  and "low" on every card is noise. */}
              {'urgency' in item && (item.urgency === 'urgent' || item.urgency === 'high') && (
                <span className={clsx(
                  'px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide',
                  item.urgency === 'urgent'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                )}>
                  {item.urgency}
                </span>
              )}
            </div>
          )}

          {/* Title for notes/insights */}
          {'title' in item && item.title && (
            <h2 className="text-lg font-bold text-gray-900 mb-2 dark:text-white">
              {item.title}
            </h2>
          )}

          {/* The reasoning — the substance of the post, so it gets the weight */}
          <p className="text-gray-800 text-[15px] leading-relaxed dark:text-gray-200">
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

          {/* Action/urgency now lead the card, above the reasoning. */}

          {/* Route to the asset as a quiet text link. The chart panel directly
              above already renders `$SYMBOL` in bold with the company name, so
              a second prominent symbol chip here was pure duplication — but
              the navigation itself is still worth keeping. */}
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
              className="inline-flex items-center gap-1 mt-3 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
            >
              <span>Open {displaySymbol}</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Tags. Capped at three and de-duplicated against the asset badge
              above — a chip repeating the symbol already shown adds noise
              without adding information. */}
          {'tags' in item && item.tags && item.tags.length > 0 && (() => {
            const symbolLower = displaySymbol?.toLowerCase()
            const tags = item.tags
              .filter(tag => tag && tag.toLowerCase() !== symbolLower)
              .slice(0, 3)
            if (!tags.length) return null
            return (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] dark:bg-gray-800 dark:text-gray-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

export default ReelsFeedItem
