/**
 * CommandBriefing — Synthesized intelligence panel.
 *
 * Shows 2-4 concise, high-value narrative insights about the current
 * state of the decision pipeline, coverage, and work in progress.
 *
 * Replaces the single-insight SystemInsightCard with a richer
 * briefing strip that feels like the system speaking intelligently.
 */

import { useMemo } from 'react'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  Clock,
  FileText,
  CheckCircle2,
  ArrowRight,
  Gauge,
  Activity,
} from 'lucide-react'
import type { CockpitViewModel, CockpitBand } from '../../types/cockpit'
import type { ExecutionStats } from './ExecutionSnapshotCard'
import { buildBriefingInsights, type BriefingInsight } from '../../lib/dashboard/dashboardIntelligence'

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const INSIGHT_ICON: Record<BriefingInsight['icon'], React.FC<{ className?: string }>> = {
  bottleneck: Gauge,
  aging: Clock,
  stale: FileText,
  progress: CheckCircle2,
  clear: CheckCircle2,
  workload: AlertTriangle,
  execution: Activity,
}

const SEVERITY_STYLES: Record<BriefingInsight['severity'], {
  dot: string
  text: string
  cta: string
}> = {
  critical: {
    dot: 'bg-red-500',
    text: 'text-gray-700 dark:text-gray-200',
    cta: 'text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300',
  },
  warning: {
    dot: 'bg-amber-500',
    text: 'text-gray-700 dark:text-gray-200',
    cta: 'text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300',
  },
  info: {
    dot: 'bg-blue-400',
    text: 'text-gray-600 dark:text-gray-300',
    cta: 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300',
  },
  positive: {
    dot: 'bg-emerald-500',
    text: 'text-gray-600 dark:text-gray-300',
    cta: 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300',
  },
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CommandBriefingProps {
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  isLoading?: boolean
  onScrollToBand?: (band: CockpitBand) => void
  onOpenTradeQueue?: (filter?: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandBriefing({
  viewModel,
  pipelineStats,
  isLoading,
  onScrollToBand,
  onOpenTradeQueue,
}: CommandBriefingProps) {
  const insights = useMemo(
    () => buildBriefingInsights(viewModel, pipelineStats, onScrollToBand, onOpenTradeQueue),
    [viewModel, pipelineStats, onScrollToBand, onOpenTradeQueue],
  )

  if (isLoading || insights.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-200/80 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Briefing
        </span>
      </div>

      {/* Insight rows */}
      <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
        {insights.map(insight => {
          const severity = SEVERITY_STYLES[insight.severity]

          return (
            <div
              key={insight.id}
              className="flex items-center gap-2.5 px-3.5 py-2 group"
            >
              {/* Severity dot */}
              <div className={clsx('w-1.5 h-1.5 rounded-full shrink-0', severity.dot)} />

              {/* Text */}
              <p className={clsx('flex-1 text-[11.5px] leading-snug min-w-0', severity.text)}>
                {insight.text}
              </p>

              {/* CTA — always visible for critical/warning, hover for info/positive */}
              {insight.ctaLabel && insight.ctaAction && (
                <button
                  onClick={insight.ctaAction}
                  className={clsx(
                    'shrink-0 flex items-center gap-0.5 text-[11px] font-semibold transition-colors whitespace-nowrap',
                    insight.severity === 'critical' || insight.severity === 'warning'
                      ? ''
                      : 'opacity-0 group-hover:opacity-100',
                    severity.cta,
                  )}
                >
                  {insight.ctaLabel}
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
