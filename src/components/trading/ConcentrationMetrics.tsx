import { Card } from '../ui/Card'
import { BarChart3, AlertTriangle, Check } from 'lucide-react'
import type { SimulationMetrics } from '../../types/trading'
import { clsx } from 'clsx'

interface ConcentrationMetricsProps {
  metrics: SimulationMetrics
}

export function ConcentrationMetrics({ metrics }: ConcentrationMetricsProps) {
  // Determine risk levels
  const top5Risk = metrics.top_5_concentration_after > 50 ? 'high' :
                   metrics.top_5_concentration_after > 35 ? 'medium' : 'low'

  const top10Risk = metrics.top_10_concentration_after > 70 ? 'high' :
                    metrics.top_10_concentration_after > 50 ? 'medium' : 'low'

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400'
      case 'medium': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400'
      default: return 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400'
    }
  }

  const getRiskIcon = (risk: string) => {
    return risk === 'low' ? Check : AlertTriangle
  }

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        Concentration Analysis
      </h3>

      <div className="space-y-4">
        {/* Top 5 Concentration */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Top 5 Positions</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {metrics.top_5_concentration_before.toFixed(1)}%
              </span>
              <span className="text-gray-400">→</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {metrics.top_5_concentration_after.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="relative h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={clsx(
                "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                top5Risk === 'high' ? 'bg-red-500' :
                top5Risk === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
              )}
              style={{ width: `${Math.min(metrics.top_5_concentration_after, 100)}%` }}
            />
            {/* Threshold markers */}
            <div className="absolute inset-y-0 left-[35%] w-px bg-yellow-400 opacity-50" title="Moderate threshold" />
            <div className="absolute inset-y-0 left-[50%] w-px bg-red-400 opacity-50" title="High threshold" />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className={clsx("text-xs px-2 py-0.5 rounded-full flex items-center gap-1", getRiskColor(top5Risk))}>
              {(() => {
                const Icon = getRiskIcon(top5Risk)
                return <Icon className="h-3 w-3" />
              })()}
              {top5Risk === 'high' ? 'High concentration' : top5Risk === 'medium' ? 'Moderate' : 'Diversified'}
            </span>
            <span className={clsx(
              "text-xs",
              metrics.top_5_concentration_after < metrics.top_5_concentration_before
                ? "text-green-600" : "text-red-600"
            )}>
              {metrics.top_5_concentration_after < metrics.top_5_concentration_before ? '↓' : '↑'}
              {' '}
              {Math.abs(metrics.top_5_concentration_after - metrics.top_5_concentration_before).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Top 10 Concentration */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Top 10 Positions</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {metrics.top_10_concentration_before.toFixed(1)}%
              </span>
              <span className="text-gray-400">→</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {metrics.top_10_concentration_after.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="relative h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={clsx(
                "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                top10Risk === 'high' ? 'bg-red-500' :
                top10Risk === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
              )}
              style={{ width: `${Math.min(metrics.top_10_concentration_after, 100)}%` }}
            />
          </div>
        </div>

        {/* Position Count */}
        <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Total Positions</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">
                {metrics.position_count_before}
              </span>
              <span className="text-gray-400">→</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {metrics.position_count_after}
              </span>
              {metrics.positions_added > 0 && (
                <span className="text-xs text-green-600">+{metrics.positions_added}</span>
              )}
              {metrics.positions_removed > 0 && (
                <span className="text-xs text-red-600">-{metrics.positions_removed}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
