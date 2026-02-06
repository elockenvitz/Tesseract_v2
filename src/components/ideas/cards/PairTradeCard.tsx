import React from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  TrendingUp,
  TrendingDown,
  Zap,
  FlaskConical,
  Clock,
  MoreVertical,
  Building2,
  Lock,
  Users
} from 'lucide-react'
import type { PairTradeItem, TradeUrgency, ScoredFeedItem, Author } from '../../../hooks/ideas/types'

const urgencyConfig: Record<TradeUrgency, { color: string; bg: string; darkBg: string; label: string }> = {
  low: { color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100', darkBg: 'dark:bg-slate-800', label: 'Low' },
  medium: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100', darkBg: 'dark:bg-blue-900/30', label: 'Medium' },
  high: { color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100', darkBg: 'dark:bg-orange-900/30', label: 'High' },
  urgent: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100', darkBg: 'dark:bg-red-900/30', label: 'Urgent!' }
}

interface PairTradeCardProps {
  item: ScoredFeedItem & PairTradeItem
  size?: 'small' | 'medium' | 'large'
  onClick?: () => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onLabClick?: (labId: string, labName: string, portfolioId: string) => void
  onMenuClick?: (e: React.MouseEvent) => void
  className?: string
  actionsWidget?: React.ReactNode
  labInclusions?: {
    count: number
    labNames: string[]
    labIds: string[]
    portfolioIds: string[]
  }
}

export function PairTradeCard({
  item,
  size = 'medium',
  onClick,
  onAuthorClick,
  onAssetClick,
  onLabClick,
  onMenuClick,
  className,
  actionsWidget,
  labInclusions
}: PairTradeCardProps) {
  const urgency = urgencyConfig[item.urgency]

  const sizeClasses = {
    small: 'p-3',
    medium: 'p-4',
    large: 'p-5'
  }

  const thesis = item.rationale || item.content || ''
  const labCount = labInclusions?.count || 0
  const singlePortfolioName = !labInclusions && item.portfolio?.name

  return (
    <div
      className={clsx(
        'w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm transition-all duration-200 overflow-hidden flex flex-col',
        onClick && 'hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer',
        sizeClasses[size],
        className
      )}
      onClick={onClick}
    >
      {/* Top Row: LONG/SHORT header + Urgency + Menu */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* LONG symbols / SHORT symbols */}
          <div className="flex items-center gap-1.5 text-sm min-w-0 flex-1">
            <span className="font-semibold text-green-600 dark:text-green-400">LONG</span>
            <span className="font-semibold text-gray-900 dark:text-white truncate">{item.long_legs.map(l => l.asset.symbol).join(', ') || '?'}</span>
            <span className="text-gray-400 dark:text-gray-500">/</span>
            <span className="font-semibold text-red-600 dark:text-red-400">SHORT</span>
            <span className="font-semibold text-gray-900 dark:text-white truncate">{item.short_legs.map(l => l.asset.symbol).join(', ') || '?'}</span>
          </div>

          {/* Urgency badge */}
          <span className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
            urgency.bg, urgency.darkBg, urgency.color
          )}>
            <Zap className="h-3 w-3" />
            {urgency.label}
          </span>
        </div>

        {/* Menu button */}
        {onMenuClick && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMenuClick(e)
            }}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Pair Trade Legs - Side by Side */}
      <div className="flex gap-3 mb-3">
        {/* Long Side */}
        <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-lg p-2.5 border border-green-200 dark:border-green-800">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            <span className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase">Long</span>
          </div>
          <div className="space-y-1">
            {item.long_legs.map((leg) => (
              <button
                key={leg.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onAssetClick?.(leg.asset.id, leg.asset.symbol)
                }}
                className="block w-full text-left"
              >
                <span className="text-sm font-bold text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200">
                  ${leg.asset.symbol}
                </span>
                {size !== 'small' && (
                  <span className="block text-xs text-green-600/70 dark:text-green-400/70 truncate">
                    {leg.asset.company_name}
                  </span>
                )}
              </button>
            ))}
            {item.long_legs.length === 0 && (
              <span className="text-xs text-green-600/50 dark:text-green-400/50 italic">No long positions</span>
            )}
          </div>
        </div>

        {/* Short Side */}
        <div className="flex-1 bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5 border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase">Short</span>
          </div>
          <div className="space-y-1">
            {item.short_legs.map((leg) => (
              <button
                key={leg.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onAssetClick?.(leg.asset.id, leg.asset.symbol)
                }}
                className="block w-full text-left"
              >
                <span className="text-sm font-bold text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200">
                  ${leg.asset.symbol}
                </span>
                {size !== 'small' && (
                  <span className="block text-xs text-red-600/70 dark:text-red-400/70 truncate">
                    {leg.asset.company_name}
                  </span>
                )}
              </button>
            ))}
            {item.short_legs.length === 0 && (
              <span className="text-xs text-red-600/50 dark:text-red-400/50 italic">No short positions</span>
            )}
          </div>
        </div>
      </div>

      {/* Portfolio/Labs Line */}
      {(labCount > 0 || singlePortfolioName) && (
        <div className="mb-3">
          {labCount > 0 ? (
            labCount === 1 && labInclusions ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onLabClick?.(labInclusions.labIds[0], labInclusions.labNames[0], labInclusions.portfolioIds[0])
                }}
                className="inline-flex items-center gap-1.5 text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
              >
                <FlaskConical className="h-3.5 w-3.5" />
                <span>in {labInclusions.labNames[0]}</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5 text-sm text-purple-600 dark:text-purple-400">
                <FlaskConical className="h-3.5 w-3.5" />
                <span>in {labCount} Trade Labs</span>
              </div>
            )
          ) : singlePortfolioName ? (
            <div className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
              <Building2 className="h-3.5 w-3.5" />
              <span>{singlePortfolioName}</span>
            </div>
          ) : null}
        </div>
      )}

      {/* Thesis/Rationale */}
      {thesis && (
        <div className="mb-3">
          <p className={clsx(
            "text-gray-800 dark:text-gray-200 leading-relaxed",
            size === 'small' ? 'text-sm font-medium' : 'text-sm',
            size === 'small' ? 'line-clamp-2' : size === 'medium' ? 'line-clamp-3' : 'line-clamp-5'
          )}>
            {thesis}
          </p>
        </div>
      )}

      {/* Actions Widget (reactions, bookmarks, etc.) */}
      {actionsWidget && (
        <div className="mb-3 border-t border-gray-100 dark:border-gray-700 pt-2" onClick={(e) => e.stopPropagation()}>
          {actionsWidget}
        </div>
      )}

      {/* Footer: Author + Visibility + Time */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700 mt-auto">
        <AuthorInfo
          author={item.author}
          onClick={onAuthorClick}
        />

        <div className="flex items-center gap-3">
          {/* Visibility indicator */}
          {item.sharing_visibility && item.sharing_visibility !== 'private' ? (
            <div className="flex items-center gap-1 text-blue-500 dark:text-blue-400" title="Shared with portfolio members">
              <Users className="h-3 w-3" />
              <span className="text-[10px]">Portfolio</span>
            </div>
          ) : (
            <div className="flex items-center gap-1" title="Private - only visible to you">
              <Lock className="h-3 w-3" />
              <span className="text-[10px]">Private</span>
            </div>
          )}

          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
          </div>
        </div>
      </div>
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
      className="flex items-center gap-2 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
    >
      {author.avatar_url ? (
        <img
          src={author.avatar_url}
          alt={displayName}
          className="w-5 h-5 rounded-full object-cover"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
          <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300">{initials}</span>
        </div>
      )}
      <span className="font-medium">{displayName}</span>
    </button>
  )
}

export default PairTradeCard
