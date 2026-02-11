import { useMemo } from 'react'
import { BarChart3, AlertTriangle, Check, TrendingUp, TrendingDown } from 'lucide-react'
import { clsx } from 'clsx'
import type { SimulationMetrics } from '../../types/trading'
import type { SimulationRow } from '../../hooks/useSimulationRows'

interface PortfolioCharacteristicsProps {
  metrics: SimulationMetrics
  simulationRows: SimulationRow[]
}

type RiskLevel = 'low' | 'medium' | 'high'

function getRiskLevel(value: number, thresholds: [number, number]): RiskLevel {
  if (value > thresholds[1]) return 'high'
  if (value > thresholds[0]) return 'medium'
  return 'low'
}

const RISK_BAR_COLORS: Record<RiskLevel, string> = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500',
}

const RISK_BADGE: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: 'Diversified', className: 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400' },
  medium: { label: 'Moderate', className: 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400' },
  high: { label: 'Concentrated', className: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400' },
}

/** Horizontal bar with before/after overlay and risk coloring */
function ConcentrationBar({ label, before, after, thresholds, markers }: {
  label: string
  before: number
  after: number
  thresholds: [number, number]  // [medium, high]
  markers?: boolean
}) {
  const risk = getRiskLevel(after, thresholds)
  const delta = after - before
  const improved = delta < 0

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {before.toFixed(1)}%
          </span>
          <span className="text-gray-400">→</span>
          <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
            {after.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="relative h-3.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        {/* Before bar (lighter) */}
        <div
          className={clsx("absolute inset-y-0 left-0 rounded-full opacity-30", RISK_BAR_COLORS[risk])}
          style={{ width: `${Math.min(before, 100)}%` }}
        />
        {/* After bar */}
        <div
          className={clsx("absolute inset-y-0 left-0 rounded-full transition-all duration-500", RISK_BAR_COLORS[risk])}
          style={{ width: `${Math.min(after, 100)}%` }}
        />
        {/* Threshold markers */}
        {markers && (
          <>
            <div className="absolute inset-y-0 w-px bg-yellow-400 opacity-50" style={{ left: `${thresholds[0]}%` }} />
            <div className="absolute inset-y-0 w-px bg-red-400 opacity-50" style={{ left: `${thresholds[1]}%` }} />
          </>
        )}
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className={clsx("text-xs px-2 py-0.5 rounded-full flex items-center gap-1", RISK_BADGE[risk].className)}>
          {risk === 'low' ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {RISK_BADGE[risk].label}
        </span>
        {Math.abs(delta) >= 0.05 && (
          <span className={clsx("text-xs font-medium flex items-center gap-0.5", improved ? "text-green-600" : "text-amber-600")}>
            {improved ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

export function PortfolioCharacteristics({ metrics, simulationRows }: PortfolioCharacteristicsProps) {
  const positionProfile = useMemo(() => {
    // Find largest position by simulated weight
    const withWeight = simulationRows.filter(r => r.simWeight > 0)
    const sorted = [...withWeight].sort((a, b) => b.simWeight - a.simWeight)
    const largest = sorted[0] || null
    const overFivePercent = sorted.filter(r => r.simWeight >= 5).length
    const overFivePercentBefore = simulationRows.filter(r => r.currentWeight >= 5).length

    return { largest, overFivePercent, overFivePercentBefore }
  }, [simulationRows])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2 text-sm">
        <BarChart3 className="h-4 w-4" />
        Portfolio Characteristics
      </h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — Concentration */}
        <div className="space-y-4">
          <ConcentrationBar
            label="Top 5 Positions"
            before={metrics.top_5_concentration_before}
            after={metrics.top_5_concentration_after}
            thresholds={[35, 50]}
            markers
          />
          <ConcentrationBar
            label="Top 10 Positions"
            before={metrics.top_10_concentration_before}
            after={metrics.top_10_concentration_after}
            thresholds={[50, 70]}
          />

        </div>

        {/* Right — Position Profile */}
        <div className="space-y-3">
          {/* Total Positions */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Total Positions</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                {metrics.position_count_before}
              </span>
              <span className="text-gray-400">→</span>
              <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                {metrics.position_count_after}
              </span>
              {metrics.positions_added > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
                  +{metrics.positions_added}
                </span>
              )}
              {metrics.positions_removed > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                  -{metrics.positions_removed}
                </span>
              )}
            </div>
          </div>

          {/* Average Position Size */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Avg Position Size</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                {metrics.avg_position_size_before.toFixed(2)}%
              </span>
              <span className="text-gray-400">→</span>
              <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                {metrics.avg_position_size_after.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Largest Position */}
          {positionProfile.largest && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">Largest Position</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 dark:text-white text-sm">
                  {positionProfile.largest.symbol}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                  {positionProfile.largest.simWeight.toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          {/* Positions > 5% */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Positions &gt; 5%</span>
            <div className="flex items-center gap-2">
              {positionProfile.overFivePercentBefore !== positionProfile.overFivePercent && (
                <>
                  <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                    {positionProfile.overFivePercentBefore}
                  </span>
                  <span className="text-gray-400">→</span>
                </>
              )}
              <span className={clsx(
                "font-semibold tabular-nums",
                positionProfile.overFivePercent > 5 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"
              )}>
                {positionProfile.overFivePercent}
              </span>
              {positionProfile.overFivePercent > 5 && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              )}
            </div>
          </div>

          {/* Positions Adjusted */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
            <span className="text-sm text-gray-600 dark:text-gray-400">Positions Adjusted</span>
            <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
              {metrics.positions_adjusted}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
