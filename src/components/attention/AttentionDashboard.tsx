/**
 * AttentionDashboard - Container for attention/priority sections.
 *
 * Can render a filtered subset of sections with custom title/subtitle.
 * Designed to integrate into the dashboard as "Research & Deliverables"
 * or "Team" with consistent styling.
 *
 * Design principles:
 * - Anchoring question at top
 * - Minimal, judgment-oriented framing
 * - Simple empty state without filler
 * - Consistent container styling matching dashboard cards
 */

import { RefreshCw, AlertCircle, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useAttention } from '../../hooks/useAttention'
import { AttentionSection } from './AttentionSection'
import type { QuickCaptureMode, DismissReason } from './AttentionCard'
import type { AttentionItem, AttentionType } from '../../types/attention'

// ---------------------------------------------------------------------------
// Shared section styling (matches dashboard cards)
// ---------------------------------------------------------------------------

const SECTION_CONTAINER = 'border border-gray-100 dark:border-gray-700/50 rounded-lg bg-white dark:bg-gray-800/40 overflow-hidden'
const SECTION_HEADER = 'flex items-center gap-2 px-3.5 py-2 border-b border-gray-100/80 dark:border-gray-700/40'
const SECTION_TITLE = 'text-[12px] font-medium text-gray-600 dark:text-gray-300'

interface AttentionDashboardProps {
  onNavigate: (item: AttentionItem) => void
  onQuickCapture?: (item: AttentionItem, mode: QuickCaptureMode) => void
  onViewAll?: (type: AttentionType) => void
  maxItemsPerSection?: number
  showScore?: boolean
  compact?: boolean
  className?: string
  /** Which sections to render (default: all 4) */
  sections?: AttentionType[]
  /** Override "Priorities" header */
  sectionTitle?: string
  /** Override anchoring question subtitle */
  sectionSubtitle?: string
  /** Default collapsed state for the section (default: false) */
  defaultCollapsed?: boolean
  /** Icon element to render in header */
  icon?: React.ReactNode
}

export function AttentionDashboard({
  onNavigate,
  onQuickCapture,
  onViewAll,
  maxItemsPerSection = 5,
  showScore = false,
  compact = false,
  className,
  sections: sectionFilter,
  sectionTitle,
  sectionSubtitle,
  defaultCollapsed = false,
  icon,
}: AttentionDashboardProps) {
  const {
    sections,
    counts,
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

  const headerTitle = sectionTitle ?? 'Priorities'
  const headerSubtitle = sectionSubtitle ?? ''

  // Section order — filtered if prop provided
  const sectionOrder: AttentionType[] = sectionFilter ?? [
    'informational',
    'action_required',
    'decision_required',
    'alignment',
  ]

  // Check filtered sections for items
  const filteredHasItems = sectionFilter
    ? sectionOrder.some(type => (sections[type]?.length ?? 0) > 0)
    : hasItems

  // Count items in filtered sections
  const filteredCount = sectionFilter
    ? sectionOrder.reduce((sum, type) => sum + (sections[type]?.length ?? 0), 0)
    : counts.total

  // Loading state
  if (isLoading) {
    return (
      <div className={clsx(SECTION_CONTAINER, className)}>
        <div className={SECTION_HEADER}>
          {icon}
          <h2 className={SECTION_TITLE}>{headerTitle}</h2>
        </div>
        <div className="px-4 py-6 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 rounded bg-gray-100 dark:bg-gray-700/30 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className={clsx(SECTION_CONTAINER, className)}>
        <div className={SECTION_HEADER}>
          {icon}
          <h2 className={SECTION_TITLE}>{headerTitle}</h2>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span className="text-[11px] text-red-600 dark:text-red-400">
              {error instanceof Error ? error.message : 'Failed to load'}
            </span>
            <button
              onClick={() => refetch()}
              className="text-[11px] font-medium text-red-700 dark:text-red-300 hover:underline ml-2"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Empty state
  if (!filteredHasItems) {
    return (
      <div className={clsx(SECTION_CONTAINER, className)}>
        <div className={clsx(SECTION_HEADER, 'border-b-0')}>
          {icon}
          <h2 className={SECTION_TITLE}>{headerTitle}</h2>
          <div className="flex-1" />
          {headerSubtitle && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
              {headerSubtitle}
            </span>
          )}
        </div>
        <div className="px-4 py-4 text-[11px] text-gray-400 dark:text-gray-500">
          All caught up.
        </div>
      </div>
    )
  }

  return (
    <div className={clsx(SECTION_CONTAINER, className)}>
      {/* Header — consistent with other dashboard cards */}
      <div className={SECTION_HEADER}>
        {icon}
        <h2 className={SECTION_TITLE}>{headerTitle}</h2>
        {filteredCount > 0 && (
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums min-w-[20px] text-center bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {filteredCount}
          </span>
        )}
        <div className="flex-1" />
        {headerSubtitle && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 italic hidden sm:inline">
            {headerSubtitle}
          </span>
        )}
        {onViewAll && sectionFilter && sectionFilter.length > 0 && (
          <button
            onClick={() => onViewAll(sectionFilter[0])}
            className="flex items-center gap-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            View all
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className={clsx(
            'p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700/40 transition-colors',
            isFetching && 'opacity-50'
          )}
          title="Refresh"
        >
          <RefreshCw
            className={clsx(
              'w-3.5 h-3.5 text-gray-400',
              isFetching && 'animate-spin'
            )}
          />
        </button>
      </div>

      {/* Attention sections — rendered inside the card container */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
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
            showEmpty={false}
            initialExpanded={!defaultCollapsed && (type === 'action_required' || type === 'decision_required')}
          />
        ))}
      </div>
    </div>
  )
}

// Re-export types for convenience
export type { QuickCaptureMode, DismissReason } from './AttentionCard'

export default AttentionDashboard
