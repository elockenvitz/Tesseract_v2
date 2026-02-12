/**
 * Shared sizing utilities for proposals.
 *
 * Extracted from ProposalEditorModal so both the full-screen modal
 * and the inline pane form can reuse the same logic.
 */

import {
  parseSizingInput,
  toSizingSpec,
} from './sizing-parser'
import {
  normalizeSizing,
  detectDirectionConflict,
  type NormalizationContext,
} from './normalize-sizing'
import type {
  TradeSizingMode,
  AssetPrice,
  RoundingConfig,
  SizingValidationError,
} from '../../types/trading'

// =============================================================================
// V3 SIZING INTEGRATION
// =============================================================================

/**
 * Parse sizing input using v3 parser with direction conflict detection.
 * Returns both the parsed result and conflict status.
 */
export function parseSizingWithConflictCheck(
  sizingInput: string,
  action: string,
  currentPosition: { shares: number; weight: number } | null,
  portfolioTotalValue: number,
  price: number,
  hasBenchmark: boolean
): {
  isValid: boolean
  error?: string
  framework?: string
  value?: number
  directionConflict: SizingValidationError | null
  computed?: {
    targetShares: number
    targetWeight: number
    deltaShares: number
    deltaWeight: number
  }
} {
  // Parse using v3 parser
  const parseResult = parseSizingInput(sizingInput, { has_benchmark: hasBenchmark })

  if (!parseResult.is_valid) {
    return {
      isValid: false,
      error: parseResult.error,
      directionConflict: null,
    }
  }

  const sizingSpec = toSizingSpec(sizingInput, parseResult)
  if (!sizingSpec) {
    return {
      isValid: false,
      error: 'Failed to parse sizing',
      directionConflict: null,
    }
  }

  // Create mock price for normalization
  const mockPrice: AssetPrice = {
    asset_id: 'temp',
    price: price > 0 ? price : 100,
    timestamp: new Date().toISOString(),
    source: 'realtime',
  }

  // Default rounding config (no rounding for proposals)
  const roundingConfig: RoundingConfig = {
    lot_size: 1,
    min_lot_behavior: 'round',
    round_direction: 'nearest',
  }

  // Normalize to get computed values
  const normCtx: NormalizationContext = {
    action: action as any,
    sizing_input: sizingInput,
    current_position: currentPosition ? {
      shares: currentPosition.shares,
      weight: currentPosition.weight,
      cost_basis: null,
      active_weight: null,
    } : null,
    portfolio_total_value: portfolioTotalValue,
    price: mockPrice,
    rounding_config: roundingConfig,
    active_weight_config: null,
    has_benchmark: hasBenchmark,
  }

  const normResult = normalizeSizing(normCtx)

  return {
    isValid: normResult.is_valid,
    error: normResult.error,
    framework: sizingSpec.framework,
    value: sizingSpec.value,
    directionConflict: normResult.direction_conflict,
    computed: normResult.computed ? {
      targetShares: normResult.computed.target_shares,
      targetWeight: normResult.computed.target_weight,
      deltaShares: normResult.computed.delta_shares,
      deltaWeight: normResult.computed.delta_weight,
    } : undefined,
  }
}

/**
 * Legacy mapping for backwards compatibility with existing proposal code.
 */
export function mapFrameworkToLegacyMode(framework: string | undefined): TradeSizingMode {
  switch (framework) {
    case 'weight_target': return 'weight'
    case 'weight_delta': return 'delta_weight'
    case 'shares_target': return 'shares'
    case 'shares_delta': return 'delta_shares'
    case 'active_target':
    case 'active_delta': return 'delta_benchmark'
    default: return 'weight'
  }
}
