import React from 'react'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus, Users, ExternalLink } from 'lucide-react'
import type { AggregatedResult } from '../../hooks/useOutcomeAggregation'

interface AggregatedViewProps {
  results: AggregatedResult[]
  currentPrice?: number
  showRange?: boolean
  className?: string
}

export function AggregatedView({
  results,
  currentPrice,
  showRange = true,
  className
}: AggregatedViewProps) {
  // Separate default and custom scenarios
  const defaultResults = results.filter(r => r.isDefault)
  const customResults = results.filter(r => !r.isDefault && r.aggregatedPrice !== null)

  // Sort default results in order: Bull, Base, Bear
  const sortedDefaultResults = [...defaultResults].sort((a, b) => {
    const order = ['Bull', 'Base', 'Bear']
    return order.indexOf(a.scenarioName) - order.indexOf(b.scenarioName)
  })

  const renderCard = (result: AggregatedResult) => {
    const hasData = result.aggregatedPrice !== null
    const upside = currentPrice && hasData
      ? ((result.aggregatedPrice! - currentPrice) / currentPrice) * 100
      : null

    return (
      <div
        key={result.scenarioId}
        className={clsx(
          'rounded-lg border p-4',
          'bg-white dark:bg-gray-800',
          'border-gray-200 dark:border-gray-700'
        )}
        style={{ borderTopColor: result.scenarioColor || '#6b7280', borderTopWidth: '3px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: result.scenarioColor || '#6b7280' }}
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {result.scenarioName}
            </span>
          </div>
          {upside !== null && (
            <span className={clsx(
              'text-xs font-medium flex items-center gap-0.5',
              upside > 0 ? 'text-green-600 dark:text-green-400' :
              upside < 0 ? 'text-red-600 dark:text-red-400' :
              'text-gray-500 dark:text-gray-400'
            )}>
              {upside > 0 ? <TrendingUp className="w-3 h-3" /> :
               upside < 0 ? <TrendingDown className="w-3 h-3" /> :
               <Minus className="w-3 h-3" />}
              {upside > 0 ? '+' : ''}{upside.toFixed(1)}%
            </span>
          )}
        </div>

        {/* Price */}
        {hasData ? (
          <>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              ${result.aggregatedPrice!.toFixed(2)}
            </div>

            {/* Range */}
            {showRange && result.minPrice !== null && result.maxPrice !== null &&
             result.minPrice !== result.maxPrice && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Range: ${result.minPrice.toFixed(2)} - ${result.maxPrice.toFixed(2)}
              </div>
            )}

            {/* Analyst count */}
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Users className="w-3 h-3" />
              <span>{result.analystCount} analyst{result.analystCount !== 1 ? 's' : ''}</span>
            </div>
          </>
        ) : (
          <div className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
            No targets
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={clsx('space-y-6', className)}>
      {/* Default scenarios (Bull/Base/Bear) */}
      {sortedDefaultResults.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {sortedDefaultResults.map(renderCard)}
        </div>
      )}

      {/* Custom scenarios */}
      {customResults.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Custom Scenarios
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {customResults.map(renderCard)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No price targets available
        </div>
      )}
    </div>
  )
}

// Comparison table showing all analysts side by side
interface AnalystComparisonTableProps {
  results: AggregatedResult[]
  currentPrice?: number
  className?: string
  onUserClick?: (user: { id: string; full_name: string }) => void
}

export function AnalystComparisonTable({
  results,
  currentPrice,
  className,
  onUserClick
}: AnalystComparisonTableProps) {
  // Get all unique analysts from all scenarios
  const allAnalysts = new Map<string, { id: string; name: string; isCovering: boolean }>()
  results.forEach(r => {
    r.targets.forEach(t => {
      if (t.user && !allAnalysts.has(t.user_id)) {
        allAnalysts.set(t.user_id, {
          id: t.user_id,
          name: t.user.full_name || 'Unknown',
          isCovering: !!t.coverage // Use current coverage status, not stale is_official flag
        })
      }
    })
  })

  const analysts = Array.from(allAnalysts.values())
  const sortedScenarios = [...results].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    const order = ['Bull', 'Base', 'Bear']
    const aIdx = order.indexOf(a.scenarioName)
    const bIdx = order.indexOf(b.scenarioName)
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
    return a.scenarioName.localeCompare(b.scenarioName)
  })

  if (analysts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No analyst data available
      </div>
    )
  }

  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Analyst
            </th>
            {sortedScenarios.map(scenario => (
              <th
                key={scenario.scenarioId}
                className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
              >
                <div className="flex items-center justify-center gap-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: scenario.scenarioColor || '#6b7280' }}
                  />
                  {scenario.scenarioName}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
          {analysts.map(analyst => (
            <tr key={analyst.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="px-4 py-3 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  {analyst.isCovering && (
                    <span className="w-2 h-2 rounded-full bg-yellow-400" title="Covering Analyst" />
                  )}
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {analyst.name}
                  </span>
                  {onUserClick && (
                    <button
                      onClick={() => onUserClick({ id: analyst.id, full_name: analyst.name })}
                      className="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"
                      title="Open user profile"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </td>
              {sortedScenarios.map(scenario => {
                const target = scenario.targets.find(t => t.user_id === analyst.id)
                return (
                  <td key={scenario.scenarioId} className="px-4 py-3 text-center whitespace-nowrap">
                    {target ? (
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        ${target.price.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          {/* Aggregation row */}
          <tr className="bg-gray-50 dark:bg-gray-800 font-medium">
            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
              Average
            </td>
            {sortedScenarios.map(scenario => (
              <td key={scenario.scenarioId} className="px-4 py-3 text-center whitespace-nowrap">
                {scenario.aggregatedPrice !== null ? (
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    ${scenario.aggregatedPrice.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
