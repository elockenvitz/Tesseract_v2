import React, { ReactNode } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  MoreVertical, User, Clock, TrendingUp, TrendingDown, Minus,
  Lightbulb, FileText, GitBranch, Sparkles, MessageSquare
} from 'lucide-react'
import type { ScoredFeedItem, CardSize, ItemType, Author } from '../../hooks/ideas/types'

export interface IdeaCardProps {
  item: ScoredFeedItem
  size?: CardSize
  onClick?: () => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onMenuClick?: (e: React.MouseEvent) => void
  className?: string
  // Widget slots
  headerWidget?: ReactNode
  chartWidget?: ReactNode
  metricsWidget?: ReactNode
  actionsWidget?: ReactNode
  footerWidget?: ReactNode
}

const typeConfig: Record<ItemType, { icon: typeof Lightbulb; label: string; color: string; bg: string }> = {
  quick_thought: { icon: Lightbulb, label: 'Thought', color: 'text-indigo-600', bg: 'bg-indigo-50' },
  trade_idea: { icon: TrendingUp, label: 'Trade', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  note: { icon: FileText, label: 'Note', color: 'text-blue-600', bg: 'bg-blue-50' },
  thesis_update: { icon: GitBranch, label: 'Thesis', color: 'text-purple-600', bg: 'bg-purple-50' },
  insight: { icon: Sparkles, label: 'Insight', color: 'text-amber-600', bg: 'bg-amber-50' },
  message: { icon: MessageSquare, label: 'Message', color: 'text-gray-600', bg: 'bg-gray-50' }
}

export function IdeaCard({
  item,
  size = 'medium',
  onClick,
  onAuthorClick,
  onAssetClick,
  onMenuClick,
  className,
  headerWidget,
  chartWidget,
  metricsWidget,
  actionsWidget,
  footerWidget
}: IdeaCardProps) {
  const config = typeConfig[item.type]
  const TypeIcon = config.icon

  const sizeClasses = {
    small: 'p-3 h-56',
    medium: 'p-4 h-64',
    large: 'p-5 min-h-72'
  }

  const contentMaxLines = {
    small: 4,
    medium: 5,
    large: 8
  }

  return (
    <div
      className={clsx(
        'w-full bg-white border border-gray-200 rounded-xl shadow-sm transition-all duration-200 overflow-hidden flex flex-col',
        onClick && 'hover:shadow-md hover:border-gray-300 cursor-pointer',
        sizeClasses[size],
        className
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Type badge */}
          <span className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
            config.bg, config.color
          )}>
            <TypeIcon className="h-3 w-3" />
            <span>{config.label}</span>
          </span>

          {/* Asset ticker in header */}
          {'asset' in item && item.asset && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAssetClick?.(item.asset!.id, item.asset!.symbol)
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-semibold text-primary-700 bg-primary-50 rounded-full hover:bg-primary-100 transition-colors"
            >
              ${item.asset.symbol}
            </button>
          )}

          {/* Header widget slot (e.g., sentiment, urgency) */}
          {headerWidget}
        </div>

        {/* Menu button */}
        {onMenuClick && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMenuClick(e)
            }}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 flex-shrink-0"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Title (for notes and insights) */}
      {'title' in item && item.title && (
        <h3 className="font-semibold text-gray-900 mb-2 line-clamp-1 flex-shrink-0">
          {item.title}
        </h3>
      )}

      {/* Content area - flex-1 to fill available space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Content preview */}
        {item.content && (() => {
          const maxChars = size === 'large' ? 800 : size === 'medium' ? 550 : 400
          const isTruncated = item.content.length > maxChars
          const displayText = isTruncated
            ? item.content.substring(0, maxChars).trim() + '...'
            : item.content
          return (
            <p className="text-sm text-gray-700">
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

      {/* Actions widget slot (reactions, comments, etc.) */}
      {actionsWidget && (
        <div className="mt-2 border-t border-gray-100 pt-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {actionsWidget}
        </div>
      )}

      {/* Footer - pushed to bottom with mt-auto */}
      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100 mt-auto flex-shrink-0">
        <AuthorInfo
          author={item.author}
          onClick={onAuthorClick}
        />

        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
        </div>
      </div>

      {/* Footer widget slot */}
      {footerWidget && (
        <div className="mt-2 pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
          {footerWidget}
        </div>
      )}
    </div>
  )
}

interface AuthorInfoProps {
  author: Author
  onClick?: (authorId: string) => void
}

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
      className="flex items-center gap-2 hover:text-gray-700 transition-colors"
    >
      {author.avatar_url ? (
        <img
          src={author.avatar_url}
          alt={displayName}
          className="w-5 h-5 rounded-full object-cover"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center">
          <span className="text-[10px] font-medium text-gray-600">{initials}</span>
        </div>
      )}
      <span className="font-medium">{displayName}</span>
    </button>
  )
}

export default IdeaCard
