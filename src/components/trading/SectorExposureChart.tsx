import { useMemo } from 'react'
import { Card } from '../ui/Card'
import { PieChart } from 'lucide-react'
import { clsx } from 'clsx'

interface SectorExposureChartProps {
  before: Record<string, number>
  after: Record<string, number>
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
  'Other': '#6b7280',
}

export function SectorExposureChart({ before, after }: SectorExposureChartProps) {
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

  const maxValue = Math.max(...sectors.map(s => Math.max(s.before, s.after)), 1)

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <PieChart className="h-4 w-4" />
        Sector Exposure
      </h3>

      <div className="space-y-3">
        {sectors.map(sector => (
          <div key={sector.name}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-700 dark:text-gray-300 truncate flex-1">
                {sector.name}
              </span>
              <div className="flex items-center gap-2 ml-2">
                <span className="text-gray-500 dark:text-gray-400 w-12 text-right">
                  {sector.before.toFixed(1)}%
                </span>
                <span className="text-gray-400">→</span>
                <span className="font-medium text-gray-900 dark:text-white w-12 text-right">
                  {sector.after.toFixed(1)}%
                </span>
                <span className={clsx(
                  "w-14 text-right text-xs",
                  sector.change > 0 ? "text-green-600" :
                  sector.change < 0 ? "text-red-600" : "text-gray-400"
                )}>
                  {sector.change > 0 ? '+' : ''}{sector.change.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Stacked bar showing before/after */}
            <div className="relative h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              {/* Before bar (lighter) */}
              <div
                className="absolute inset-y-0 left-0 opacity-40 rounded-full"
                style={{
                  width: `${(sector.before / maxValue) * 100}%`,
                  backgroundColor: sector.color,
                }}
              />
              {/* After bar */}
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{
                  width: `${(sector.after / maxValue) * 100}%`,
                  backgroundColor: sector.color,
                }}
              />
            </div>
          </div>
        ))}
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
      </div>
    </Card>
  )
}
