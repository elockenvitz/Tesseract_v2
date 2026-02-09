/**
 * Unified Sizing Input (Trade Lab v3)
 *
 * Single text input that accepts all v3 sizing formats:
 * - Weight: 2.5, +0.5, -0.25
 * - Shares: #500, #+100, #-50
 * - Active: @t0.5, @t-0.5, @d+0.25, @d-0.1
 *
 * Shows computed values inline and provides syntax help.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Info, AlertCircle, ArrowRight, HelpCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { parseSizingInput, toSizingSpec } from '../../lib/trade-lab/sizing-parser'
import { normalizeSizing, detectDirectionConflict } from '../../lib/trade-lab/normalize-sizing'
import type { TradeAction, SizingValidationError, AssetPrice, RoundingConfig } from '../../types/trading'

// =============================================================================
// TYPES
// =============================================================================

export interface CurrentPosition {
  shares: number
  weight: number
  cost_basis: number | null
  active_weight: number | null
}

export interface UnifiedSizingInputProps {
  /** Current sizing value (raw input string) */
  value: string
  /** Called when sizing changes */
  onChange: (value: string) => void
  /** Trade action (buy/sell/add/trim) */
  action: TradeAction
  /** Current position (null for new positions) */
  currentPosition: CurrentPosition | null
  /** Current asset price */
  price: number
  /** Portfolio total value */
  portfolioTotalValue: number
  /** Whether portfolio has a benchmark */
  hasBenchmark?: boolean
  /** Rounding configuration */
  roundingConfig?: RoundingConfig
  /** Called when conflict is detected (with SizingValidationError) */
  onConflictChange?: (conflict: SizingValidationError | null) => void
  /** Called when user clicks fix action */
  onFixAction?: (suggestedAction: TradeAction) => void
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Show help button */
  showHelp?: boolean
  /** Show computed preview below input (default true). Set false when card handles display separately. */
  showPreview?: boolean
  /** Class name */
  className?: string
}

export interface ComputedSizingPreview {
  isValid: boolean
  error?: string
  framework?: string
  intent?: string
  targetShares?: number
  targetWeight?: number
  deltaShares?: number
  deltaWeight?: number
  notionalValue?: number
  conflict?: SizingValidationError | null
  belowLotWarning?: boolean
}

// =============================================================================
// SIZING HELP CONTENT
// =============================================================================

const SIZING_HELP = {
  weight: [
    { syntax: '2.5', description: 'Target 2.5% portfolio weight' },
    { syntax: '+0.5', description: 'Add 0.5% weight' },
    { syntax: '-0.25', description: 'Remove 0.25% weight' },
  ],
  shares: [
    { syntax: '#500', description: 'Target 500 shares' },
    { syntax: '#+100', description: 'Add 100 shares' },
    { syntax: '#-50', description: 'Remove 50 shares' },
  ],
  active: [
    { syntax: '@t0.5', description: 'Target +0.5% active weight' },
    { syntax: '@t-0.5', description: 'Target -0.5% active weight' },
    { syntax: '@d+0.25', description: 'Add 0.25% active weight' },
    { syntax: '@d-0.1', description: 'Remove 0.1% active weight' },
  ],
}

// =============================================================================
// HELPER: Format number with sign
// =============================================================================

function formatWithSign(value: number, decimals: number = 2): string {
  const formatted = Math.abs(value).toFixed(decimals)
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

function formatShares(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs >= 1000 ? abs.toLocaleString() : abs.toString()
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

function formatMoney(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `$${(abs / 1_000_000).toFixed(1)}M`
  }
  if (abs >= 1_000) {
    return `$${(abs / 1_000).toFixed(0)}K`
  }
  return `$${abs.toFixed(0)}`
}

// =============================================================================
// HELPER: Build intent string
// =============================================================================

function buildIntentString(framework: string | undefined, value: number, hasBenchmark: boolean): string {
  switch (framework) {
    case 'weight_target':
      return `Target ${value.toFixed(2)}% weight`
    case 'weight_delta':
      return value >= 0 ? `Add ${value.toFixed(2)}% weight` : `Remove ${Math.abs(value).toFixed(2)}% weight`
    case 'shares_target':
      return `Target ${Math.abs(value).toLocaleString()} shares`
    case 'shares_delta':
      return value >= 0 ? `Add ${Math.abs(value).toLocaleString()} shares` : `Remove ${Math.abs(value).toLocaleString()} shares`
    case 'active_target':
      return `Target ${value >= 0 ? '+' : ''}${value.toFixed(2)}% active weight`
    case 'active_delta':
      return value >= 0 ? `Add ${value.toFixed(2)}% active weight` : `Remove ${Math.abs(value).toFixed(2)}% active weight`
    default:
      return ''
  }
}

// =============================================================================
// SIZING HELP TOOLTIP
// =============================================================================

interface SizingHelpTooltipProps {
  hasBenchmark: boolean
  onClose: () => void
}

function SizingHelpTooltip({ hasBenchmark, onClose }: SizingHelpTooltipProps) {
  return (
    <div className="absolute z-50 top-full left-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-900 dark:text-white">Sizing Syntax</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <span className="sr-only">Close</span>
          &times;
        </button>
      </div>

      <div className="space-y-3 text-xs">
        {/* Weight */}
        <div>
          <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">Weight</div>
          <div className="space-y-0.5">
            {SIZING_HELP.weight.map(item => (
              <div key={item.syntax} className="flex items-center gap-2">
                <code className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded font-mono">
                  {item.syntax}
                </code>
                <span className="text-gray-600 dark:text-gray-400">{item.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Shares */}
        <div>
          <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">Shares</div>
          <div className="space-y-0.5">
            {SIZING_HELP.shares.map(item => (
              <div key={item.syntax} className="flex items-center gap-2">
                <code className="px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded font-mono">
                  {item.syntax}
                </code>
                <span className="text-gray-600 dark:text-gray-400">{item.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Active Weight (only if benchmark) */}
        {hasBenchmark && (
          <div>
            <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">Active (vs benchmark)</div>
            <div className="space-y-0.5">
              {SIZING_HELP.active.map(item => (
                <div key={item.syntax} className="flex items-center gap-2">
                  <code className="px-1.5 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded font-mono">
                    {item.syntax}
                  </code>
                  <span className="text-gray-600 dark:text-gray-400">{item.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function UnifiedSizingInput({
  value,
  onChange,
  action,
  currentPosition,
  price,
  portfolioTotalValue,
  hasBenchmark = false,
  roundingConfig = { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
  onConflictChange,
  onFixAction,
  placeholder,
  disabled = false,
  size = 'md',
  showHelp = true,
  showPreview,
  className = '',
}: UnifiedSizingInputProps) {
  const [showHelpTooltip, setShowHelpTooltip] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

  // Compute preview whenever value changes
  const preview = useMemo((): ComputedSizingPreview => {
    if (!value.trim()) {
      return { isValid: false }
    }

    // Parse input
    const parseResult = parseSizingInput(value.trim(), { has_benchmark: hasBenchmark })

    if (!parseResult.is_valid) {
      return { isValid: false, error: parseResult.error || 'Invalid sizing format' }
    }

    // Get sizing spec
    const sizingSpec = toSizingSpec(value.trim(), parseResult)
    if (!sizingSpec) {
      return { isValid: false, error: 'Could not parse sizing' }
    }

    // Normalize to get computed values
    const normResult = normalizeSizing({
      action,
      sizing_input: value.trim(),
      current_position: currentPosition,
      portfolio_total_value: portfolioTotalValue,
      price: {
        asset_id: '',
        price,
        timestamp: new Date().toISOString(),
        source: 'realtime',
      },
      rounding_config: roundingConfig,
      active_weight_config: null,
      has_benchmark: hasBenchmark,
    })

    if (!normResult.is_valid) {
      return { isValid: false, error: normResult.error }
    }

    const computed = normResult.computed!
    const intent = buildIntentString(sizingSpec.framework, sizingSpec.value, hasBenchmark)

    return {
      isValid: true,
      framework: sizingSpec.framework,
      intent,
      targetShares: computed.target_shares,
      targetWeight: computed.target_weight,
      deltaShares: computed.delta_shares,
      deltaWeight: computed.delta_weight,
      notionalValue: computed.notional_value,
      conflict: normResult.direction_conflict,
      belowLotWarning: normResult.below_lot_warning,
    }
  }, [value, action, currentPosition, price, portfolioTotalValue, hasBenchmark, roundingConfig])

  // Notify parent of conflict changes
  useEffect(() => {
    onConflictChange?.(preview.conflict ?? null)
  }, [preview.conflict, onConflictChange])

  // Build placeholder
  const placeholderText = placeholder || (hasBenchmark
    ? 'e.g., 2.5  +0.5  #500  @t0.5'
    : 'e.g., 2.5  +0.5  #500  #+100')

  // Size classes
  const sizeClasses = {
    sm: 'h-7 text-xs px-2',
    md: 'h-9 text-sm px-3',
    lg: 'h-11 text-base px-4',
  }

  const hasConflict = preview.conflict !== null
  const hasWarning = preview.belowLotWarning

  return (
    <div className={clsx('relative', className)}>
      {/* Input Row */}
      <div className="relative flex items-center gap-1">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholderText}
            disabled={disabled}
            className={clsx(
              'w-full rounded-md border font-mono transition-colors',
              sizeClasses[size],
              disabled && 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed',
              hasConflict
                ? 'border-red-300 dark:border-red-700 focus:ring-red-500 focus:border-red-500'
                : hasWarning
                ? 'border-amber-300 dark:border-amber-700 focus:ring-amber-500 focus:border-amber-500'
                : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500 focus:border-primary-500',
              'bg-white dark:bg-gray-900 text-gray-900 dark:text-white',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500'
            )}
          />
        </div>

        {/* Help Button */}
        {showHelp && (
          <button
            type="button"
            onClick={() => setShowHelpTooltip(!showHelpTooltip)}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Sizing syntax help"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        )}

        {/* Help Tooltip */}
        {showHelpTooltip && (
          <SizingHelpTooltip
            hasBenchmark={hasBenchmark}
            onClose={() => setShowHelpTooltip(false)}
          />
        )}
      </div>

      {/* Preview / Error Area */}
      {showPreview !== false && value.trim() && (
        <div className="mt-1.5 space-y-1">
          {preview.isValid ? (
            <>
              {/* Intent Line */}
              {preview.intent && (
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium">→</span> {preview.intent}
                </div>
              )}

              {/* Computed Values */}
              <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                {preview.deltaShares !== undefined && preview.deltaShares !== 0 && (
                  <span>
                    {formatShares(preview.deltaShares)} shares
                  </span>
                )}
                {preview.deltaWeight !== undefined && preview.deltaWeight !== 0 && (
                  <span>
                    {formatWithSign(preview.deltaWeight)}% weight
                  </span>
                )}
                {preview.notionalValue !== undefined && preview.notionalValue > 0 && (
                  <span className="text-gray-400 dark:text-gray-500">
                    ({formatMoney(preview.notionalValue)})
                  </span>
                )}
              </div>

              {/* Position Change Preview */}
              {currentPosition && preview.targetWeight !== undefined && (
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  {currentPosition.weight.toFixed(2)}% → {preview.targetWeight.toFixed(2)}%
                  {currentPosition.shares !== undefined && preview.targetShares !== undefined && (
                    <span className="ml-2">
                      ({currentPosition.shares.toLocaleString()} → {preview.targetShares.toLocaleString()} sh)
                    </span>
                  )}
                </div>
              )}

              {/* Conflict Warning */}
              {hasConflict && preview.conflict && (
                <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-red-700 dark:text-red-400">
                        Direction Conflict
                      </div>
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                        {preview.conflict.message}
                      </div>
                      {onFixAction && (
                        <button
                          type="button"
                          onClick={() => onFixAction(preview.conflict!.suggested_direction)}
                          className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                          <ArrowRight className="w-3 h-3" />
                          Change to {preview.conflict.suggested_direction.toUpperCase()}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Below Lot Warning */}
              {hasWarning && !hasConflict && (
                <div className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <Info className="w-3 h-3" />
                  <span>Below minimum lot size</span>
                </div>
              )}
            </>
          ) : (
            /* Error State */
            <div className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              <span>{preview.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// COMPACT VARIANT (for inline use in tables/cards)
// =============================================================================

export interface CompactSizingInputProps {
  value: string
  onChange: (value: string) => void
  action: TradeAction
  currentPosition: CurrentPosition | null
  price: number
  portfolioTotalValue: number
  hasBenchmark?: boolean
  conflict?: SizingValidationError | null
  onFixAction?: (suggestedAction: TradeAction) => void
  disabled?: boolean
  className?: string
}

export function CompactSizingInput({
  value,
  onChange,
  action,
  currentPosition,
  price,
  portfolioTotalValue,
  hasBenchmark = false,
  conflict,
  onFixAction,
  disabled = false,
  className = '',
}: CompactSizingInputProps) {
  // Quick parse for preview
  const preview = useMemo(() => {
    if (!value.trim()) return null

    const parseResult = parseSizingInput(value.trim(), { has_benchmark: hasBenchmark })
    if (!parseResult.is_valid) return null

    const normResult = normalizeSizing({
      action,
      sizing_input: value.trim(),
      current_position: currentPosition,
      portfolio_total_value: portfolioTotalValue,
      price: { asset_id: '', price, timestamp: new Date().toISOString(), source: 'realtime' },
      rounding_config: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
      active_weight_config: null,
      has_benchmark: hasBenchmark,
    })

    if (!normResult.is_valid || !normResult.computed) return null

    return {
      deltaShares: normResult.computed.delta_shares,
      deltaWeight: normResult.computed.delta_weight,
      notional: normResult.computed.notional_value,
    }
  }, [value, action, currentPosition, price, portfolioTotalValue, hasBenchmark])

  const hasConflict = conflict !== null

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={clsx(
          'w-24 h-6 text-xs px-2 rounded border font-mono',
          hasConflict
            ? 'border-red-300 dark:border-red-700'
            : 'border-gray-300 dark:border-gray-600',
          'bg-white dark:bg-gray-900 text-gray-900 dark:text-white'
        )}
        placeholder="2.5"
      />

      {preview && (
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          → {formatWithSign(preview.deltaWeight)}% ({formatMoney(preview.notional)})
        </span>
      )}

      {hasConflict && onFixAction && (
        <button
          type="button"
          onClick={() => onFixAction(conflict!.suggested_direction)}
          className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50"
        >
          → {conflict!.suggested_direction.toUpperCase()}
        </button>
      )}
    </div>
  )
}

export default UnifiedSizingInput
