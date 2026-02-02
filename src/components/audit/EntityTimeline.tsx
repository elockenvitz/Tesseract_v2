/**
 * EntityTimeline Component
 *
 * Displays a chronological timeline of audit events for an entity.
 * Use this on detail pages to show the complete history of changes.
 */

import { useState } from 'react'
import {
  Plus,
  Trash2,
  RotateCcw,
  ArrowRight,
  CheckCircle2,
  Edit2,
  Star,
  Target,
  UserPlus,
  UserMinus,
  Archive,
  Link2,
  Unlink,
  Activity,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useEntityAuditEvents, formatEventSummary } from '../../hooks/useAuditEvents'
import type { EntityType, AuditEvent } from '../../lib/audit'

interface EntityTimelineProps {
  entityType: EntityType
  entityId: string
  className?: string
  maxItems?: number
  showHeader?: boolean
  collapsible?: boolean
  /** Action types to exclude from the timeline */
  excludeActions?: string[]
}

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  create: Plus,
  delete: Trash2,
  restore: RotateCcw,
  move_stage: ArrowRight,
  set_outcome: CheckCircle2,
  update_field: Edit2,
  update_fields: Edit2,
  set_rating: Star,
  set_price_target: Target,
  assign_coverage: UserPlus,
  remove_coverage: UserMinus,
  auto_archive: Archive,
  attach: Link2,
  detach: Unlink,
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  restore: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  move_stage: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  set_outcome: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  update_field: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  update_fields: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  auto_archive: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

function formatFullTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function TimelineEvent({ event, isFirst, isLast }: { event: AuditEvent; isFirst: boolean; isLast: boolean }) {
  const Icon = ACTION_ICONS[event.action_type] || Activity
  const colorClass = ACTION_COLORS[event.action_type] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
  const summary = formatEventSummary(event)

  return (
    <div className="relative flex gap-3">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
          colorClass
        )}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 min-h-[16px]" />
        )}
      </div>

      {/* Event content */}
      <div className="flex-1 pb-3 min-w-0">
        <p className="text-sm text-gray-900 dark:text-white">
          {summary}
        </p>
        <span
          className="text-xs text-gray-500 dark:text-gray-400"
          title={formatFullTime(event.occurred_at)}
        >
          {formatRelativeTime(event.occurred_at)}
        </span>
      </div>
    </div>
  )
}

export function EntityTimeline({
  entityType,
  entityId,
  className,
  maxItems = 10,
  showHeader = true,
  collapsible = true,
  excludeActions = [],
}: EntityTimelineProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const { data, isLoading, error } = useEntityAuditEvents(entityType, entityId, {
    limit: 100,
    orderDirection: 'desc',
  })

  if (isLoading) {
    return (
      <div className={clsx('p-4', className)}>
        <div className="flex items-center gap-2 text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          <span className="text-sm">Loading activity...</span>
        </div>
      </div>
    )
  }

  if (error) {
    console.error('[EntityTimeline] Error loading activity:', error)
    return (
      <div className={clsx('p-4', className)}>
        <p className="text-sm text-gray-500 dark:text-gray-400">No activity recorded yet</p>
      </div>
    )
  }

  // useEntityAuditEvents returns an array directly, not an object with events property
  const rawEvents = Array.isArray(data) ? data : (data?.events || [])
  // Filter out excluded action types
  const events = excludeActions.length > 0
    ? rawEvents.filter((e: AuditEvent) => !excludeActions.includes(e.action_type))
    : rawEvents
  const displayedEvents = showAll ? events : events.slice(0, maxItems)
  const hasMore = events.length > maxItems

  if (events.length === 0) {
    return (
      <div className={clsx('p-4', className)}>
        <p className="text-sm text-gray-500 dark:text-gray-400">No activity recorded yet</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({events.length})
            </span>
          </h3>
          {collapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              {isCollapsed ? 'Show' : 'Hide'}
            </button>
          )}
        </div>
      )}

      {/* Timeline */}
      {!isCollapsed && (
        <>
          <div className="space-y-0">
            {displayedEvents.map((event, index) => (
              <TimelineEvent
                key={event.id}
                event={event}
                isFirst={index === 0}
                isLast={index === displayedEvents.length - 1 && !hasMore}
              />
            ))}
          </div>

          {/* Show more/less button */}
          {hasMore && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mt-2 text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
            >
              {showAll ? `Show less` : `Show ${events.length - maxItems} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
