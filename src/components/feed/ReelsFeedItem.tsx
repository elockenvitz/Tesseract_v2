import { clsx } from 'clsx'
import { TrendingUp, Lightbulb, FileText, GitBranch, Sparkles, MessageSquare, ChevronRight, Share2, PlusCircle, GitCompareArrows } from 'lucide-react'
import { ReelsChartPanel } from './ReelsChartPanel'
import { PairTradeChartCarousel } from './PairTradeChartCarousel'
import { FeedTileHeader } from '../mobile/FeedTileHeader'
import { FeedTileTitle } from '../mobile/FeedTileTitle'
import { ExpandableText } from '../mobile/ExpandableText'
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
  const cleanContent = stripHtml(item.content)

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
      <FeedTileHeader
        className="bg-white dark:bg-gray-800"
        badge={
          <span className={clsx(
            'flex shrink-0 items-center gap-1 px-2 py-1 rounded-full text-[11px] sm:text-sm font-medium border whitespace-nowrap',
            config.badgeColor
          )}>
            <TypeIcon className={clsx('h-3.5 w-3.5 shrink-0', config.iconColor)} />
            {config.label}
          </span>
        }
        authorName={item.author.full_name ||
          (item.author.first_name && item.author.last_name
            ? `${item.author.first_name} ${item.author.last_name}`
            : item.author.email?.split('@')[0] || 'Unknown')}
        onAuthorClick={onAuthorClick ? () => onAuthorClick(item.author.id) : undefined}
        timestamp={item.created_at}
        actions={hideHeaderActions ? undefined : (
          <>
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
          </>
        )}
      />

      {/* The instruction leads, exactly as it does on a decision tile. It was
          previously a small chip below the chart, so "BUY MSFT" read as a
          different thing depending on which surface it arrived through. */}
      {hideHeaderActions && (displaySymbol || isPairTrade) && (
        <FeedTileTitle
          action={item.type === 'trade_idea' && 'action' in item ? item.action : null}
          symbol={isPairTrade ? null : displaySymbol}
          longSymbols={
            isPairTrade
              ? ((item as any).long_legs ?? []).map((l: any) => l?.asset?.symbol).filter(Boolean)
              : []
          }
          shortSymbols={
            isPairTrade
              ? ((item as any).short_legs ?? []).map((l: any) => l?.asset?.symbol).filter(Boolean)
              : []
          }
          headline={'title' in item ? item.title : null}
          quoteSymbol={isPairTrade ? null : displaySymbol}
          quoteCompanyName={asset?.company_name}
        />
      )}

      {/* Chart area */}
      {/* A third of the screen. The written reasoning below is the part that
          needs room, and the chart is one band among a header, an instruction
          and the case itself. */}
      <div className={clsx("flex-shrink-0 px-3 pt-1 pb-1", isPairTrade ? "h-[42%] min-h-[230px] max-h-[380px]" : "h-[33%] min-h-[170px] max-h-[300px]")}>
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
      <div className="flex-1 min-h-0 px-3 py-2 overflow-hidden">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 max-h-full overflow-hidden dark:border-gray-700 dark:bg-gray-900">
          {/* Action and urgency. The action is repeated in the title above on
              tiles that have one, so only the urgency is shown there. */}
          {item.type === 'trade_idea' && 'urgency' in item &&
            (item.urgency === 'urgent' || item.urgency === 'high') && (
            <div className="flex items-center gap-2 mb-2">
              <span className={clsx(
                'px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide',
                item.urgency === 'urgent'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
              )}>
                {item.urgency}
              </span>
            </div>
          )}

          {/* Title for notes/insights — mobile shows it in the title band. */}
          {!hideHeaderActions && 'title' in item && item.title && (
            <h2 className="text-lg font-bold text-gray-900 mb-2 dark:text-white">
              {item.title}
            </h2>
          )}

          {/* The reasoning — the substance of the post, so it gets the weight.
              Clamped by rendered height rather than character count: 600
              characters is a different number of lines at every width. */}
          <ExpandableText text={cleanContent} lines={5} />

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
