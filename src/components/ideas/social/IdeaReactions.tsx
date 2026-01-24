import React, { useState } from 'react'
import { clsx } from 'clsx'
import {
  ThumbsUp, Heart, Sparkles, TrendingDown, TrendingUp, HelpCircle
} from 'lucide-react'
import { useIdeaReactions } from '../../../hooks/ideas/useIdeaReactions'
import type { ItemType, ReactionType } from '../../../hooks/ideas/types'

interface IdeaReactionsProps {
  itemId: string
  itemType: ItemType
  variant?: 'compact' | 'default' | 'fullscreen'
  compact?: boolean
  className?: string
}

// Reaction configuration with icons and colors
const reactionConfig: Record<ReactionType, { icon: typeof ThumbsUp; label: string; color: string; activeColor: string }> = {
  like: {
    icon: ThumbsUp,
    label: 'Like',
    color: 'text-gray-500 hover:text-blue-600',
    activeColor: 'text-blue-600'
  },
  love: {
    icon: Heart,
    label: 'Love',
    color: 'text-gray-500 hover:text-red-500',
    activeColor: 'text-red-500'
  },
  insightful: {
    icon: Sparkles,
    label: 'Insightful',
    color: 'text-gray-500 hover:text-amber-500',
    activeColor: 'text-amber-500'
  },
  bullish: {
    icon: TrendingUp,
    label: 'Bullish',
    color: 'text-gray-500 hover:text-green-600',
    activeColor: 'text-green-600'
  },
  bearish: {
    icon: TrendingDown,
    label: 'Bearish',
    color: 'text-gray-500 hover:text-red-600',
    activeColor: 'text-red-600'
  },
  question: {
    icon: HelpCircle,
    label: 'Question',
    color: 'text-gray-500 hover:text-purple-600',
    activeColor: 'text-purple-600'
  }
}

export function IdeaReactions({
  itemId,
  itemType,
  variant = 'default',
  compact = false,
  className
}: IdeaReactionsProps) {
  const [showAll, setShowAll] = useState(false)
  const { reactionCounts, toggleReaction, isToggling } = useIdeaReactions(itemId, itemType)

  const effectiveVariant = compact ? 'compact' : variant

  // For compact view, only show like and a few with counts
  const visibleReactions = effectiveVariant === 'compact'
    ? ['like', 'love', 'insightful'] as ReactionType[]
    : showAll
      ? Object.keys(reactionConfig) as ReactionType[]
      : ['like', 'love', 'insightful', 'bullish'] as ReactionType[]

  const handleReaction = (reaction: ReactionType) => {
    if (!isToggling) {
      toggleReaction(reaction)
    }
  }

  if (effectiveVariant === 'fullscreen') {
    return (
      <div className={clsx('flex items-center gap-4', className)}>
        {visibleReactions.map(reaction => {
          const config = reactionConfig[reaction]
          const Icon = config.icon
          const data = reactionCounts[reaction]
          const count = data?.count || 0
          const hasReacted = data?.hasReacted || false

          return (
            <button
              key={reaction}
              onClick={() => handleReaction(reaction)}
              disabled={isToggling}
              className={clsx(
                'flex items-center gap-2 transition-all',
                hasReacted ? 'text-white' : 'text-white/70 hover:text-white',
                isToggling && 'opacity-50'
              )}
              title={config.label}
            >
              <Icon className={clsx(
                'h-6 w-6',
                hasReacted && 'fill-current'
              )} />
              {count > 0 && (
                <span className="text-lg font-medium">{count}</span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className={clsx(
      'flex items-center',
      effectiveVariant === 'compact' ? 'gap-1' : 'gap-2',
      className
    )}>
      {visibleReactions.map(reaction => {
        const config = reactionConfig[reaction]
        const Icon = config.icon
        const data = reactionCounts[reaction]
        const count = data?.count || 0
        const hasReacted = data?.hasReacted || false

        return (
          <button
            key={reaction}
            onClick={() => handleReaction(reaction)}
            disabled={isToggling}
            className={clsx(
              'flex items-center gap-0.5 transition-all',
              effectiveVariant === 'compact' ? 'p-1' : 'px-2 py-1 rounded-full hover:bg-gray-100',
              hasReacted ? config.activeColor : config.color,
              isToggling && 'opacity-50'
            )}
            title={config.label}
          >
            <Icon className={clsx(
              effectiveVariant === 'compact' ? 'h-3.5 w-3.5' : 'h-4 w-4',
              hasReacted && 'fill-current'
            )} />
            {count > 0 && (
              <span className={clsx(
                'font-medium',
                effectiveVariant === 'compact' ? 'text-xs' : 'text-sm'
              )}>
                {count}
              </span>
            )}
          </button>
        )
      })}

      {effectiveVariant !== 'compact' && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-gray-400 hover:text-gray-600 px-2"
        >
          +{Object.keys(reactionConfig).length - visibleReactions.length}
        </button>
      )}
    </div>
  )
}

export default IdeaReactions
