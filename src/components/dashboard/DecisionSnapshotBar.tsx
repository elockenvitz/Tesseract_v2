/**
 * DecisionSnapshotBar — Capital allocation command center header.
 *
 * Shows 4 compact tiles that let the PM scan status in 5-8 seconds:
 *   [Awaiting You] [Aging Risk] [High Impact] [In Pipeline]
 *
 * Each tile is clickable and navigates to the relevant section.
 * Respects portfolio/coverage/urgent filters via the viewModel.
 */

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { Scale, AlertTriangle, Zap, Activity } from 'lucide-react'
import type { CockpitViewModel, CockpitBand } from '../../types/cockpit'
import type { ExecutionStats } from './ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DecisionSnapshotBarProps {
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  isLoading?: boolean
  portfolioName?: string | null
  onScrollToBand?: (band: CockpitBand) => void
  onOpenTradeQueue?: (filter?: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DecisionSnapshotBar({
  viewModel,
  pipelineStats,
  isLoading,
  portfolioName,
  onScrollToBand,
  onOpenTradeQueue,
}: DecisionSnapshotBarProps) {
  const metrics = useMemo(() => {
    const decideItems = viewModel.decide.stacks.flatMap(s => s.itemsAll)
    const awaitingCount = decideItems.length
    const highImpactCount = decideItems.filter(i => i.severity === 'HIGH').length
    const oldestDays = decideItems.length > 0
      ? Math.max(...decideItems.map(i => i.ageDays ?? 0))
      : 0
    const pipelineTotal =
      pipelineStats.awaitingDecision + pipelineStats.modeling + pipelineStats.executing
    const blockedOnDecision = pipelineStats.awaitingDecision

    return { awaitingCount, highImpactCount, oldestDays, pipelineTotal, blockedOnDecision }
  }, [viewModel, pipelineStats])

  if (isLoading) {
    return <div className="h-[76px] bg-gray-50 dark:bg-gray-800/40 rounded-lg animate-pulse" />
  }

  const scopeLabel = portfolioName
    ? `Today for ${portfolioName}`
    : 'Today across all portfolios'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="px-4 pt-2.5 pb-3">
        {/* Scope label */}
        <div className="text-[11px] text-gray-400 dark:text-gray-500 font-medium mb-2.5">
          {scopeLabel}
        </div>

        {/* Tiles */}
        <div className="grid grid-cols-4 gap-3">
          <SnapshotTile
            icon={<Scale className="w-4 h-4" />}
            label="Awaiting You"
            value={metrics.awaitingCount}
            subtext={
              metrics.awaitingCount > 0
                ? `${metrics.highImpactCount} high impact`
                : 'All clear'
            }
            accent={
              metrics.awaitingCount > 3
                ? 'red'
                : metrics.awaitingCount > 0
                  ? 'amber'
                  : 'green'
            }
            onClick={() => onScrollToBand?.('DECIDE')}
          />

          <SnapshotTile
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Aging Risk"
            value={
              metrics.oldestDays >= 7
                ? 'High'
                : metrics.oldestDays >= 3
                  ? 'Moderate'
                  : metrics.oldestDays > 0
                    ? 'Low'
                    : '\u2014'
            }
            subtext={
              metrics.oldestDays >= 7
                ? `${metrics.awaitingCount > 1 ? 'Decisions' : 'Decision'} stalling >${metrics.oldestDays}d`
                : metrics.oldestDays >= 3
                  ? 'Approaching threshold'
                  : metrics.oldestDays > 0
                    ? 'Within threshold'
                    : 'No pending'
            }
            accent={
              metrics.oldestDays >= 7
                ? 'red'
                : metrics.oldestDays >= 3
                  ? 'amber'
                  : 'gray'
            }
            onClick={() => onScrollToBand?.('DECIDE')}
          />

          <SnapshotTile
            icon={<Zap className="w-4 h-4" />}
            label="High Impact"
            value={metrics.highImpactCount}
            subtext={
              metrics.highImpactCount > 0
                ? 'Require prioritization'
                : 'None flagged'
            }
            accent={metrics.highImpactCount > 0 ? 'red' : 'gray'}
            onClick={() => onScrollToBand?.('DECIDE')}
          />

          <SnapshotTile
            icon={<Activity className="w-4 h-4" />}
            label="In Pipeline"
            value={metrics.pipelineTotal}
            subtext={
              metrics.blockedOnDecision > 0
                ? `${metrics.blockedOnDecision} blocked on decision`
                : 'Pipeline clear'
            }
            accent={metrics.blockedOnDecision > 0 ? 'amber' : 'gray'}
            onClick={() => onOpenTradeQueue?.()}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tile accent config
// ---------------------------------------------------------------------------

const TILE_ACCENT = {
  red: {
    value: 'text-red-600 dark:text-red-400',
    icon: 'text-red-500 dark:text-red-400',
    bg: 'bg-red-50/40 dark:bg-red-950/10',
  },
  amber: {
    value: 'text-amber-600 dark:text-amber-400',
    icon: 'text-amber-500 dark:text-amber-400',
    bg: 'bg-amber-50/40 dark:bg-amber-950/10',
  },
  green: {
    value: 'text-emerald-600 dark:text-emerald-400',
    icon: 'text-emerald-500 dark:text-emerald-400',
    bg: 'bg-emerald-50/40 dark:bg-emerald-950/10',
  },
  gray: {
    value: 'text-gray-500 dark:text-gray-400',
    icon: 'text-gray-400 dark:text-gray-500',
    bg: '',
  },
} as const

// ---------------------------------------------------------------------------
// Tile sub-component
// ---------------------------------------------------------------------------

function SnapshotTile({
  icon,
  label,
  value,
  subtext,
  accent,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  subtext: string
  accent: keyof typeof TILE_ACCENT
  onClick?: () => void
}) {
  const colors = TILE_ACCENT[accent]

  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-left rounded-md px-3 py-2 transition-colors',
        'hover:bg-gray-50 dark:hover:bg-gray-700/30',
        colors.bg,
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={colors.icon}>{icon}</span>
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div
        className={clsx(
          'text-[20px] font-bold tabular-nums leading-none mb-0.5',
          colors.value,
        )}
      >
        {value}
      </div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
        {subtext}
      </div>
    </button>
  )
}
