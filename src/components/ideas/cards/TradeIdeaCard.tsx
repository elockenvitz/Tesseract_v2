import React, { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  TrendingUp,
  TrendingDown,
  Zap,
  FlaskConical,
  ChevronDown,
  Clock,
  MoreVertical,
  Building2,
  Lock,
  Users
} from 'lucide-react'
import type { TradeIdeaItem, TradeUrgency, ScoredFeedItem, Author } from '../../../hooks/ideas/types'

const urgencyConfig: Record<TradeUrgency, { color: string; bg: string; darkBg: string; label: string }> = {
  low: { color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100', darkBg: 'dark:bg-slate-800', label: 'Low' },
  medium: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100', darkBg: 'dark:bg-blue-900/30', label: 'Medium' },
  high: { color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100', darkBg: 'dark:bg-orange-900/30', label: 'High' },
  urgent: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100', darkBg: 'dark:bg-red-900/30', label: 'Urgent!' }
}

interface LabInfo {
  labId: string
  labName: string
  portfolioId: string
  portfolioName: string
}

interface TradeIdeaCardProps {
  item: ScoredFeedItem & TradeIdeaItem
  size?: 'small' | 'medium' | 'large'
  onClick?: () => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onLabClick?: (labId: string, labName: string, portfolioId: string) => void
  onMenuClick?: (e: React.MouseEvent) => void
  className?: string
  // Lab inclusion data from useTradeExpressionCounts
  labInclusions?: {
    count: number
    labNames: string[]
    labIds: string[]
    portfolioIds: string[]
  }
}

export function TradeIdeaCard({
  item,
  size = 'medium',
  onClick,
  onAuthorClick,
  onAssetClick,
  onLabClick,
  onMenuClick,
  className,
  labInclusions
}: TradeIdeaCardProps) {
  const [showLabsDropdown, setShowLabsDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const urgency = urgencyConfig[item.urgency]
  const isBuy = item.action === 'buy'

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLabsDropdown(false)
      }
    }
    if (showLabsDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showLabsDropdown])

  const sizeClasses = {
    small: 'p-3',
    medium: 'p-4',
    large: 'p-5'
  }

  // Build the title line: "BUY COIN Coinbase Global"
  const actionLabel = isBuy ? 'BUY' : 'SELL'
  const symbol = item.asset?.symbol || ''
  const companyName = item.asset?.company_name || ''

  // Get lab/portfolio info
  const labCount = labInclusions?.count || 0
  const hasMultipleLabs = labCount > 1
  const singlePortfolioName = !labInclusions && item.portfolio?.name

  // Content/thesis to display prominently
  const thesis = item.rationale || item.content || ''

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
      {/* Top Row: Action badge + Urgency + Menu */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Buy/Sell badge */}
          <span className={clsx(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold',
            isBuy
              ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
              : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
          )}>
            {isBuy ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {actionLabel}
          </span>

          {/* Urgency badge */}
          <span className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
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

      {/* Main Title: Symbol + Company Name */}
      <div className="mb-2">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 flex-wrap">
          {item.asset && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAssetClick?.(item.asset!.id, item.asset!.symbol)
              }}
              className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
            >
              ${symbol}
            </button>
          )}
          <span className="text-gray-700 dark:text-gray-300 font-medium">
            {companyName}
          </span>
        </h2>
      </div>

      {/* Portfolio/Labs Line */}
      <div className="mb-3 relative" ref={dropdownRef}>
        {labCount > 0 ? (
          // Has lab inclusions
          hasMultipleLabs ? (
            // Multiple labs - show clickable dropdown
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowLabsDropdown(!showLabsDropdown)
              }}
              className="inline-flex items-center gap-1.5 text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>in {labCount} Trade Labs</span>
              <ChevronDown className={clsx(
                "h-3.5 w-3.5 transition-transform",
                showLabsDropdown && "rotate-180"
              )} />
            </button>
          ) : (
            // Single lab - show as link
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (labInclusions && labInclusions.labIds[0]) {
                  onLabClick?.(
                    labInclusions.labIds[0],
                    labInclusions.labNames[0],
                    labInclusions.portfolioIds[0]
                  )
                }
              }}
              className="inline-flex items-center gap-1.5 text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>in {labInclusions?.labNames[0]}</span>
            </button>
          )
        ) : singlePortfolioName ? (
          // No labs but has portfolio
          <div className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <Building2 className="h-3.5 w-3.5" />
            <span>{singlePortfolioName}</span>
          </div>
        ) : null}

        {/* Labs Dropdown */}
        {showLabsDropdown && labInclusions && labCount > 0 && (
          <div
            className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            {labInclusions.labNames.map((name, idx) => (
              <button
                key={labInclusions.labIds[idx]}
                onClick={() => {
                  onLabClick?.(
                    labInclusions.labIds[idx],
                    name,
                    labInclusions.portfolioIds[idx]
                  )
                  setShowLabsDropdown(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white transition-colors"
              >
                <FlaskConical className="h-4 w-4 text-purple-500" />
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thesis/Rationale - Prominent */}
      {thesis && (
        <div className="mb-3">
          <p className={clsx(
            "text-gray-800 dark:text-gray-200 leading-relaxed",
            size === 'small' ? 'text-sm font-medium' : 'text-sm',
            size === 'small' ? 'line-clamp-3' : size === 'medium' ? 'line-clamp-4' : 'line-clamp-6'
          )}>
            {thesis}
          </p>
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

export default TradeIdeaCard
