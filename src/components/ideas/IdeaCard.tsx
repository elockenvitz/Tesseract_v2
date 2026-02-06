import React, { ReactNode, useState } from 'react'
import { clsx } from 'clsx'
import { Clock } from 'lucide-react'
import type { ScoredFeedItem, CardSize, ItemType, Author, Sentiment } from '../../hooks/ideas/types'
import { TypeBadge, typeConfig } from './TypeBadge'
import { RevisitBadge } from './RevisitBadge'
import { CardActions } from './CardActions'

// Re-export typeConfig for backwards compatibility
export { typeConfig }

export interface IdeaCardProps {
  item: ScoredFeedItem & {
    // Extended fields for quick_thought
    revisit_date?: string | null
    promoted_to_trade_idea_id?: string | null
    sentiment?: Sentiment
    visibility?: 'private' | 'team' | 'public'
  }
  size?: CardSize
  onClick?: () => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onMenuClick?: (e: React.MouseEvent) => void
  className?: string

  // ===== NEW PROPS FOR UX SPEC =====

  /**
   * Current scope filter. When "mine", hides author row.
   */
  scope?: 'mine' | 'team' | 'following' | 'all'

  /**
   * Whether view is filtered to a single type.
   * When true, shows compact type badge (icon-only).
   */
  isFilteredToSingleType?: boolean

  /**
   * Whether item is bookmarked by current user.
   */
  isBookmarked?: boolean

  /**
   * Whether current user can edit this item (creator only).
   */
  canEdit?: boolean

  // Action callbacks
  onPromote?: () => void
  onBookmark?: () => void
  onEdit?: () => void
  onArchive?: () => void
  onSetRevisit?: () => void
  onCopyLink?: () => void
  onPromotedClick?: (ideaId: string) => void

  // Widget slots (unchanged)
  headerWidget?: ReactNode
  chartWidget?: ReactNode
  metricsWidget?: ReactNode
  actionsWidget?: ReactNode
  footerWidget?: ReactNode
}

/**
 * Sentiment color mapping for left border accent.
 * Only visible when sentiment exists on quick_thought items.
 */
const sentimentBorderColors: Partial<Record<Sentiment, string>> = {
  bullish: 'border-l-green-400',
  bearish: 'border-l-red-400',
  concerned: 'border-l-amber-400',
  // neutral, curious, excited - no accent
}

/**
 * Format timestamp as compact relative time.
 * "2h", "3d", "1w", "Jan 5"
 */
function formatCompactTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays === 1) return '1d'
  if (diffDays < 7) return `${diffDays}d`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function IdeaCard({
  item,
  size = 'medium',
  onClick,
  onAuthorClick,
  onAssetClick,
  onMenuClick,
  className,
  // New props
  scope,
  isFilteredToSingleType = false,
  isBookmarked = false,
  canEdit = false,
  onPromote,
  onBookmark,
  onEdit,
  onArchive,
  onSetRevisit,
  onCopyLink,
  onPromotedClick,
  // Widget slots
  headerWidget,
  chartWidget,
  metricsWidget,
  actionsWidget,
  footerWidget
}: IdeaCardProps) {
  // Hover state for action visibility
  const [isHovered, setIsHovered] = useState(false)

  const sizeClasses = {
    small: 'p-3 min-h-[14rem]',
    medium: 'p-4 min-h-[16rem]',
    large: 'p-5 min-h-[18rem]'
  }

  // Determine if we should show promoted state
  const isPromoted = !!item.promoted_to_trade_idea_id
  const isQuickThought = item.type === 'quick_thought'

  // Sentiment border (only for quick_thoughts with sentiment)
  const sentimentBorder = isQuickThought && item.sentiment
    ? sentimentBorderColors[item.sentiment]
    : null

  // Hide author row when scope === "mine" (always showing own content)
  const showAuthorRow = scope !== 'mine'

  // Show promote action only for quick_thoughts that aren't already promoted
  const showPromoteAction = isQuickThought && !isPromoted

  return (
    <div
      className={clsx(
        // Base styles
        'relative w-full bg-white rounded-xl shadow-sm overflow-hidden flex flex-col',
        'transition-all duration-150',
        // Border with optional sentiment accent
        'border-l-2',
        sentimentBorder || 'border-l-transparent',
        'border border-gray-200',
        // Hover state: lift + border darken
        onClick && 'hover:shadow-md hover:border-gray-300 cursor-pointer',
        // Focus state for keyboard navigation
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        // Size
        sizeClasses[size],
        className
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* ===== HEADER ROW ===== */}
      {/* Type badge on left, timestamp + actions on right */}
      <div className="flex items-start justify-between mb-1.5 flex-shrink-0">
        {/* Left side: Type badge + revisit badge */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Type badge - compact when filtered to single type */}
          <TypeBadge
            type={item.type}
            compact={isFilteredToSingleType}
            isPromoted={isPromoted}
            promotedIdeaId={item.promoted_to_trade_idea_id || undefined}
            onPromotedClick={onPromotedClick}
          />

          {/* Revisit badge (inline with type) */}
          {isQuickThought && item.revisit_date && (
            <RevisitBadge date={item.revisit_date} />
          )}

          {/* Header widget slot (e.g., urgency for trade ideas) */}
          {headerWidget}
        </div>

        {/* Right side: Timestamp + Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Compact timestamp */}
          <span className="text-[10px] text-gray-400">
            {formatCompactTime(item.created_at)}
          </span>

          {/* Action buttons - hover to reveal */}
          <CardActions
            visible={isHovered}
            isBookmarked={isBookmarked}
            canEdit={canEdit}
            showPromote={showPromoteAction}
            onPromote={onPromote}
            onBookmark={onBookmark}
            onEdit={onEdit}
            onArchive={onArchive}
            onSetRevisit={onSetRevisit}
            onCopyLink={onCopyLink}
          />
        </div>
      </div>

      {/* ===== TITLE (for notes and insights) ===== */}
      {'title' in item && item.title && (
        <h3 className="font-semibold text-gray-900 mb-1.5 line-clamp-1 flex-shrink-0">
          {item.title}
        </h3>
      )}

      {/* ===== CONTENT AREA ===== */}
      {/* Content is the visual hero - takes up available space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {item.content && (() => {
          const maxChars = size === 'large' ? 800 : size === 'medium' ? 550 : 400
          const isTruncated = item.content.length > maxChars
          const displayText = isTruncated
            ? item.content.substring(0, maxChars).trim() + '...'
            : item.content
          return (
            <p className="text-sm text-gray-700 leading-relaxed">
              {displayText}
            </p>
          )
        })()}

        {/* Chart widget slot */}
        {chartWidget && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            {chartWidget}
          </div>
        )}

        {/* Metrics widget slot */}
        {metricsWidget && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            {metricsWidget}
          </div>
        )}
      </div>

      {/* ===== ASSET TAG (below content, above metadata) ===== */}
      {'asset' in item && item.asset && (
        <div className="mt-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAssetClick?.(item.asset!.id, item.asset!.symbol)
            }}
            className={clsx(
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
              'text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors'
            )}
          >
            ${item.asset.symbol}
          </button>
        </div>
      )}

      {/* ===== CUSTOM ACTIONS WIDGET (if provided by parent) ===== */}
      {actionsWidget && (
        <div className="mt-2 border-t border-gray-100 pt-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {actionsWidget}
        </div>
      )}

      {/* ===== FOOTER: Author info only (hidden in "mine" scope) ===== */}
      {showAuthorRow && (
        <div className="pt-2 border-t border-gray-100 mt-auto flex-shrink-0">
          <AuthorInfo
            author={item.author}
            onClick={onAuthorClick}
          />
        </div>
      )}

      {/* ===== FOOTER WIDGET SLOT ===== */}
      {footerWidget && (
        <div className="mt-2 pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
          {footerWidget}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// AUTHOR INFO COMPONENT
// =============================================================================

interface AuthorInfoProps {
  author: Author
  onClick?: (authorId: string) => void
}

/**
 * AuthorInfo - Displays author avatar (initials) + name.
 * 20px avatar, text-xs name, muted gray.
 */
function AuthorInfo({ author, onClick }: AuthorInfoProps) {
  const displayName = author.full_name ||
    (author.first_name && author.last_name
      ? `${author.first_name} ${author.last_name}`
      : author.email?.split('@')[0] || 'Unknown')

  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(author.id)
      }}
      className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 transition-colors"
    >
      {/* 20px avatar with initials */}
      {author.avatar_url ? (
        <img
          src={author.avatar_url}
          alt={displayName}
          className="w-5 h-5 rounded-full object-cover"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
          <span className="text-[9px] font-medium text-gray-600">{initials}</span>
        </div>
      )}
      {/* Author name - text-xs, muted */}
      <span className="text-xs">{displayName}</span>
    </button>
  )
}

export default IdeaCard
