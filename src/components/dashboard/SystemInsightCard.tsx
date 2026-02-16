/**
 * SystemInsightCard — Single narrative insight card.
 *
 * Computes exactly ONE insight from existing data and displays:
 *   - Title (short)
 *   - One-sentence body
 *   - "Because ..." explanation
 *   - CTA button
 *
 * Priority order:
 *   1. Pipeline bottleneck (if median age >= 3d in any stage)
 *   2. Stale coverage risk (thesis stack oldest >= 14d)
 *   3. Advance work items pending
 *   4. All clear (neutral)
 */

import { useMemo } from 'react'
import { Lightbulb, ArrowRight } from 'lucide-react'
import type { CockpitViewModel, CockpitBand } from '../../types/cockpit'
import type { ExecutionStats } from './ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Insight {
  title: string
  body: string
  because: string
  ctaLabel: string
  ctaAction: () => void
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SystemInsightCardProps {
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  onScrollToBand?: (band: CockpitBand) => void
  onOpenTradeQueue?: (filter?: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SystemInsightCard({
  viewModel,
  pipelineStats,
  onScrollToBand,
  onOpenTradeQueue,
}: SystemInsightCardProps) {
  const insight = useMemo((): Insight => {
    // ---- Priority 1: Pipeline bottleneck ----
    const stages = [
      { key: 'deciding' as const, label: 'Deciding', detail: pipelineStats.stages.deciding },
      { key: 'modeling' as const, label: 'Modeling', detail: pipelineStats.stages.modeling },
      { key: 'executing' as const, label: 'Executing', detail: pipelineStats.stages.executing },
    ].filter(s => s.detail.count > 0)

    if (stages.length > 0) {
      const bottleneck = stages.reduce((worst, s) => {
        const wAge = worst.detail.medianDays ?? 0
        const sAge = s.detail.medianDays ?? 0
        return sAge > wAge ? s : worst
      })

      if (bottleneck.detail.medianDays != null && bottleneck.detail.medianDays >= 3) {
        const oldest = bottleneck.detail.oldestDays ?? bottleneck.detail.medianDays
        return {
          title: `${bottleneck.label} is the bottleneck`,
          body: `Your ${bottleneck.label.toLowerCase()} stage has a median age of ${bottleneck.detail.medianDays} days with ${bottleneck.detail.count} item${bottleneck.detail.count !== 1 ? 's' : ''} waiting.`,
          because: `Because ${bottleneck.detail.count > 1
            ? `${bottleneck.detail.count} items have`
            : '1 item has'} been in this stage for up to ${oldest} day${oldest !== 1 ? 's' : ''}, slowing downstream execution.`,
          ctaLabel: `Review ${bottleneck.label.toLowerCase()}`,
          ctaAction: () => onOpenTradeQueue?.(bottleneck.key),
        }
      }
    }

    // ---- Priority 2: Stale coverage risk ----
    const thesisStack = viewModel.advance.stacks.find(s => s.kind === 'thesis')
    if (thesisStack && thesisStack.count > 0 && thesisStack.oldestAgeDays >= 14) {
      return {
        title: 'Stale coverage detected',
        body: `${thesisStack.count} holding${thesisStack.count !== 1 ? 's have' : ' has'} a thesis older than ${thesisStack.oldestAgeDays} days.`,
        because: 'Because outdated research increases blind-spot risk in your portfolio.',
        ctaLabel: 'Review stale theses',
        ctaAction: () => onScrollToBand?.('ADVANCE'),
      }
    }

    // ---- Priority 3: Advance work items ----
    const advanceTotal = viewModel.advance.totalItems
    if (advanceTotal > 0) {
      return {
        title: 'Work items pending',
        body: `${advanceTotal} item${advanceTotal !== 1 ? 's' : ''} across your advance queue need follow-up.`,
        because: 'Because unresolved work items can create decision backlogs downstream.',
        ctaLabel: 'View advance queue',
        ctaAction: () => onScrollToBand?.('ADVANCE'),
      }
    }

    // ---- Priority 4: All clear ----
    return {
      title: 'All clear',
      body: 'No bottlenecks detected in your pipeline or coverage.',
      because: 'Your decision pipeline is flowing smoothly.',
      ctaLabel: 'View pipeline',
      ctaAction: () => onOpenTradeQueue?.(),
    }
  }, [viewModel, pipelineStats, onScrollToBand, onOpenTradeQueue])

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 dark:border-gray-700/50">
        <Lightbulb className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
          System Insight
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-3 space-y-2 flex-1 flex flex-col">
        <h4 className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
          {insight.title}
        </h4>
        <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
          {insight.body}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 italic leading-relaxed">
          {insight.because}
        </p>
        <div className="flex-1" />
        <button
          onClick={insight.ctaAction}
          className="flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors pt-1"
        >
          {insight.ctaLabel}
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
