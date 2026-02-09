/**
 * Trade Card Conflict Badge (Trade Lab v3)
 *
 * Always-visible conflict indicator for trade cards.
 * Shows conflict status without needing to open edit modal.
 */

import React from 'react'
import { AlertCircle, AlertTriangle, ArrowRight, Check } from 'lucide-react'
import { clsx } from 'clsx'
import type { SizingValidationError, TradeAction } from '../../types/trading'

// =============================================================================
// INLINE CONFLICT BADGE (for card headers)
// =============================================================================

interface InlineConflictBadgeProps {
  conflict: SizingValidationError | null
  belowLotWarning?: boolean
  onFixAction?: (suggestedAction: TradeAction) => void
  size?: 'sm' | 'md'
  className?: string
}

export function InlineConflictBadge({
  conflict,
  belowLotWarning = false,
  onFixAction,
  size = 'sm',
  className = '',
}: InlineConflictBadgeProps) {
  if (!conflict && !belowLotWarning) {
    return null
  }

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5 gap-1',
    md: 'text-sm px-2 py-1 gap-1.5',
  }

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'

  if (conflict) {
    return (
      <div className={clsx('flex items-center gap-1', className)}>
        <span
          className={clsx(
            'inline-flex items-center font-medium rounded',
            sizeClasses[size],
            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}
          title={conflict.message}
        >
          <AlertCircle className={iconSize} />
          <span>Conflict</span>
        </span>

        {onFixAction && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFixAction(conflict.suggested_direction)
            }}
            className={clsx(
              'inline-flex items-center font-medium rounded transition-colors',
              sizeClasses[size],
              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
              'hover:bg-blue-200 dark:hover:bg-blue-900/50'
            )}
            title={`Change action to ${conflict.suggested_direction.toUpperCase()}`}
          >
            <ArrowRight className={iconSize} />
            <span>{conflict.suggested_direction.toUpperCase()}</span>
          </button>
        )}
      </div>
    )
  }

  if (belowLotWarning) {
    return (
      <span
        className={clsx(
          'inline-flex items-center font-medium rounded',
          sizeClasses[size],
          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
          className
        )}
        title="Computed shares below minimum lot size"
      >
        <AlertTriangle className={iconSize} />
        <span>Lot Warning</span>
      </span>
    )
  }

  return null
}

// =============================================================================
// CARD CONFLICT ROW (expanded view with message)
// =============================================================================

interface CardConflictRowProps {
  conflict: SizingValidationError | null
  belowLotWarning?: boolean
  onFixAction?: (suggestedAction: TradeAction) => void
  className?: string
}

export function CardConflictRow({
  conflict,
  belowLotWarning = false,
  onFixAction,
  className = '',
}: CardConflictRowProps) {
  if (!conflict && !belowLotWarning) {
    return null
  }

  if (conflict) {
    return (
      <div
        className={clsx(
          'flex items-center justify-between gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800',
          className
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-700 dark:text-red-400 truncate">
            {conflict.message}
          </span>
        </div>

        {onFixAction && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFixAction(conflict.suggested_direction)
            }}
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Fix: {conflict.suggested_direction.toUpperCase()}
          </button>
        )}
      </div>
    )
  }

  if (belowLotWarning) {
    return (
      <div
        className={clsx(
          'flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800',
          className
        )}
      >
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <span className="text-xs text-amber-700 dark:text-amber-400">
          Below minimum lot size - will round to nearest lot
        </span>
      </div>
    )
  }

  return null
}

// =============================================================================
// READY STATUS INDICATOR
// =============================================================================

interface ReadyStatusIndicatorProps {
  isReady: boolean
  conflictCount: number
  warningCount: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ReadyStatusIndicator({
  isReady,
  conflictCount,
  warningCount,
  size = 'md',
  className = '',
}: ReadyStatusIndicatorProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2',
  }

  const iconSize = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  }

  if (isReady) {
    return (
      <div
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md font-medium',
          sizeClasses[size],
          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
          className
        )}
      >
        <Check className={iconSize[size]} />
        <span>Ready</span>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md font-medium',
        sizeClasses[size],
        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        className
      )}
    >
      <AlertCircle className={iconSize[size]} />
      <span>
        {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
        {warningCount > 0 && `, ${warningCount} warning${warningCount !== 1 ? 's' : ''}`}
      </span>
    </div>
  )
}

// =============================================================================
// SUMMARY BAR CONFLICTS
// =============================================================================

interface SummaryBarConflictsProps {
  totalVariants: number
  conflictCount: number
  warningCount: number
  totalNotional: number
  onConflictClick?: () => void
  className?: string
}

export function SummaryBarConflicts({
  totalVariants,
  conflictCount,
  warningCount,
  totalNotional,
  onConflictClick,
  className = '',
}: SummaryBarConflictsProps) {
  const formatNotional = (value: number) => {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
    return `$${value.toFixed(0)}`
  }

  return (
    <div
      className={clsx(
        'flex items-center gap-4 px-4 py-2 rounded-lg',
        conflictCount > 0
          ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          : warningCount > 0
          ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
          : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
        className
      )}
    >
      {/* Variant Count */}
      <div className="text-sm">
        <span className="font-medium text-gray-900 dark:text-white">{totalVariants}</span>
        <span className="text-gray-500 dark:text-gray-400 ml-1">
          variant{totalVariants !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Conflict Count */}
      {conflictCount > 0 && (
        <button
          type="button"
          onClick={onConflictClick}
          className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400 hover:underline"
        >
          <AlertCircle className="w-4 h-4" />
          <span className="font-medium">{conflictCount} conflict{conflictCount !== 1 ? 's' : ''}</span>
        </button>
      )}

      {/* Warning Count */}
      {warningCount > 0 && (
        <div className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4" />
          <span>{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Total Notional */}
      {totalNotional > 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
          {formatNotional(totalNotional)} notional
        </div>
      )}
    </div>
  )
}

export default InlineConflictBadge
