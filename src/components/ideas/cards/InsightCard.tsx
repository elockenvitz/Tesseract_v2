import React from 'react'
import { clsx } from 'clsx'
import {
  Sparkles, BarChart3, Lightbulb, Bell, TrendingUp, GraduationCap,
  Bot, User as UserIcon, Cpu
} from 'lucide-react'
import { IdeaCard, type IdeaCardProps } from '../IdeaCard'
import type { InsightItem, ScoredFeedItem } from '../../../hooks/ideas/types'

const insightTypeConfig = {
  market_insight: { icon: BarChart3, color: 'text-green-600', bg: 'bg-green-50', label: 'Market Insight' },
  research_tip: { icon: Lightbulb, color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Research Tip' },
  portfolio_alert: { icon: Bell, color: 'text-red-600', bg: 'bg-red-50', label: 'Portfolio Alert' },
  trend_analysis: { icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Trend Analysis' },
  educational: { icon: GraduationCap, color: 'text-purple-600', bg: 'bg-purple-50', label: 'Educational' }
}

const sourceConfig = {
  ai: { icon: Bot, label: 'AI Generated', color: 'text-cyan-600' },
  user: { icon: UserIcon, label: 'User', color: 'text-gray-600' },
  system: { icon: Cpu, label: 'System', color: 'text-gray-500' }
}

interface InsightCardProps extends Omit<IdeaCardProps, 'item'> {
  item: ScoredFeedItem & InsightItem
  onTagClick?: (tag: string) => void
}

export function InsightCard({
  item,
  onTagClick,
  ...props
}: InsightCardProps) {
  const typeConfig = insightTypeConfig[item.insight_type] || insightTypeConfig.market_insight
  const TypeIcon = typeConfig.icon
  const srcConfig = sourceConfig[item.source] || sourceConfig.system
  const SourceIcon = srcConfig.icon

  const headerWidget = (
    <div className="flex items-center gap-2">
      {/* Insight type badge */}
      <span className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        typeConfig.bg, typeConfig.color
      )}>
        <TypeIcon className="h-3 w-3" />
        {typeConfig.label}
      </span>

      {/* Source indicator */}
      <span className={clsx(
        'inline-flex items-center gap-1 text-xs',
        srcConfig.color
      )}>
        <SourceIcon className="h-3 w-3" />
        {srcConfig.label}
      </span>
    </div>
  )

  const footerWidget = item.tags && item.tags.length > 0 ? (
    <div className="flex flex-wrap gap-1">
      {item.tags.slice(0, 4).map(tag => (
        <button
          key={tag}
          onClick={(e) => {
            e.stopPropagation()
            onTagClick?.(tag)
          }}
          className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full hover:bg-gray-200 transition-colors"
        >
          #{tag}
        </button>
      ))}
      {item.tags.length > 4 && (
        <span className="text-xs text-gray-400">+{item.tags.length - 4}</span>
      )}
    </div>
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

export default InsightCard
