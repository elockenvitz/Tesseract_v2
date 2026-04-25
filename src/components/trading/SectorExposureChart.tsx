import { useMemo, useState } from 'react'
import { Card } from '../ui/Card'
import { PieChart, ChevronDown, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'

export interface TradeAttribution {
  sector: string
  symbol: string
  deltaWeight: number
}

interface SectorExposureChartProps {
  before: Record<string, number>
  after: Record<string, number>
  tradeAttribution?: TradeAttribution[]
}

const SECTOR_COLORS: Record<string, string> = {
  'Technology': '#3b82f6',
  'Healthcare': '#10b981',
  'Financials': '#f59e0b',
  'Consumer Discretionary': '#ec4899',
  'Consumer Staples': '#8b5cf6',
  'Industrials': '#6366f1',
  'Energy': '#ef4444',
  'Utilities': '#14b8a6',
  'Materials': '#f97316',
  'Real Estate': '#84cc16',
  'Communication Services': '#06b6d4',
  'Cash': '#9ca3af',
  'Other': '#6b7280',
}

/** Format a weight delta in basis points when small, percent otherwise, with
 *  a sign and fixed precision. 0.72% → "+72 bps"; 3.4% → "+3.40%". */
function fmtDelta(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  const abs = Math.abs(pct)
  if (abs < 1) return `${sign}${Math.round(abs * 100)} bps`
  return `${sign}${abs.toFixed(2)}%`
}

export function SectorExposureChart({ before, after, tradeAttribution }: SectorExposureChartProps) {
  const sectors = useMemo(() => {
    const allSectors = new Set([...Object.keys(before), ...Object.keys(after)])
    return Array.from(allSectors)
      .map(sector => ({
        name: sector,
        before: before[sector] || 0,
        after: after[sector] || 0,
        change: (after[sector] || 0) - (before[sector] || 0),
        color: SECTOR_COLORS[sector] || SECTOR_COLORS['Other'],
      }))
      .sort((a, b) => b.after - a.after)
  }, [before, after])

  // Group trade attribution by sector, sorted by |deltaWeight| desc
  const attributionBySector = useMemo(() => {
    if (!tradeAttribution || tradeAttribution.length === 0) return null
    const map = new Map<string, TradeAttribution[]>()
    for (const t of tradeAttribution) {
      const arr = map.get(t.sector) || []
      arr.push(t)
      map.set(t.sector, arr)
    }
    for (const [key, arr] of map) {
      arr.sort((a, b) => Math.abs(b.deltaWeight) - Math.abs(a.deltaWeight))
    }
    return map
  }, [tradeAttribution])

  const maxValue = Math.max(...sectors.map(s => Math.max(s.before, s.after)), 1)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (sector: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(sector)) next.delete(sector)
      else next.add(sector)
      return next
    })
  }

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <PieChart className="h-4 w-4" />
        Sector Exposure
      </h3>

      <div className="space-y-2">
        {sectors.map(sector => {
          const drivers = attributionBySector?.get(sector.name) ?? []
          const hasDrivers = drivers.length > 0
          const isExpanded = expanded.has(sector.name)
          const changed = Math.abs(sector.change) >= 0.005

          return (
            <div
              key={sector.name}
              className={clsx(
                'rounded-md transition-colors',
                hasDrivers && 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
              )}
            >
              <button
                type="button"
                onClick={() => hasDrivers && toggleExpanded(sector.name)}
                className={clsx(
                  'w-full text-left px-1.5 py-1',
                  hasDrivers ? 'cursor-pointer' : 'cursor-default',
                )}
                aria-expanded={isExpanded}
              >
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {hasDrivers ? (
                      isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      )
                    ) : (
                      <span className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    <span className="text-gray-700 dark:text-gray-300 truncate">
                      {sector.name}
                    </span>
                    {hasDrivers && (
                      <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 flex-shrink-0">
                        · {drivers.length} trade{drivers.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums w-14 text-right">
                      {sector.before.toFixed(2)}%
                    </span>
                    <span className="text-gray-400">→</span>
                    <span className="font-medium text-gray-900 dark:text-white tabular-nums w-14 text-right">
                      {sector.after.toFixed(2)}%
                    </span>
                    <span className={clsx(
                      'w-20 text-right text-xs tabular-nums',
                      !changed ? 'text-gray-400'
                        : sector.change > 0 ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400',
                    )}>
                      {changed ? fmtDelta(sector.change) : '—'}
                    </span>
                  </div>
                </div>

                {/* Bar */}
                <div className="relative h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden ml-5">
                  <div
                    className="absolute inset-y-0 left-0 opacity-40 rounded-full"
                    style={{
                      width: `${(sector.before / maxValue) * 100}%`,
                      backgroundColor: sector.color,
                    }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                    style={{
                      width: `${(sector.after / maxValue) * 100}%`,
                      backgroundColor: sector.color,
                    }}
                  />
                </div>
              </button>

              {/* Expanded trade attribution */}
              {hasDrivers && isExpanded && (
                <div className="ml-8 mr-2 mt-1 mb-2 border-l-2 border-gray-200 dark:border-gray-700 pl-3 py-1 space-y-1">
                  {drivers.map(d => (
                    <div
                      key={d.symbol}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                        {d.symbol}
                      </span>
                      <span className={clsx(
                        'tabular-nums font-medium',
                        d.deltaWeight > 0 ? 'text-emerald-600 dark:text-emerald-400'
                          : d.deltaWeight < 0 ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-400',
                      )}>
                        {fmtDelta(d.deltaWeight)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-400 opacity-40" />
          Before
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-400" />
          After
        </div>
        {attributionBySector && (
          <div className="ml-auto text-gray-400">
            Click a sector to see contributing trades
          </div>
        )}
      </div>
    </Card>
  )
}
