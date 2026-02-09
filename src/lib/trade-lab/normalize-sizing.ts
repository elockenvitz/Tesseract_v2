/**
 * Trade Lab Sizing Normalization
 *
 * Implements v3 spec: Converts user sizing input to computed values,
 * detects direction conflicts, and applies lot rounding.
 *
 * Key principle: Sign always represents exposure change, not "more of this action".
 * - BUY +0.5 → increase weight by 0.5 (no conflict)
 * - SELL -0.5 → decrease weight by 0.5 (no conflict)
 * - BUY -0.5 → CONFLICT (buying but decreasing exposure)
 * - SELL +0.5 → CONFLICT (selling but increasing exposure)
 */

import { parseSizingInput, toSizingSpec, type SizingSpec, type SizingContext } from './sizing-parser'
import type {
  TradeAction,
  ComputedValues,
  NormalizedSizingResult,
  RoundingConfig,
  ActiveWeightConfig,
  AssetPrice,
  SizingValidationError,
  ConflictTrigger,
} from '../../types/trading'

// =============================================================================
// TYPES
// =============================================================================

export interface CurrentPosition {
  shares: number
  weight: number
  cost_basis: number | null
  active_weight: number | null
}

export interface NormalizationContext {
  action: TradeAction
  sizing_input: string
  current_position: CurrentPosition | null
  portfolio_total_value: number
  price: AssetPrice
  rounding_config: RoundingConfig
  active_weight_config: ActiveWeightConfig | null
  has_benchmark: boolean
  trigger?: ConflictTrigger  // v3: What caused this normalization (for conflict events)
}

// =============================================================================
// DIRECTION CONFLICT DETECTION (v3 spec)
// =============================================================================

/**
 * Get the suggested action to resolve a conflict.
 */
function getSuggestedDirection(action: TradeAction, sharesChange: number): TradeAction {
  // If shares_change is positive (increasing), suggest BUY/ADD
  // If shares_change is negative (decreasing), suggest SELL/TRIM
  if (sharesChange > 0) {
    return action === 'add' ? 'add' : 'buy'
  } else {
    return action === 'trim' ? 'trim' : 'sell'
  }
}

/**
 * Build human-readable conflict message.
 */
function buildConflictMessage(action: TradeAction, sharesChange: number): string {
  const changeDesc = sharesChange > 0
    ? `+${Math.abs(sharesChange).toLocaleString()} share increase`
    : `${Math.abs(sharesChange).toLocaleString()} share decrease`

  return `${action.toUpperCase()} action conflicts with ${changeDesc}`
}

/**
 * Detect if sizing contradicts the stated action.
 *
 * Per v3 spec:
 * - Conflict is based on shares_change (computed delta shares)
 * - shares_change === 0 is ALWAYS allowed (no conflict)
 * - BUY/ADD + negative shares_change = CONFLICT
 * - SELL/TRIM + positive shares_change = CONFLICT
 *
 * @returns SizingValidationError with details, or null if no conflict
 */
export function detectDirectionConflict(
  action: TradeAction,
  sharesChange: number,
  trigger: ConflictTrigger = 'user_edit'
): SizingValidationError | null {
  // v3 spec: shares_change === 0 is always allowed (no conflict)
  if (sharesChange === 0) {
    return null
  }

  const isIncreasing = sharesChange > 0
  const isDecreasing = sharesChange < 0

  let hasConflict = false

  // Check action vs shares_change direction
  switch (action) {
    case 'buy':
    case 'add':
      // Buying should increase exposure (positive shares_change)
      hasConflict = isDecreasing
      break

    case 'sell':
    case 'trim':
      // Selling should decrease exposure (negative shares_change)
      hasConflict = isIncreasing
      break

    default:
      hasConflict = false
  }

  if (!hasConflict) {
    return null
  }

  // Build conflict error object
  return {
    code: 'direction_conflict',
    message: buildConflictMessage(action, sharesChange),
    action,
    shares_change: sharesChange,
    suggested_direction: getSuggestedDirection(action, sharesChange),
    trigger,
  }
}

/**
 * Legacy boolean wrapper for backward compatibility.
 * @deprecated Use detectDirectionConflict which returns SizingValidationError | null
 */
export function hasDirectionConflict(
  action: TradeAction,
  sharesChange: number
): boolean {
  return detectDirectionConflict(action, sharesChange) !== null
}

// =============================================================================
// LOT ROUNDING (v3 spec)
// =============================================================================

/**
 * Apply lot size rounding to share count.
 *
 * v3 spec: Weight->shares conversion rounds toward zero:
 * - For positive shares: floor (round down)
 * - For negative shares: ceil (round up toward zero)
 *
 * Direct shares inputs (#target/#delta) do NOT apply lot rounding.
 *
 * @param shares - The computed share count
 * @param config - Rounding configuration
 * @param isDirectSharesInput - If true, skip lot rounding (v3 spec)
 * @returns [roundedShares, belowLotWarning]
 */
export function applyLotRounding(
  shares: number,
  config: RoundingConfig,
  isDirectSharesInput: boolean = false
): [number, boolean] {
  const { lot_size, min_lot_behavior, zero_threshold = 0, round_direction = 'toward_zero' } = config

  // v3 spec: Direct shares inputs (#target/#delta) do NOT apply lot rounding
  if (isDirectSharesInput) {
    return [Math.round(shares), false]
  }

  // No rounding needed if lot_size is 1
  if (lot_size <= 1) {
    return [Math.round(shares), false]
  }

  const absShares = Math.abs(shares)
  const sign = shares >= 0 ? 1 : -1

  // v3: Check zero threshold
  if (zero_threshold > 0 && absShares < zero_threshold) {
    return [0, true]
  }

  // Check if below minimum lot
  if (absShares < lot_size) {
    switch (min_lot_behavior) {
      case 'allow_zero':
      case 'zero':
        return [0, true]
      case 'round_to_one_lot':
        return [sign * lot_size, true]
      case 'warn':
        return [sign * Math.round(absShares), true]
      case 'round':
      default:
        // Round to nearest lot (could be 0 or lot_size)
        const roundedToLot = Math.round(absShares / lot_size) * lot_size
        return [sign * roundedToLot, roundedToLot === 0]
    }
  }

  // Apply lot rounding based on direction
  let roundedAbs: number
  switch (round_direction) {
    case 'toward_zero':
      // v3 spec: floor for positive, ceil for negative (toward zero)
      roundedAbs = Math.floor(absShares / lot_size) * lot_size
      break
    case 'up':
      roundedAbs = Math.ceil(absShares / lot_size) * lot_size
      break
    case 'down':
      roundedAbs = Math.floor(absShares / lot_size) * lot_size
      break
    case 'nearest':
    default:
      roundedAbs = Math.round(absShares / lot_size) * lot_size
  }

  return [sign * roundedAbs, false]
}

// =============================================================================
// MAIN NORMALIZATION
// =============================================================================

/**
 * Normalize sizing input to computed values.
 *
 * This is the main entry point for sizing normalization.
 * Returns a NormalizedSizingResult with computed values, conflict detection, and warnings.
 */
export function normalizeSizing(ctx: NormalizationContext): NormalizedSizingResult {
  const {
    action,
    sizing_input,
    current_position,
    portfolio_total_value,
    price,
    rounding_config,
    active_weight_config,
    has_benchmark,
  } = ctx

  // Parse the sizing input
  const sizingContext: SizingContext = { has_benchmark }
  const parseResult = parseSizingInput(sizing_input, sizingContext)

  if (!parseResult.is_valid) {
    return {
      is_valid: false,
      direction_conflict: null,
      below_lot_warning: false,
      error: parseResult.error,
    }
  }

  const sizingSpec = toSizingSpec(sizing_input, parseResult)
  if (!sizingSpec) {
    return {
      is_valid: false,
      direction_conflict: null,
      below_lot_warning: false,
      error: 'Failed to create sizing spec',
    }
  }

  // Get current state
  const currentShares = current_position?.shares ?? 0
  const currentWeight = current_position?.weight ?? 0
  const currentActiveWeight = current_position?.active_weight ?? 0
  const benchmarkWeight = active_weight_config?.benchmark_weight ?? 0

  // Compute target values based on framework
  let targetShares: number
  let targetWeight: number
  let deltaShares: number
  let deltaWeight: number

  const priceValue = price.price
  if (priceValue <= 0) {
    return {
      is_valid: false,
      direction_conflict: null,
      below_lot_warning: false,
      error: 'Invalid price (must be > 0)',
    }
  }

  switch (sizingSpec.framework) {
    case 'weight_target':
      // Target absolute weight
      targetWeight = sizingSpec.value
      deltaWeight = targetWeight - currentWeight
      // Convert weight delta to shares
      deltaShares = (deltaWeight / 100) * portfolio_total_value / priceValue
      targetShares = currentShares + deltaShares
      break

    case 'weight_delta':
      // Delta weight change
      deltaWeight = sizingSpec.value
      targetWeight = currentWeight + deltaWeight
      // Convert weight delta to shares
      deltaShares = (deltaWeight / 100) * portfolio_total_value / priceValue
      targetShares = currentShares + deltaShares
      break

    case 'shares_target':
      // Target absolute shares
      targetShares = sizingSpec.value
      deltaShares = targetShares - currentShares
      // Convert shares to weight
      const valueChange = deltaShares * priceValue
      deltaWeight = (valueChange / portfolio_total_value) * 100
      targetWeight = currentWeight + deltaWeight
      break

    case 'shares_delta':
      // Delta share change
      deltaShares = sizingSpec.value
      targetShares = currentShares + deltaShares
      // Convert shares to weight
      const deltaValue = deltaShares * priceValue
      deltaWeight = (deltaValue / portfolio_total_value) * 100
      targetWeight = currentWeight + deltaWeight
      break

    case 'active_target':
      // Target active weight (vs benchmark)
      if (!has_benchmark) {
        return {
          is_valid: false,
          direction_conflict: null,
          below_lot_warning: false,
          error: 'No benchmark configured for active weight sizing',
        }
      }
      const targetActiveWeight = sizingSpec.value
      targetWeight = benchmarkWeight + targetActiveWeight
      deltaWeight = targetWeight - currentWeight
      deltaShares = (deltaWeight / 100) * portfolio_total_value / priceValue
      targetShares = currentShares + deltaShares
      break

    case 'active_delta':
      // Delta active weight change
      if (!has_benchmark) {
        return {
          is_valid: false,
          direction_conflict: null,
          below_lot_warning: false,
          error: 'No benchmark configured for active weight sizing',
        }
      }
      const deltaActiveWeight = sizingSpec.value
      deltaWeight = deltaActiveWeight // Active weight delta = portfolio weight delta
      targetWeight = currentWeight + deltaWeight
      deltaShares = (deltaWeight / 100) * portfolio_total_value / priceValue
      targetShares = currentShares + deltaShares
      break

    default:
      return {
        is_valid: false,
        direction_conflict: null,
        below_lot_warning: false,
        error: `Unknown sizing framework: ${sizingSpec.framework}`,
      }
  }

  // v3: Direct shares inputs (#target/#delta) do NOT apply lot rounding
  const isDirectSharesInput = sizingSpec.framework === 'shares_target' || sizingSpec.framework === 'shares_delta'

  // Apply lot rounding first (we need rounded shares for conflict detection)
  const [roundedDeltaShares, belowLotWarning] = applyLotRounding(deltaShares, rounding_config, isDirectSharesInput)
  const roundedTargetShares = currentShares + roundedDeltaShares

  // Recompute weight with rounded shares
  const roundedDeltaWeight = (roundedDeltaShares * priceValue / portfolio_total_value) * 100
  const roundedTargetWeight = currentWeight + roundedDeltaWeight

  // v3: Detect direction conflict using shares_change (rounded delta shares)
  // Per spec: shares_change === 0 is always allowed
  const trigger = ctx.trigger ?? 'user_edit'
  const directionConflict = detectDirectionConflict(action, roundedDeltaShares, trigger)

  // Determine direction from delta
  const direction: 'buy' | 'sell' = roundedDeltaShares >= 0 ? 'buy' : 'sell'

  // Compute active weight if benchmark available
  let targetActiveWeight: number | undefined
  let deltaActiveWeightComputed: number | undefined
  if (has_benchmark && active_weight_config) {
    targetActiveWeight = roundedTargetWeight - benchmarkWeight
    deltaActiveWeightComputed = roundedDeltaWeight
  }

  // Build computed values
  const computed: ComputedValues = {
    direction,
    target_shares: roundedTargetShares,
    target_weight: roundedTargetWeight,
    delta_shares: roundedDeltaShares,
    delta_weight: roundedDeltaWeight,
    shares_change: roundedDeltaShares,  // v3: Alias for delta_shares, used for conflict detection
    delta_active_weight: deltaActiveWeightComputed,
    target_active_weight: targetActiveWeight,
    notional_value: Math.abs(roundedDeltaShares * priceValue),
    price_used: priceValue,
    price_timestamp: price.timestamp,
  }

  return {
    is_valid: true,
    computed,
    direction_conflict: directionConflict,
    below_lot_warning: belowLotWarning,
    rounded_shares: roundedTargetShares,
  }
}

// =============================================================================
// BATCH NORMALIZATION
// =============================================================================

export interface BatchNormalizationInput {
  id: string
  action: TradeAction
  sizing_input: string
  asset_id: string
  current_position: CurrentPosition | null
  active_weight_config: ActiveWeightConfig | null
}

export interface BatchNormalizationResult {
  id: string
  result: NormalizedSizingResult
  sizing_spec: SizingSpec | null
}

/**
 * Normalize multiple variants in a batch.
 *
 * Uses Map-based O(n) approach for efficiency.
 */
export function normalizeSizingBatch(
  inputs: BatchNormalizationInput[],
  prices: Map<string, AssetPrice>,
  portfolio_total_value: number,
  rounding_config: RoundingConfig,
  has_benchmark: boolean
): Map<string, BatchNormalizationResult> {
  const results = new Map<string, BatchNormalizationResult>()

  for (const input of inputs) {
    const price = prices.get(input.asset_id)

    if (!price) {
      results.set(input.id, {
        id: input.id,
        result: {
          is_valid: false,
          direction_conflict: null,
          below_lot_warning: false,
          error: 'No price available for asset',
        },
        sizing_spec: null,
      })
      continue
    }

    const ctx: NormalizationContext = {
      action: input.action,
      sizing_input: input.sizing_input,
      current_position: input.current_position,
      portfolio_total_value,
      price,
      rounding_config,
      active_weight_config: input.active_weight_config,
      has_benchmark,
    }

    const result = normalizeSizing(ctx)

    // Parse sizing spec for storage
    const parseResult = parseSizingInput(input.sizing_input, { has_benchmark })
    const sizing_spec = parseResult.is_valid
      ? toSizingSpec(input.sizing_input, parseResult)
      : null

    results.set(input.id, {
      id: input.id,
      result,
      sizing_spec,
    })
  }

  return results
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Check if any variants have direction conflicts.
 * Used to block Trade Sheet creation.
 */
export function hasAnyConflicts(results: Map<string, BatchNormalizationResult>): boolean {
  for (const result of results.values()) {
    if (result.result.direction_conflict) {
      return true
    }
  }
  return false
}

/**
 * Check if any variants have below-lot warnings.
 */
export function hasAnyBelowLotWarnings(results: Map<string, BatchNormalizationResult>): boolean {
  for (const result of results.values()) {
    if (result.result.below_lot_warning) {
      return true
    }
  }
  return false
}

/**
 * Get summary statistics for normalization results.
 */
export function getNormalizationSummary(results: Map<string, BatchNormalizationResult>): {
  total: number
  valid: number
  invalid: number
  conflicts: number
  below_lot_warnings: number
  total_notional: number
} {
  let valid = 0
  let invalid = 0
  let conflicts = 0
  let belowLotWarnings = 0
  let totalNotional = 0

  for (const result of results.values()) {
    if (result.result.is_valid) {
      valid++
      totalNotional += result.result.computed?.notional_value ?? 0
    } else {
      invalid++
    }
    if (result.result.direction_conflict) conflicts++
    if (result.result.below_lot_warning) belowLotWarnings++
  }

  return {
    total: results.size,
    valid,
    invalid,
    conflicts,
    below_lot_warnings: belowLotWarnings,
    total_notional: totalNotional,
  }
}
