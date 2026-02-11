import { useState, useMemo } from 'react'
import { LineChart, ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import {
  getPlaceholderFundamentals,
  FUNDAMENTAL_GROUPS,
  type PortfolioFundamentalMetric,
  type FundamentalFormat,
} from '../../lib/trade-lab/portfolio-fundamentals'

interface PortfolioFundamentalsCardProps {
  holdingsAfterCount: number
}

// ---------------------------------------------------------------------------
// MetricRow — reusable row for a single fundamental metric
// ---------------------------------------------------------------------------

function formatValue(value: number | null, format: FundamentalFormat): string {
  if (value == null) return '—'
  switch (format) {
    case 'percent': return `${value.toFixed(1)}%`
    case 'multiple': return `${value.toFixed(1)}x`
    case 'number': return value.toFixed(1)
  }
}

function MetricRow({ metric }: { metric: PortfolioFundamentalMetric }) {
  const beforeStr = formatValue(metric.before, metric.format)
  const afterStr = formatValue(metric.after, metric.format)
  const deltaStr = formatValue(metric.delta, metric.format)

  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      {/* Label */}
      <span className="text-gray-600 dark:text-gray-400 min-w-0 truncate">{metric.label}</span>

      {/* Values */}
      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
        {/* Before → After */}
        <div className="flex items-center gap-1.5 tabular-nums">
          <span className="text-gray-400 dark:text-gray-500 w-10 text-right">{beforeStr}</span>
          <span className="text-gray-300 dark:text-gray-600">→</span>
          <span className={clsx(
            "w-10 text-right font-medium",
            metric.isPlaceholder
              ? "text-gray-300 dark:text-gray-600"
              : "text-gray-900 dark:text-white"
          )}>
            {afterStr}
          </span>
        </div>

        {/* Delta */}
        <span className="text-gray-300 dark:text-gray-600 w-12 text-right tabular-nums text-xs">
          ({deltaStr})
        </span>

        {/* Coverage */}
        <span className="text-xs text-gray-400 dark:text-gray-500 w-14 text-right tabular-nums">
          {metric.coverageCount}/{metric.coverageTotal}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PortfolioFundamentalsCard
// ---------------------------------------------------------------------------

export function PortfolioFundamentalsCard({ holdingsAfterCount }: PortfolioFundamentalsCardProps) {
  const [showMore, setShowMore] = useState(false)

  const metrics = useMemo(
    () => getPlaceholderFundamentals(holdingsAfterCount),
    [holdingsAfterCount],
  )

  const primaryMetrics = metrics.filter(m => !m.isSecondary)
  const secondaryMetrics = metrics.filter(m => m.isSecondary)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
          <LineChart className="h-4 w-4" />
          Portfolio Fundamentals
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
          Not connected
        </span>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Portfolio-weighted (Before → After).
      </p>

      {/* Column headers */}
      <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 pb-1.5 border-b border-gray-100 dark:border-gray-700/50 mb-1">
        <span>Metric</span>
        <div className="flex items-center gap-3">
          <span className="w-[92px] text-center">Before → After</span>
          <span className="w-12 text-right">Delta</span>
          <span className="w-14 text-right">Coverage</span>
        </div>
      </div>

      {/* Grouped primary metrics */}
      <div className="space-y-3">
        {FUNDAMENTAL_GROUPS.map(group => {
          const groupMetrics = primaryMetrics.filter(m => m.group === group.key)
          if (groupMetrics.length === 0) return null
          return (
            <div key={group.key}>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5 mt-2">
                {group.label}
              </div>
              {groupMetrics.map(m => (
                <MetricRow key={m.key} metric={m} />
              ))}
            </div>
          )
        })}
      </div>

      {/* Show more toggle */}
      {secondaryMetrics.length > 0 && (
        <>
          <button
            onClick={() => setShowMore(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mt-3 transition-colors"
          >
            {showMore ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showMore ? 'Show less' : 'Show more metrics'}
          </button>

          {showMore && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50 space-y-0.5">
              {secondaryMetrics.map(m => (
                <MetricRow key={m.key} metric={m} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Footer note */}
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
        Connect fundamentals to enable valuation, yield, growth, and quality metrics.
      </p>
    </div>
  )
}
