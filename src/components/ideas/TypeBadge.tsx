import React from 'react'
import { clsx } from 'clsx'
import {
  Lightbulb, TrendingUp, FileText, GitBranch, Sparkles, MessageSquare, CheckCircle
} from 'lucide-react'
import type { ItemType } from '../../hooks/ideas/types'

// Type configuration - colors and icons for each item type
export const typeConfig: Record<ItemType, {
  icon: typeof Lightbulb
  label: string
  color: string
  bg: string
  iconColor: string // Muted color for icon-only mode
}> = {
  quick_thought: {
    icon: Lightbulb,
    label: 'Thought',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    iconColor: 'text-indigo-400'
  },
  trade_idea: {
    icon: TrendingUp,
    label: 'Trade',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    iconColor: 'text-emerald-400'
  },
  note: {
    icon: FileText,
    label: 'Note',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    iconColor: 'text-blue-400'
  },
  thesis_update: {
    icon: GitBranch,
    label: 'Thesis',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    iconColor: 'text-purple-400'
  },
  insight: {
    icon: Sparkles,
    label: 'Insight',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-400'
  },
  message: {
    icon: MessageSquare,
    label: 'Message',
    color: 'text-gray-600',
    bg: 'bg-gray-50',
    iconColor: 'text-gray-400'
  }
}

export interface TypeBadgeProps {
  type: ItemType
  /**
   * Icon-only mode: shows just the icon in muted gray.
   * Use when view is filtered to a single type (redundant to show full badge).
   */
  compact?: boolean
  /**
   * If item has been promoted to a Trade Idea, show promoted state instead.
   */
  isPromoted?: boolean
  /**
   * Link to the promoted Trade Idea (opens on click).
   */
  promotedIdeaId?: string
  onPromotedClick?: (ideaId: string) => void
}

export function TypeBadge({
  type,
  compact = false,
  isPromoted = false,
  promotedIdeaId,
  onPromotedClick
}: TypeBadgeProps) {
  const config = typeConfig[type]
  const TypeIcon = config.icon

  // Promoted state: green CheckCircle + "Promoted" label
  if (isPromoted) {
    const handleClick = (e: React.MouseEvent) => {
      if (promotedIdeaId && onPromotedClick) {
        e.stopPropagation()
        onPromotedClick(promotedIdeaId)
      }
    }

    return (
      <button
        onClick={handleClick}
        disabled={!promotedIdeaId}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
          'bg-green-50 text-green-600',
          promotedIdeaId && 'hover:bg-green-100 cursor-pointer',
          !promotedIdeaId && 'cursor-default'
        )}
      >
        <CheckCircle className="h-3 w-3" />
        <span>Promoted</span>
      </button>
    )
  }

  // Compact mode: icon-only, muted color
  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-1 text-gray-400"
        title={config.label}
      >
        <TypeIcon className="h-3 w-3" />
        <span className="text-[10px] uppercase tracking-wide font-medium">
          {config.label}
        </span>
      </div>
    )
  }

  // Full badge: pill with background
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      config.bg, config.color
    )}>
      <TypeIcon className="h-3 w-3" />
      <span>{config.label}</span>
    </span>
  )
}

export default TypeBadge
