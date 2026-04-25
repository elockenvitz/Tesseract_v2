import { useMemo } from 'react'
import { Shield, ChevronUp, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import type { SimulationRow } from '../../hooks/useSimulationRows'

interface PortfolioRiskCardProps {
  simulationRows: SimulationRow[]
  benchmarkWeightMap: Record<string, number>
  hasBenchmark: boolean
}

/** Format a weight in basis points when small, percent otherwise. */
function fmtWeight(pct: number, decimals = 2): string {
  if (Math.abs(pct) < 1 && Math.abs(pct) > 0) {
    return `${Math.round(pct * 100)} bps`
  }
  return `${pct.toFixed(decimals)}%`
}

function fmtDelta(pct: number): string {
  if (Math.abs(pct) < 0.005) return '—'
  const sign = pct > 0 ? '+' : '−'
  const abs = Math.abs(pct)
  if (abs < 1) return `${sign}${Math.round(abs * 100)} bps`
  return `${sign}${abs.toFixed(2)}%`
}

interface ActiveBet {
  asset_id: string
  symbol: string
  portfolioWeight: number
  benchmarkWeight: number
  activeWeight: number
  deltaActive: number // change in active weight from before to after
}

interface RiskMetrics {
  activeShareBefore: number
  activeShareAfter: number
  offBenchmarkBefore: number
  offBenchmarkAfter: number
  missedBenchmarkBefore: number
  missedBenchmarkAfter: number
  topOverweights: ActiveBet[]
  topUnderweights: ActiveBet[]
  activeNameCount: number
}

function computeRiskMetrics(
  simulationRows: SimulationRow[],
  benchmarkWeightMap: Record<string, number>,
): RiskMetrics {
  // Universe = union of portfolio holdings and benchmark constituents.
  const rowByAsset = new Map<string, SimulationRow>()
  simulationRows
    .filter(r => !r.isCash)
    .forEach(r => rowByAsset.set(r.asset_id, r))

  const assetIds = new Set<string>([
    ...rowByAsset.keys(),
    ...Object.keys(benchmarkWeightMap),
  ])

  let activeShareBefore = 0
  let activeShareAfter = 0
  let offBenchmarkBefore = 0
  let offBenchmarkAfter = 0
  let missedBenchmarkBefore = 0
  let missedBenchmarkAfter = 0
  const activeBets: ActiveBet[] = []

  assetIds.forEach(assetId => {
    const row = rowByAsset.get(assetId)
    const bench = benchmarkWeightMap[assetId] ?? 0
    const before = row?.currentWeight ?? 0
    const after = row?.simWeight ?? 0

    activeShareBefore += Math.abs(before - bench)
    activeShareAfter += Math.abs(after - bench)

    // Off-benchmark: portfolio owns something not in the benchmark
    if (bench === 0) {
      offBenchmarkBefore += before
      offBenchmarkAfter += after
    }
    // Missed benchmark: benchmark has a name we don't own (underweight to zero)
    if (before === 0) missedBenchmarkBefore += bench
    if (after === 0) missedBenchmarkAfter += bench

    // Collect active bets for ranking (skip names with no meaningful position)
    if (before !== 0 || after !== 0 || bench > 0) {
      const activeAfter = after - bench
      const activeBefore = before - bench
      activeBets.push({
        asset_id: assetId,
        symbol: row?.symbol || '—',
        portfolioWeight: after,
        benchmarkWeight: bench,
        activeWeight: activeAfter,
        deltaActive: activeAfter - activeBefore,
      })
    }
  })

  activeShareBefore *= 0.5
  activeShareAfter *= 0.5

  // Top 3 overweights and underweights by |activeWeight| in the "after" state
  const byActive = [...activeBets].sort((a, b) => b.activeWeight - a.activeWeight)
  const topOverweights = byActive.filter(b => b.activeWeight > 0.005).slice(0, 3)
  const topUnderweights = [...byActive]
    .reverse()
    .filter(b => b.activeWeight < -0.005)
    .slice(0, 3)

  // Active names: |active weight| ≥ 25 bps
  const activeNameCount = activeBets.filter(b => Math.abs(b.activeWeight) >= 0.25).length

  return {
    activeShareBefore,
    activeShareAfter,
    offBenchmarkBefore,
    offBenchmarkAfter,
    missedBenchmarkBefore,
    missedBenchmarkAfter,
    topOverweights,
    topUnderweights,
    activeNameCount,
  }
}

function MetricRow({ label, before, after, deltaGood = 'down', hint }: {
  label: string
  before: number
  after: number
  /** Which direction is "improvement" for coloring — e.g. tracking error down = good */
  deltaGood?: 'up' | 'down' | 'none'
  hint?: string
}) {
  const delta = after - before
  const changed = Math.abs(delta) >= 0.005
  const improving = deltaGood === 'none'
    ? false
    : deltaGood === 'down'
      ? delta < 0
      : delta > 0

  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-gray-600 dark:text-gray-400 truncate" title={hint}>
        {label}
      </span>
      <div className="flex items-center gap-2.5 flex-shrink-0 ml-3 tabular-nums">
        <span className="text-gray-400 dark:text-gray-500 w-14 text-right">
          {fmtWeight(before)}
        </span>
        <span className="text-gray-300 dark:text-gray-600">→</span>
        <span className="font-medium text-gray-900 dark:text-white w-14 text-right">
          {fmtWeight(after)}
        </span>
        <span className={clsx(
          'w-16 text-right text-xs',
          !changed ? 'text-gray-400'
            : deltaGood === 'none' ? 'text-gray-500 dark:text-gray-400'
            : improving ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-amber-600 dark:text-amber-400',
        )}>
          {fmtDelta(delta)}
        </span>
      </div>
    </div>
  )
}

function ActiveBetRow({ bet }: { bet: ActiveBet }) {
  const isOver = bet.activeWeight > 0
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        {isOver
          ? <ChevronUp className="h-3 w-3 text-emerald-500 flex-shrink-0" />
          : <ChevronDown className="h-3 w-3 text-red-500 flex-shrink-0" />}
        <span className="font-medium text-gray-700 dark:text-gray-300 truncate">
          {bet.symbol}
        </span>
        <span className="text-gray-400 dark:text-gray-500 text-[10px]">
          {bet.portfolioWeight.toFixed(2)}% vs {bet.benchmarkWeight.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-2 tabular-nums">
        <span className={clsx(
          'font-medium',
          isOver ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        )}>
          {isOver ? '+' : '−'}{Math.abs(bet.activeWeight * 100).toFixed(0)} bps
        </span>
        {Math.abs(bet.deltaActive) >= 0.005 && (
          <span className={clsx(
            'text-[10px] w-12 text-right',
            bet.deltaActive > 0 ? 'text-emerald-500' : 'text-red-500',
          )}>
            {fmtDelta(bet.deltaActive)}
          </span>
        )}
      </div>
    </div>
  )
}

export function PortfolioRiskCard({
  simulationRows,
  benchmarkWeightMap,
  hasBenchmark,
}: PortfolioRiskCardProps) {
  const risk = useMemo(
    () => computeRiskMetrics(simulationRows, benchmarkWeightMap),
    [simulationRows, benchmarkWeightMap],
  )

  if (!hasBenchmark) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
            <Shield className="h-4 w-4" />
            Risk vs Benchmark
          </h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
            Benchmark not set
          </span>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Configure a benchmark on this portfolio to see active share, active
          bets, and tracking-error metrics here.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
          <Shield className="h-4 w-4" />
          Risk vs Benchmark
        </h3>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Portfolio positioning vs. the assigned benchmark (Before → After).
      </p>

      {/* Column headers */}
      <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 pb-1.5 border-b border-gray-100 dark:border-gray-700/50 mb-1">
        <span>Metric</span>
        <div className="flex items-center gap-2.5">
          <span className="w-[120px] text-center">Before → After</span>
          <span className="w-16 text-right">Delta</span>
        </div>
      </div>

      {/* Core risk metrics */}
      <div className="space-y-0.5">
        <MetricRow
          label="Active Share"
          before={risk.activeShareBefore}
          after={risk.activeShareAfter}
          deltaGood="none"
          hint="Half the sum of absolute differences between portfolio and benchmark weights. 0% = index-like, 100% = fully active."
        />
        <MetricRow
          label="Off-benchmark weight"
          before={risk.offBenchmarkBefore}
          after={risk.offBenchmarkAfter}
          deltaGood="none"
          hint="Share of the portfolio held in names absent from the benchmark."
        />
        <MetricRow
          label="Unheld benchmark names"
          before={risk.missedBenchmarkBefore}
          after={risk.missedBenchmarkAfter}
          deltaGood="none"
          hint="Benchmark weight in names the portfolio does not own."
        />
      </div>

      {/* Active bets */}
      {(risk.topOverweights.length > 0 || risk.topUnderweights.length > 0) && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Largest active bets
            </span>
            {risk.activeNameCount > 0 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {risk.activeNameCount} name{risk.activeNameCount !== 1 ? 's' : ''} ≥ 25 bps
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5 gap-y-0">
            {risk.topOverweights.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-0.5">
                  Overweights
                </div>
                {risk.topOverweights.map(bet => (
                  <ActiveBetRow key={bet.asset_id} bet={bet} />
                ))}
              </div>
            )}
            {risk.topUnderweights.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-0.5">
                  Underweights
                </div>
                {risk.topUnderweights.map(bet => (
                  <ActiveBetRow key={bet.asset_id} bet={bet} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Return-based risk metrics placeholder */}
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
        Tracking error and beta require historical returns — connect a
        returns feed to enable them here.
      </p>
    </div>
  )
}
