import { useMemo } from 'react'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus, Users, Loader2 } from 'lucide-react'
import { useScenarios } from '../../hooks/useScenarios'
import { useAnalystPriceTargets } from '../../hooks/useAnalystPriceTargets'
import { useOutcomeAggregation } from '../../hooks/useOutcomeAggregation'

interface PriceTargetsSummaryProps {
  assetId: string
  currentPrice?: number
  className?: string
}

/**
 * Compact price targets summary showing Bull/Base/Bear aggregated values.
 * Returns null if no price target data exists.
 * Designed for the aggregated "Our View" in AssetTab.
 */
export function PriceTargetsSummary({ assetId, currentPrice, className }: PriceTargetsSummaryProps) {
  // Fetch scenarios
  const { scenarios, isLoading: scenariosLoading } = useScenarios({ assetId })

  // Fetch all price targets for this asset
  const { priceTargets, isLoading: targetsLoading } = useAnalystPriceTargets({ assetId })

  // Aggregation hook
  const { aggregatedResults, hasData } = useOutcomeAggregation({
    assetId,
    priceTargets,
    scenarios
  })

  const isLoading = scenariosLoading || targetsLoading

  // Filter to only default scenarios (Bull, Base, Bear) with data
  const defaultResults = useMemo(() => {
    return aggregatedResults
      .filter(r => r.isDefault && r.aggregatedPrice !== null)
      .sort((a, b) => {
        const order = ['Bull', 'Base', 'Bear']
        return order.indexOf(a.scenarioName) - order.indexOf(b.scenarioName)
      })
  }, [aggregatedResults])

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  // Return null if no price target data
  if (!hasData || defaultResults.length === 0) {
    return null
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500" />
          Price Targets
        </h4>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {defaultResults.map(result => {
            const upside = currentPrice && result.aggregatedPrice
              ? ((result.aggregatedPrice - currentPrice) / currentPrice) * 100
              : null

            return (
              <div
                key={result.scenarioId}
                className="text-center p-3 bg-gray-50 rounded-lg"
                style={{ borderTop: `3px solid ${result.scenarioColor || '#6b7280'}` }}
              >
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center justify-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: result.scenarioColor || '#6b7280' }}
                  />
                  {result.scenarioName}
                </div>

                <div className="text-xl font-bold text-gray-900 mb-1">
                  ${result.aggregatedPrice!.toFixed(2)}
                </div>

                {upside !== null && (
                  <div className={clsx(
                    'text-xs font-medium flex items-center justify-center gap-0.5 mb-2',
                    upside > 0 ? 'text-green-600' :
                    upside < 0 ? 'text-red-600' :
                    'text-gray-500'
                  )}>
                    {upside > 0 ? <TrendingUp className="w-3 h-3" /> :
                     upside < 0 ? <TrendingDown className="w-3 h-3" /> :
                     <Minus className="w-3 h-3" />}
                    {upside > 0 ? '+' : ''}{upside.toFixed(1)}%
                  </div>
                )}

                <div className="flex items-center justify-center gap-1 text-xs text-gray-500">
                  <Users className="w-3 h-3" />
                  <span>{result.analystCount} analyst{result.analystCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
