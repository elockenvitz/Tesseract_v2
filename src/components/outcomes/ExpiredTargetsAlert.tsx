import React from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, X, ChevronRight, RefreshCw } from 'lucide-react'
import { useExpiredTargetsByAsset, useCheckExpiredTargets } from '../../hooks/useExpiredTargets'

interface ExpiredTargetsAlertProps {
  className?: string
  onNavigateToAsset?: (assetId: string) => void
  compact?: boolean
}

export function ExpiredTargetsAlert({
  className,
  onNavigateToAsset,
  compact = false
}: ExpiredTargetsAlertProps) {
  const { groupedByAsset, hasExpiredTargets, expiredCount, isLoading } = useExpiredTargetsByAsset()
  const { checkExpiredTargets, isChecking } = useCheckExpiredTargets()
  const [dismissed, setDismissed] = React.useState(false)

  // Check for expired targets on mount
  React.useEffect(() => {
    checkExpiredTargets()
  }, [])

  if (isLoading || !hasExpiredTargets || dismissed) {
    return null
  }

  if (compact) {
    return (
      <div className={clsx(
        'flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200',
        className
      )}>
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm font-medium">
          {expiredCount} expired target{expiredCount !== 1 ? 's' : ''} need{expiredCount === 1 ? 's' : ''} updating
        </span>
      </div>
    )
  }

  return (
    <div className={clsx(
      'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4',
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900 dark:text-amber-100">
              Price Targets Expired
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              {expiredCount} price target{expiredCount !== 1 ? 's have' : ' has'} expired and need{expiredCount === 1 ? 's' : ''} to be updated.
            </p>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {groupedByAsset.map(asset => (
          <div
            key={asset.assetId}
            className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-amber-200 dark:border-amber-800/50"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {asset.assetSymbol}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {asset.assetName}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                {asset.scenarios.map((scenario, idx) => (
                  <span
                    key={idx}
                    className={clsx(
                      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                      scenario.scenarioType?.toLowerCase().includes('bull')
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : scenario.scenarioType?.toLowerCase().includes('bear')
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    )}
                  >
                    {scenario.scenarioType}: ${scenario.expiredPrice.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
            {onNavigateToAsset && (
              <button
                onClick={() => onNavigateToAsset(asset.assetId)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
              >
                Update
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400">
        <span>
          Please set new targets for these scenarios to maintain your coverage.
        </span>
        <button
          onClick={() => checkExpiredTargets()}
          disabled={isChecking}
          className="flex items-center gap-1 hover:text-amber-800 dark:hover:text-amber-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-3 h-3', isChecking && 'animate-spin')} />
          Refresh
        </button>
      </div>
    </div>
  )
}

export default ExpiredTargetsAlert
