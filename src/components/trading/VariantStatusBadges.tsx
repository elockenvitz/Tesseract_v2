/**
 * Variant Status Badges
 *
 * UI components for displaying direction conflicts and lot warnings
 * in Trade Lab v3.
 */

import React from 'react'
import { AlertTriangle, AlertCircle, Info, ArrowRight } from 'lucide-react'
import type { SizingValidationError, TradeAction } from '../../types/trading'

// =============================================================================
// DIRECTION CONFLICT BADGE (v3 with SizingValidationError support)
// =============================================================================

interface ConflictBadgeProps {
  hasConflict: boolean
  action?: string
  className?: string
  showTooltip?: boolean
}

/**
 * Legacy ConflictBadge - uses boolean hasConflict.
 * @deprecated Use ConflictBadgeV3 with SizingValidationError for full functionality
 */
export function ConflictBadge({
  hasConflict,
  action,
  className = '',
  showTooltip = true,
}: ConflictBadgeProps) {
  if (!hasConflict) return null

  const tooltipText = action
    ? `Sizing contradicts ${action.toUpperCase()} action. The sign of the sizing change doesn't match the direction of the trade.`
    : 'Direction conflict: sizing contradicts the stated action'

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 ${className}`}
      title={showTooltip ? tooltipText : undefined}
    >
      <AlertCircle className="w-3 h-3" />
      <span>Conflict</span>
    </span>
  )
}

// =============================================================================
// DIRECTION CONFLICT BADGE V3 (with SizingValidationError and one-click fix)
// =============================================================================

interface ConflictBadgeV3Props {
  conflict: SizingValidationError | null
  onFixAction?: (suggestedAction: TradeAction) => void
  className?: string
  showInlineMessage?: boolean
}

/**
 * v3 ConflictBadge with full SizingValidationError support.
 * Shows the error message and provides one-click fix button.
 */
export function ConflictBadgeV3({
  conflict,
  onFixAction,
  className = '',
  showInlineMessage = false,
}: ConflictBadgeV3Props) {
  if (!conflict) return null

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        title={conflict.message}
      >
        <AlertCircle className="w-3 h-3" />
        <span>Conflict</span>
      </span>

      {/* One-click fix button */}
      {onFixAction && (
        <button
          onClick={() => onFixAction(conflict.suggested_direction)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
          title={`Change action to ${conflict.suggested_direction.toUpperCase()}`}
        >
          <ArrowRight className="w-3 h-3" />
          <span>{conflict.suggested_direction.toUpperCase()}</span>
        </button>
      )}

      {/* Inline message */}
      {showInlineMessage && (
        <span className="text-xs text-red-600 dark:text-red-400 ml-1">
          {conflict.message}
        </span>
      )}
    </div>
  )
}

// =============================================================================
// INLINE CONFLICT ERROR (full width with message and fix)
// =============================================================================

interface InlineConflictErrorProps {
  conflict: SizingValidationError | null
  onFixAction?: (suggestedAction: TradeAction) => void
  className?: string
}

/**
 * Full-width inline error display with message and one-click fix.
 * Use in forms/modals where space is available.
 */
export function InlineConflictError({
  conflict,
  onFixAction,
  className = '',
}: InlineConflictErrorProps) {
  if (!conflict) return null

  return (
    <div className={`p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-400">
            {conflict.message}
          </span>
        </div>

        {onFixAction && (
          <button
            onClick={() => onFixAction(conflict.suggested_direction)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <span>Fix: Use {conflict.suggested_direction.toUpperCase()}</span>
          </button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// BELOW LOT WARNING BADGE
// =============================================================================

interface BelowLotBadgeProps {
  hasWarning: boolean
  lotSize?: number
  className?: string
  showTooltip?: boolean
}

export function BelowLotBadge({
  hasWarning,
  lotSize,
  className = '',
  showTooltip = true,
}: BelowLotBadgeProps) {
  if (!hasWarning) return null

  const tooltipText = lotSize
    ? `Computed shares below minimum lot size of ${lotSize}`
    : 'Computed shares below minimum lot size'

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ${className}`}
      title={showTooltip ? tooltipText : undefined}
    >
      <AlertTriangle className="w-3 h-3" />
      <span>Below Lot</span>
    </span>
  )
}

// =============================================================================
// COMBINED STATUS BADGES
// =============================================================================

interface VariantStatusBadgesProps {
  directionConflict: boolean
  belowLotWarning: boolean
  action?: string
  lotSize?: number
  className?: string
}

/**
 * Legacy VariantStatusBadges - uses boolean directionConflict.
 * @deprecated Use VariantStatusBadgesV3 with SizingValidationError for full functionality
 */
export function VariantStatusBadges({
  directionConflict,
  belowLotWarning,
  action,
  lotSize,
  className = '',
}: VariantStatusBadgesProps) {
  if (!directionConflict && !belowLotWarning) return null

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <ConflictBadge hasConflict={directionConflict} action={action} />
      <BelowLotBadge hasWarning={belowLotWarning} lotSize={lotSize} />
    </div>
  )
}

// =============================================================================
// COMBINED STATUS BADGES V3
// =============================================================================

interface VariantStatusBadgesV3Props {
  conflict: SizingValidationError | null
  belowLotWarning: boolean
  lotSize?: number
  onFixAction?: (suggestedAction: TradeAction) => void
  className?: string
}

/**
 * v3 VariantStatusBadges with SizingValidationError support.
 */
export function VariantStatusBadgesV3({
  conflict,
  belowLotWarning,
  lotSize,
  onFixAction,
  className = '',
}: VariantStatusBadgesV3Props) {
  if (!conflict && !belowLotWarning) return null

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <ConflictBadgeV3 conflict={conflict} onFixAction={onFixAction} />
      <BelowLotBadge hasWarning={belowLotWarning} lotSize={lotSize} />
    </div>
  )
}

// =============================================================================
// CONFLICT SUMMARY BAR
// =============================================================================

interface ConflictSummaryBarProps {
  total: number
  conflicts: number
  warnings: number
  canCreateTradeSheet: boolean
  onCreateTradeSheet?: () => void
  isCreating?: boolean
  className?: string
}

export function ConflictSummaryBar({
  total,
  conflicts,
  warnings,
  canCreateTradeSheet,
  onCreateTradeSheet,
  isCreating = false,
  className = '',
}: ConflictSummaryBarProps) {
  if (total === 0) {
    return (
      <div className={`flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg ${className}`}>
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Info className="w-4 h-4" />
          <span className="text-sm">No variants in lab. Add trades to get started.</span>
        </div>
      </div>
    )
  }

  const hasIssues = conflicts > 0 || warnings > 0

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg ${
        conflicts > 0
          ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          : warnings > 0
          ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
          : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
      } ${className}`}
    >
      <div className="flex items-center gap-4">
        {/* Variant count */}
        <div className="text-sm">
          <span className="font-medium">{total}</span>
          <span className="text-gray-600 dark:text-gray-400"> variant{total !== 1 ? 's' : ''}</span>
        </div>

        {/* Conflict count */}
        {conflicts > 0 && (
          <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">{conflicts} conflict{conflicts !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Warning count */}
        {warnings > 0 && (
          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">{warnings} lot warning{warnings !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* All clear */}
        {!hasIssues && (
          <div className="text-green-600 dark:text-green-400 text-sm">
            Ready to create Trade Sheet
          </div>
        )}
      </div>

      {/* Create Trade Sheet button */}
      {onCreateTradeSheet && (
        <button
          onClick={onCreateTradeSheet}
          disabled={!canCreateTradeSheet || isCreating}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            canCreateTradeSheet
              ? 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
          }`}
          title={
            !canCreateTradeSheet
              ? conflicts > 0
                ? 'Resolve all direction conflicts before creating Trade Sheet'
                : 'Add variants to create Trade Sheet'
              : 'Create an immutable Trade Sheet for execution'
          }
        >
          {isCreating ? 'Creating...' : 'Create Trade Sheet'}
        </button>
      )}
    </div>
  )
}

// =============================================================================
// SIZING INPUT HELP TEXT
// =============================================================================

interface SizingHelpTextProps {
  hasBenchmark: boolean
  className?: string
}

export function SizingHelpText({ hasBenchmark, className = '' }: SizingHelpTextProps) {
  return (
    <div className={`text-xs text-gray-500 dark:text-gray-400 space-y-1 ${className}`}>
      <div className="font-medium">Sizing Syntax:</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <div><code className="text-blue-600 dark:text-blue-400">2.5</code> Target 2.5% weight</div>
        <div><code className="text-blue-600 dark:text-blue-400">+0.5</code> Add 0.5% weight</div>
        <div><code className="text-blue-600 dark:text-blue-400">-0.25</code> Remove 0.25% weight</div>
        <div><code className="text-blue-600 dark:text-blue-400">#500</code> Target 500 shares</div>
        <div><code className="text-blue-600 dark:text-blue-400">#+100</code> Add 100 shares</div>
        <div><code className="text-blue-600 dark:text-blue-400">#-50</code> Remove 50 shares</div>
        {hasBenchmark && (
          <>
            <div><code className="text-green-600 dark:text-green-400">@t0.5</code> Target +0.5% active</div>
            <div><code className="text-green-600 dark:text-green-400">@t-0.5</code> Target -0.5% active</div>
            <div><code className="text-green-600 dark:text-green-400">@d+0.5</code> Add 0.5% active</div>
            <div><code className="text-green-600 dark:text-green-400">@d-0.25</code> Remove 0.25% active</div>
          </>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// DIRECTION CONFLICT EXPLANATION
// =============================================================================

interface ConflictExplanationProps {
  action: string
  sizingInput: string
  className?: string
}

export function ConflictExplanation({
  action,
  sizingInput,
  className = '',
}: ConflictExplanationProps) {
  const isBuyAction = action === 'buy' || action === 'add'
  const isNegativeSizing = sizingInput.includes('-') || sizingInput.startsWith('#-')

  let explanation: string
  if (isBuyAction && isNegativeSizing) {
    explanation = `You selected "${action.toUpperCase()}" but the sizing "${sizingInput}" indicates a decrease in position. Either change the action to SELL/TRIM or use a positive sizing value.`
  } else if (!isBuyAction && !isNegativeSizing) {
    explanation = `You selected "${action.toUpperCase()}" but the sizing "${sizingInput}" indicates an increase in position. Either change the action to BUY/ADD or use a negative sizing value.`
  } else {
    explanation = 'The sizing direction does not match the trade action.'
  }

  return (
    <div className={`p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg ${className}`}>
      <div className="flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-red-800 dark:text-red-300">Direction Conflict</div>
          <div className="text-sm text-red-700 dark:text-red-400 mt-1">{explanation}</div>
        </div>
      </div>
    </div>
  )
}
