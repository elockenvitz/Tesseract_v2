/**
 * AttentionDashboard - Main container for the "10-minute screen"
 *
 * Displays 4 attention sections in order:
 * 1. What I Need To Do (action_required)
 * 2. Decisions I Need To Make (decision_required)
 * 3. What's New (informational)
 * 4. Team Priority (alignment)
 *
 * Design principles:
 * - Anchoring question at top: "What needs attention right now?"
 * - Minimal, judgment-oriented framing
 * - Simple empty state without filler
 */

import { RefreshCw, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { useAttention } from '../../hooks/useAttention'
import { AttentionSection } from './AttentionSection'
import type { QuickCaptureMode, DismissReason } from './AttentionCard'
import type { AttentionItem, AttentionType } from '../../types/attention'

interface AttentionDashboardProps {
  onNavigate: (item: AttentionItem) => void
  onQuickCapture?: (item: AttentionItem, mode: QuickCaptureMode) => void
  onViewAll?: (type: AttentionType) => void
  maxItemsPerSection?: number
  showScore?: boolean
  compact?: boolean
  className?: string
}

export function AttentionDashboard({
  onNavigate,
  onQuickCapture,
  onViewAll,
  maxItemsPerSection = 5,
  showScore = false,
  compact = false,
  className,
}: AttentionDashboardProps) {
  const {
    sections,
    counts,
    generatedAt,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    acknowledge,
    snoozeFor,
    dismiss,
    hasItems,
    // Resolution actions
    markDeliverableDone,
    approveTradeIdea,
    rejectTradeIdea,
    deferTradeIdea,
    dismissWithReason,
  } = useAttention({ windowHours: 24 })

  // Section order
  const sectionOrder: AttentionType[] = [
    'informational',
    'action_required',
    'decision_required',
    'alignment',
  ]

  // Loading state
  if (isLoading) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Priorities</h2>
          <p className="text-sm text-gray-500 italic mt-1">
            What needs attention right now?
          </p>
        </div>
        {/* Loading skeletons */}
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-xl bg-gray-100 animate-pulse"
          />
        ))}
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Priorities</h2>
          <p className="text-sm text-gray-500 italic mt-1">
            What needs attention right now?
          </p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <div>
              <h3 className="text-sm font-medium text-red-800">
                Failed to load attention items
              </h3>
              <p className="text-sm text-red-600 mt-1">
                {error instanceof Error ? error.message : 'An unknown error occurred'}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  // Empty state - intentionally simple
  if (!hasItems) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Priorities</h2>
          <p className="text-sm text-gray-500 italic mt-1">
            What needs attention right now?
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 py-12 text-center">
          <p className="text-sm text-gray-600">
            All caught up.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Priorities</h2>
          {/* Anchoring question - quiet, intentional framing */}
          <p className="text-sm text-gray-500 italic mt-1">
            What needs attention right now?
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">
              {counts.total} {counts.total === 1 ? 'item' : 'items'}
            </span>
            {generatedAt && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-400">
                  Updated {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
                </span>
              </>
            )}
          </div>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className={clsx(
            'p-1.5 rounded-lg hover:bg-gray-100 transition-colors',
            isFetching && 'opacity-50'
          )}
          title="Refresh"
        >
          <RefreshCw
            className={clsx(
              'w-4 h-4 text-gray-400',
              isFetching && 'animate-spin'
            )}
          />
        </button>
      </div>

      {/* Attention sections */}
      {sectionOrder.map((type) => (
        <AttentionSection
          key={type}
          type={type}
          items={sections[type]}
          totalCount={counts[type]}
          onNavigate={onNavigate}
          onAcknowledge={acknowledge}
          onSnooze={snoozeFor}
          onDismiss={dismiss}
          onDismissWithReason={dismissWithReason}
          onMarkDone={markDeliverableDone}
          onApprove={approveTradeIdea}
          onReject={rejectTradeIdea}
          onDefer={deferTradeIdea}
          onQuickCapture={onQuickCapture}
          onViewAll={onViewAll ? () => onViewAll(type) : undefined}
          maxItems={maxItemsPerSection}
          showScore={showScore}
          compact={compact}
          showEmpty={true}
          initialExpanded={type === 'action_required' || type === 'decision_required'}
        />
      ))}
    </div>
  )
}

// Re-export types for convenience
export type { QuickCaptureMode, DismissReason } from './AttentionCard'

export default AttentionDashboard
