import { useMemo } from 'react'
import { clsx } from 'clsx'
import type { SimulationMetrics } from '../../types/trading'
import type { SimulationRow } from '../../hooks/useSimulationRows'

interface ImpactHeadlineBandProps {
  metrics: SimulationMetrics
  simulationRows: SimulationRow[]
}

/** Compact KPI pill — before→after with color-coded delta */
function KpiPill({ label, before, after, format = 'number', invertColor = false }: {
  label: string
  before: number
  after: number
  format?: 'number' | 'pct'
  invertColor?: boolean  // true = lower is better (concentration metrics)
}) {
  const delta = after - before
  const changed = Math.abs(delta) >= 0.05

  const fmt = (v: number) => {
    if (format === 'pct') return `${v.toFixed(1)}%`
    return String(Math.round(v))
  }

  // For concentration metrics, lower = better (green), higher = worse (amber)
  const improving = invertColor ? delta < 0 : delta > 0

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-sm whitespace-nowrap">
      <span className="text-gray-500 dark:text-gray-400 text-xs font-medium">{label}</span>
      {changed ? (
        <>
          <span className="text-gray-400 dark:text-gray-500 tabular-nums">{fmt(before)}</span>
          <span className="text-gray-400">→</span>
          <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{fmt(after)}</span>
          <span className={clsx(
            "text-xs font-medium tabular-nums",
            improving ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
          )}>
            {delta > 0 ? '+' : ''}{format === 'pct' ? delta.toFixed(1) + '%' : Math.round(delta)}
          </span>
        </>
      ) : (
        <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{fmt(after)}</span>
      )}
    </div>
  )
}

/** Generate a natural-language headline from simulation data */
function buildHeadline(metrics: SimulationMetrics, simulationRows: SimulationRow[]): string {
  const traded = simulationRows.filter(r => r.variant?.sizing_input)
  if (traded.length === 0) return 'No active trades'

  const adding = traded.filter(r => r.derivedAction === 'buy' || r.derivedAction === 'add')
  const trimming = traded.filter(r => r.derivedAction === 'sell' || r.derivedAction === 'trim')

  const parts: string[] = []

  if (adding.length > 0) {
    const action = adding.some(r => r.derivedAction === 'buy') ? 'Adding' : 'Increasing'
    if (adding.length <= 2) {
      parts.push(`${action} ${adding.map(r => r.symbol).join(', ')}`)
    } else {
      parts.push(`${action} ${adding.length} positions`)
    }
  }

  if (trimming.length > 0) {
    const action = trimming.some(r => r.derivedAction === 'sell') ? 'selling' : 'trimming'
    if (trimming.length <= 2) {
      parts.push(`${action} ${trimming.map(r => r.symbol).join(', ')}`)
    } else {
      parts.push(`${action} ${trimming.length}`)
    }
  }

  // Add concentration insight
  const top5Delta = metrics.top_5_concentration_after - metrics.top_5_concentration_before
  if (Math.abs(top5Delta) >= 0.5) {
    const direction = top5Delta < 0 ? 'drops' : 'rises'
    parts.push(`Top 5 concentration ${direction} ${Math.abs(top5Delta).toFixed(1)}% to ${metrics.top_5_concentration_after.toFixed(1)}%`)
  }

  if (parts.length === 0) return `${traded.length} trade${traded.length !== 1 ? 's' : ''} active`

  // Capitalize first part, join with " — "
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return [first, ...parts.slice(1)].join(' — ')
}

export function ImpactHeadlineBand({ metrics, simulationRows }: ImpactHeadlineBandProps) {
  const headline = useMemo(
    () => buildHeadline(metrics, simulationRows),
    [metrics, simulationRows],
  )

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-3">
      {/* Headline */}
      <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">{headline}</p>

      {/* KPI pills row */}
      <div className="flex flex-wrap items-center gap-2">
        <KpiPill
          label="Positions"
          before={metrics.position_count_before}
          after={metrics.position_count_after}
        />
        <KpiPill
          label="Top 5"
          before={metrics.top_5_concentration_before}
          after={metrics.top_5_concentration_after}
          format="pct"
          invertColor
        />
        <KpiPill
          label="Top 10"
          before={metrics.top_10_concentration_before}
          after={metrics.top_10_concentration_after}
          format="pct"
          invertColor
        />
      </div>
    </div>
  )
}
