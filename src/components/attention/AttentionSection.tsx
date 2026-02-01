/**
 * AttentionSection - Collapsible section for attention items
 *
 * Displays a group of attention items with:
 * - Header with icon, title, and count
 * - Expandable content showing items
 * - "View all" link when there are more items
 */

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Newspaper,
  CheckCircle,
  Scale,
  Users,
} from 'lucide-react'
import { clsx } from 'clsx'
import { AttentionCard, type QuickCaptureMode, type DismissReason } from './AttentionCard'
import type { AttentionItem, AttentionType } from '../../types/attention'

// Section configuration
// Sections represent the four priority types:
// 1. What's New - Activity from others that's relevant to you
// 2. To Do - Things you're responsible for acting on
// 3. Decisions - Explicit decision points requiring approval/rejection
// 4. Team - Alignment and shared awareness items
const SECTION_CONFIG: Record<AttentionType, {
  title: string
  icon: React.ElementType
  color: string
  bgColor: string
  borderColor: string
}> = {
  informational: {
    title: "What's New",
    icon: Newspaper,
    color: 'text-sky-600',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
  },
  action_required: {
    title: 'To Do',
    icon: CheckCircle,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  decision_required: {
    title: 'Decisions',
    icon: Scale,
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
  },
  alignment: {
    title: 'Team',
    icon: Users,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
  },
}

interface AttentionSectionProps {
  type: AttentionType
  items: AttentionItem[]
  totalCount: number
  onNavigate: (item: AttentionItem) => void
  onAcknowledge?: (id: string) => void
  onSnooze?: (id: string, hours: number) => void
  onDismiss?: (id: string) => void
  onDismissWithReason?: (id: string, reason: DismissReason, note?: string) => Promise<void>
  // Inline resolution actions
  onMarkDone?: (sourceId: string) => Promise<void>
  onApprove?: (sourceId: string) => Promise<void>
  onReject?: (sourceId: string) => Promise<void>
  onDefer?: (sourceId: string, hours: number) => Promise<void>
  onQuickCapture?: (item: AttentionItem, mode: QuickCaptureMode) => void
  initialExpanded?: boolean
  maxItems?: number
  showScore?: boolean
  compact?: boolean
  showEmpty?: boolean
  onViewAll?: () => void
}

// Empty state messages per section type
const EMPTY_MESSAGES: Record<AttentionType, string> = {
  informational: 'No new updates at the moment',
  action_required: 'No pending actions',
  decision_required: 'No decisions waiting',
  alignment: 'No team activity to show',
}

export function AttentionSection({
  type,
  items,
  totalCount,
  onNavigate,
  onAcknowledge,
  onSnooze,
  onDismiss,
  onDismissWithReason,
  onMarkDone,
  onApprove,
  onReject,
  onDefer,
  onQuickCapture,
  initialExpanded = true,
  maxItems = 5,
  showScore = false,
  compact = false,
  showEmpty = false,
  onViewAll,
}: AttentionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)

  const config = SECTION_CONFIG[type]
  const Icon = config.icon
  const displayItems = items.slice(0, maxItems)
  const hasMore = totalCount > maxItems
  const isEmpty = items.length === 0

  // Don't render empty sections unless showEmpty is true
  if (isEmpty && !showEmpty) {
    return null
  }

  return (
    <div className={clsx('rounded-xl border', config.borderColor, 'overflow-hidden')}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={clsx(
          'w-full flex items-center gap-3 px-4 py-3',
          config.bgColor,
          'hover:brightness-95 transition-all'
        )}
      >
        <div className={clsx('p-1.5 rounded-lg bg-white/80')}>
          <Icon className={clsx('w-5 h-5', config.color)} />
        </div>

        <div className="flex-1 text-left">
          <h3 className={clsx('text-sm font-semibold', config.color)}>
            {config.title}
          </h3>
        </div>

        <span
          className={clsx(
            'px-2 py-0.5 text-xs font-medium rounded-full',
            'bg-white/80',
            config.color
          )}
        >
          {totalCount}
        </span>

        {isExpanded ? (
          <ChevronDown className={clsx('w-4 h-4', config.color)} />
        ) : (
          <ChevronRight className={clsx('w-4 h-4', config.color)} />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="bg-white">
          {isEmpty ? (
            // Empty state
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-500">{EMPTY_MESSAGES[type]}</p>
            </div>
          ) : compact ? (
            // Compact list view
            <div className="divide-y divide-gray-100">
              {displayItems.map((item) => (
                <AttentionCard
                  key={item.attention_id}
                  item={item}
                  onNavigate={onNavigate}
                  onAcknowledge={onAcknowledge}
                  onSnooze={onSnooze}
                  onDismiss={onDismiss}
                  onDismissWithReason={onDismissWithReason}
                  onMarkDone={onMarkDone}
                  onApprove={onApprove}
                  onReject={onReject}
                  onDefer={onDefer}
                  onQuickCapture={onQuickCapture}
                  showScore={showScore}
                  compact
                />
              ))}
            </div>
          ) : (
            // Card view
            <div className="p-4 space-y-3">
              {displayItems.map((item) => (
                <AttentionCard
                  key={item.attention_id}
                  item={item}
                  onNavigate={onNavigate}
                  onAcknowledge={onAcknowledge}
                  onSnooze={onSnooze}
                  onDismiss={onDismiss}
                  onDismissWithReason={onDismissWithReason}
                  onMarkDone={onMarkDone}
                  onApprove={onApprove}
                  onReject={onReject}
                  onDefer={onDefer}
                  onQuickCapture={onQuickCapture}
                  showScore={showScore}
                />
              ))}
            </div>
          )}

          {/* View all link */}
          {hasMore && (
            <div className="px-4 pb-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onViewAll?.()
                }}
                className={clsx(
                  'w-full py-2 text-sm font-medium text-center rounded-lg',
                  'border border-gray-200 hover:bg-gray-50 transition-colors',
                  config.color
                )}
              >
                View all {totalCount} items
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AttentionSection
