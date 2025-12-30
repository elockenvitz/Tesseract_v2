import React from 'react'
import { clsx } from 'clsx'
import { Calculator, Star, Scale, ChevronDown } from 'lucide-react'
import { AGGREGATION_METHODS, type AggregationMethod } from '../../hooks/useOutcomeAggregation'

interface AggregationToolbarProps {
  method: AggregationMethod
  showOpinions: boolean
  weightByRole: boolean
  onMethodChange: (method: AggregationMethod) => void
  onShowOpinionsChange: (show: boolean) => void
  onWeightByRoleChange: (weight: boolean) => void
  analystCount: number
  className?: string
}

export function AggregationToolbar({
  method,
  showOpinions,
  weightByRole,
  onMethodChange,
  onShowOpinionsChange,
  onWeightByRoleChange,
  analystCount,
  className
}: AggregationToolbarProps) {
  const [isMethodOpen, setIsMethodOpen] = React.useState(false)
  const methodRef = React.useRef<HTMLDivElement>(null)

  const selectedMethod = AGGREGATION_METHODS.find(m => m.value === method)

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (methodRef.current && !methodRef.current.contains(event.target as Node)) {
        setIsMethodOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className={clsx(
      'flex flex-wrap items-center gap-3 p-3 rounded-lg',
      'bg-gray-50 dark:bg-gray-800/50',
      'border border-gray-200 dark:border-gray-700',
      className
    )}>
      {/* Aggregation method dropdown */}
      <div ref={methodRef} className="relative">
        <button
          onClick={() => setIsMethodOpen(!isMethodOpen)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm',
            'bg-white dark:bg-gray-700',
            'border border-gray-300 dark:border-gray-600',
            'hover:border-gray-400 dark:hover:border-gray-500',
            'text-gray-700 dark:text-gray-200'
          )}
        >
          <Calculator className="w-4 h-4 text-gray-400" />
          <span>{selectedMethod?.label || 'Average'}</span>
          <ChevronDown className={clsx(
            'w-4 h-4 text-gray-400 transition-transform',
            isMethodOpen && 'rotate-180'
          )} />
        </button>

        {isMethodOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
            {AGGREGATION_METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => {
                  onMethodChange(m.value)
                  setIsMethodOpen(false)
                }}
                className={clsx(
                  'w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700',
                  method === m.value && 'bg-primary-50 dark:bg-primary-900/20'
                )}
              >
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {m.label}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {m.description}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-gray-300 dark:bg-gray-600" />

      {/* Weight by role toggle */}
      {method === 'weighted' && (
        <button
          onClick={() => onWeightByRoleChange(!weightByRole)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors',
            weightByRole
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
              : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600'
          )}
        >
          <Scale className="w-4 h-4" />
          <span>Weight by role</span>
        </button>
      )}

      {/* Covering analysts only toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600 dark:text-gray-400">Covering Analysts Only</span>
        <button
          onClick={() => onShowOpinionsChange(!showOpinions)}
          className={clsx(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            !showOpinions
              ? 'bg-yellow-500'
              : 'bg-gray-300 dark:bg-gray-600'
          )}
          title={!showOpinions ? 'Only showing covering analysts' : 'Showing all analysts'}
        >
          <span
            className={clsx(
              'inline-flex h-4 w-4 items-center justify-center transform rounded-full bg-white transition-transform shadow-sm',
              !showOpinions ? 'translate-x-6' : 'translate-x-1'
            )}
          >
            {!showOpinions && <Star className="w-2.5 h-2.5 text-yellow-500" />}
          </span>
        </button>
      </div>

      {/* Analyst count */}
      <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">
        {analystCount} analyst{analystCount !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
