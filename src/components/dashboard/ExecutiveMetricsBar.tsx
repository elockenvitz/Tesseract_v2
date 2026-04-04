/**
 * ExecutiveMetricsBar — Compact, high-density metrics strip.
 *
 * 5 tiles: Awaiting You | Bottleneck | Aging Risk | Pending Execution | Throughput
 *
 * Each tile is compact with strong typography hierarchy:
 *   - Metric value (large, bold)
 *   - Label (small caps)
 *   - Supporting subline (context)
 *
 * Replaces the softer DecisionSnapshotBar with sharper institutional styling.
 */

import { useMemo } from 'react'
import { clsx } from 'clsx'
import type { CockpitViewModel, CockpitBand } from '../../types/cockpit'
import type { ExecutionStats } from './ExecutionSnapshotCard'
import { summarizeBottleneck } from '../../lib/dashboard/dashboardIntelligence'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExecutiveMetricsBarProps {
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  isLoading?: boolean
  onScrollToBand?: (band: CockpitBand) => void
  onOpenTradeQueue?: (filter?: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutiveMetricsBar({
  viewModel,
  pipelineStats,
  isLoading,
  onScrollToBand,
  onOpenTradeQueue,
}: ExecutiveMetricsBarProps) {
  const metrics = useMemo(() => {
    const decideItems = viewModel.decide.stacks.flatMap(s => s.itemsAll)
    const awaitingCount = decideItems.length
    const highImpactCount = decideItems.filter(i => i.severity === 'HIGH').length

    const oldestDays = decideItems.length > 0
      ? Math.max(...decideItems.map(i => i.ageDays ?? 0))
      : 0

    const bottleneck = summarizeBottleneck(pipelineStats)

    const executingCount = pipelineStats.stages.executing.count

    // Throughput: total items resolved (advance + aware items as proxy)
    const advanceTotal = viewModel.advance.totalItems
    const pipelineTotal = bottleneck.total

    return {
      awaitingCount,
      highImpactCount,
      oldestDays,
      bottleneck,
      executingCount,
      advanceTotal,
      pipelineTotal,
    }
  }, [viewModel, pipelineStats])

  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-px bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[68px] bg-gray-50 dark:bg-gray-800/60 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-5 gap-px bg-gray-200/80 dark:bg-gray-700/60 rounded-lg overflow-hidden shadow-sm">
      {/* Awaiting You — dominant tile */}
      <MetricTile
        value={metrics.awaitingCount}
        label="Awaiting you"
        primary
        subtext={
          metrics.awaitingCount === 0
            ? 'Queue clear'
            : metrics.highImpactCount > 0
              ? `${metrics.highImpactCount} high impact`
              : metrics.awaitingCount >= 5
                ? 'Backlog building'
                : 'act now'
        }
        accent={
          metrics.awaitingCount > 5 ? 'critical'
            : metrics.awaitingCount > 0 ? 'warning'
              : 'neutral'
        }
        onClick={() => onScrollToBand?.('DECIDE')}
      />

      {/* Bottleneck */}
      <MetricTile
        value={metrics.bottleneck.isHealthy ? '\u2014' : metrics.bottleneck.label}
        label="Bottleneck"
        subtext={
          metrics.bottleneck.isHealthy
            ? 'Pipeline flowing'
            : `${metrics.bottleneck.count} stalled \u00B7 ${metrics.bottleneck.medianDays}d median`
        }
        accent={
          !metrics.bottleneck.isHealthy && metrics.bottleneck.medianDays >= 7
            ? 'critical'
            : !metrics.bottleneck.isHealthy
              ? 'warning'
              : 'neutral'
        }
        onClick={() => onOpenTradeQueue?.(metrics.bottleneck.stage ?? undefined)}
        small={typeof metrics.bottleneck.label === 'string' && metrics.bottleneck.label.length > 5}
      />

      {/* Aging Risk */}
      <MetricTile
        value={
          metrics.oldestDays >= 10 ? 'High'
            : metrics.oldestDays >= 7 ? 'Elevated'
              : metrics.oldestDays > 0 ? 'Low'
                : '\u2014'
        }
        label="Aging risk"
        subtext={
          metrics.oldestDays >= 10 ? `${metrics.oldestDays}d stalled`
            : metrics.oldestDays >= 7 ? `${metrics.oldestDays}d \u2014 near limit`
              : metrics.oldestDays > 0 ? `oldest ${metrics.oldestDays}d`
                : 'none open'
        }
        accent={
          metrics.oldestDays >= 10 ? 'critical'
            : metrics.oldestDays >= 7 ? 'warning'
              : 'neutral'
        }
        onClick={() => onScrollToBand?.('DECIDE')}
      />

      {/* Execution Gap */}
      <MetricTile
        value={metrics.executingCount}
        label="Execution gap"
        subtext={
          metrics.executingCount >= 3
            ? 'not acted on'
            : metrics.executingCount > 0
              ? 'approved, unexecuted'
              : 'clear'
        }
        accent={metrics.executingCount >= 3 ? 'warning' : 'neutral'}
        onClick={() => onOpenTradeQueue?.('executing')}
      />

      {/* Pipeline */}
      <MetricTile
        value={metrics.pipelineTotal}
        label="Active pipeline"
        subtext={
          metrics.pipelineTotal > 0
            ? `${metrics.advanceTotal} in flight`
            : 'clear'
        }
        accent="neutral"
        onClick={() => onOpenTradeQueue?.()}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// MetricTile
// ---------------------------------------------------------------------------

type TileAccent = 'critical' | 'warning' | 'neutral'

const ACCENT_STYLES: Record<TileAccent, { value: string; bg: string }> = {
  critical: {
    value: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50/30 dark:bg-red-950/10',
  },
  warning: {
    value: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50/20 dark:bg-amber-950/10',
  },
  neutral: {
    value: 'text-gray-700 dark:text-gray-200',
    bg: 'bg-white dark:bg-gray-800/60',
  },
}

function MetricTile({
  value,
  label,
  subtext,
  accent,
  onClick,
  small,
  primary,
}: {
  value: string | number
  label: string
  subtext: string
  accent: TileAccent
  onClick?: () => void
  small?: boolean
  primary?: boolean
}) {
  const styles = ACCENT_STYLES[accent]

  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-left transition-colors',
        primary ? 'px-4 py-2.5' : 'px-3.5 py-2.5',
        'hover:bg-gray-50/80 dark:hover:bg-gray-700/40',
        styles.bg,
      )}
    >
      <div className={clsx(
        'font-semibold uppercase tracking-wider mb-1',
        primary ? 'text-[10px] text-gray-500 dark:text-gray-400' : 'text-[10px] text-gray-400 dark:text-gray-500',
      )}>
        {label}
      </div>
      <div
        className={clsx(
          'font-bold tabular-nums leading-none mb-1',
          primary ? 'text-[26px]' : small ? 'text-[16px]' : 'text-[20px]',
          styles.value,
        )}
      >
        {value}
      </div>
      <div className={clsx(
        'leading-tight truncate',
        primary ? 'text-[11px] text-gray-500 dark:text-gray-400' : 'text-[10px] text-gray-400 dark:text-gray-500',
      )}>
        {subtext}
      </div>
    </button>
  )
}
