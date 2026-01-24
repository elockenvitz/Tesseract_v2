import React from 'react'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Zap, FolderKanban } from 'lucide-react'
import { IdeaCard, type IdeaCardProps } from '../IdeaCard'
import type { TradeIdeaItem, TradeUrgency, ScoredFeedItem } from '../../../hooks/ideas/types'

const urgencyConfig: Record<TradeUrgency, { color: string; bg: string; label: string }> = {
  low: { color: 'text-slate-600', bg: 'bg-slate-100', label: 'Low' },
  medium: { color: 'text-blue-600', bg: 'bg-blue-100', label: 'Medium' },
  high: { color: 'text-orange-600', bg: 'bg-orange-100', label: 'High' },
  urgent: { color: 'text-red-600', bg: 'bg-red-100', label: 'Urgent!' }
}

interface TradeIdeaCardProps extends Omit<IdeaCardProps, 'item'> {
  item: ScoredFeedItem & TradeIdeaItem
  onPortfolioClick?: (portfolioId: string) => void
}

export function TradeIdeaCard({
  item,
  onPortfolioClick,
  ...props
}: TradeIdeaCardProps) {
  const urgency = urgencyConfig[item.urgency]
  const isBuy = item.action === 'buy'

  const headerWidget = (
    <div className="flex items-center gap-2">
      {/* Buy/Sell indicator */}
      <span className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
        isBuy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      )}>
        {isBuy ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {isBuy ? 'Long' : 'Short'}
      </span>

      {/* Urgency badge */}
      <span className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        urgency.bg, urgency.color
      )}>
        <Zap className="h-3 w-3" />
        {urgency.label}
      </span>
    </div>
  )

  const footerWidget = item.portfolio ? (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onPortfolioClick?.(item.portfolio!.id)
      }}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
    >
      <FolderKanban className="h-3 w-3" />
      <span>{item.portfolio.name}</span>
    </button>
  ) : null

  return (
    <IdeaCard
      item={item}
      headerWidget={headerWidget}
      footerWidget={footerWidget}
      {...props}
    />
  )
}

export default TradeIdeaCard
