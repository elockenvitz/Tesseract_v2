/**
 * Tests for Trade Lab Sizing Normalization
 *
 * v3 spec: direction_conflict is SizingValidationError | null
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeSizing,
  normalizeSizingBatch,
  detectDirectionConflict,
  hasDirectionConflict,
  applyLotRounding,
  hasAnyConflicts,
  hasAnyBelowLotWarnings,
  getNormalizationSummary,
  type NormalizationContext,
  type CurrentPosition,
} from './normalize-sizing'
import { toSizingSpec, parseSizingInput } from './sizing-parser'
import type { AssetPrice, RoundingConfig, ActiveWeightConfig, SizingValidationError } from '../../types/trading'

// =============================================================================
// TEST HELPERS
// =============================================================================

const defaultPrice: AssetPrice = {
  asset_id: 'asset-1',
  price: 100,
  timestamp: '2024-01-01T00:00:00Z',
  source: 'realtime',
}

const defaultRoundingConfig: RoundingConfig = {
  lot_size: 1,
  min_lot_behavior: 'round',
  round_direction: 'nearest',
}

const defaultPosition: CurrentPosition = {
  shares: 1000,
  weight: 5, // 5% of portfolio
  cost_basis: 90,
  active_weight: 0.5,
}

function makeContext(overrides: Partial<NormalizationContext> = {}): NormalizationContext {
  return {
    action: 'buy',
    sizing_input: '1',
    current_position: defaultPosition,
    portfolio_total_value: 2_000_000, // $2M portfolio
    price: defaultPrice,
    rounding_config: defaultRoundingConfig,
    active_weight_config: null,
    has_benchmark: false,
    ...overrides,
  }
}

// =============================================================================
// DIRECTION CONFLICT DETECTION (v3 spec)
// =============================================================================

describe('detectDirectionConflict', () => {
  it('should return null (no conflict) for BUY with positive shares_change', () => {
    const result = detectDirectionConflict('buy', 100)
    expect(result).toBeNull()
  })

  it('should return conflict error for BUY with negative shares_change', () => {
    const result = detectDirectionConflict('buy', -100)
    expect(result).not.toBeNull()
    expect(result!.code).toBe('direction_conflict')
    expect(result!.action).toBe('buy')
    expect(result!.shares_change).toBe(-100)
    expect(result!.suggested_direction).toBe('sell')
    expect(result!.message).toContain('BUY')
  })

  it('should return null (no conflict) for SELL with negative shares_change', () => {
    const result = detectDirectionConflict('sell', -100)
    expect(result).toBeNull()
  })

  it('should return conflict error for SELL with positive shares_change', () => {
    const result = detectDirectionConflict('sell', 100)
    expect(result).not.toBeNull()
    expect(result!.code).toBe('direction_conflict')
    expect(result!.suggested_direction).toBe('buy')
  })

  it('should return null (no conflict) for ADD with positive shares_change', () => {
    expect(detectDirectionConflict('add', 100)).toBeNull()
  })

  it('should return conflict error for ADD with negative shares_change', () => {
    const result = detectDirectionConflict('add', -100)
    expect(result).not.toBeNull()
    expect(result!.suggested_direction).toBe('sell')
  })

  it('should return null (no conflict) for TRIM with negative shares_change', () => {
    expect(detectDirectionConflict('trim', -100)).toBeNull()
  })

  it('should return conflict error for TRIM with positive shares_change', () => {
    const result = detectDirectionConflict('trim', 100)
    expect(result).not.toBeNull()
    expect(result!.suggested_direction).toBe('buy')
  })

  // v3 spec: shares_change === 0 is ALWAYS allowed (no conflict)
  it('should return null when shares_change is 0 for BUY', () => {
    expect(detectDirectionConflict('buy', 0)).toBeNull()
  })

  it('should return null when shares_change is 0 for SELL', () => {
    expect(detectDirectionConflict('sell', 0)).toBeNull()
  })

  it('should return null when shares_change is 0 for ADD', () => {
    expect(detectDirectionConflict('add', 0)).toBeNull()
  })

  it('should return null when shares_change is 0 for TRIM', () => {
    expect(detectDirectionConflict('trim', 0)).toBeNull()
  })

  it('should include trigger in conflict error', () => {
    const result = detectDirectionConflict('buy', -100, 'load_revalidation')
    expect(result).not.toBeNull()
    expect(result!.trigger).toBe('load_revalidation')
  })
})

// Legacy boolean helper
describe('hasDirectionConflict', () => {
  it('should return true for conflict', () => {
    expect(hasDirectionConflict('buy', -100)).toBe(true)
  })

  it('should return false for no conflict', () => {
    expect(hasDirectionConflict('buy', 100)).toBe(false)
  })
})

// =============================================================================
// LOT ROUNDING
// =============================================================================

describe('applyLotRounding', () => {
  it('should not round when lot_size is 1', () => {
    const config: RoundingConfig = { lot_size: 1, min_lot_behavior: 'round' }
    const [rounded, warning] = applyLotRounding(123.7, config)
    expect(rounded).toBe(124)
    expect(warning).toBe(false)
  })

  it('should round to nearest lot (100)', () => {
    const config: RoundingConfig = { lot_size: 100, min_lot_behavior: 'round', round_direction: 'nearest' }
    const [rounded, warning] = applyLotRounding(150, config)
    expect(rounded).toBe(200)
    expect(warning).toBe(false)
  })

  it('should round down to lot (100)', () => {
    const config: RoundingConfig = { lot_size: 100, min_lot_behavior: 'round', round_direction: 'down' }
    const [rounded, warning] = applyLotRounding(150, config)
    expect(rounded).toBe(100)
    expect(warning).toBe(false)
  })

  it('should round up to lot (100)', () => {
    const config: RoundingConfig = { lot_size: 100, min_lot_behavior: 'round', round_direction: 'up' }
    const [rounded, warning] = applyLotRounding(150, config)
    expect(rounded).toBe(200)
    expect(warning).toBe(false)
  })

  it('should handle below-lot with min_lot_behavior=zero', () => {
    const config: RoundingConfig = { lot_size: 100, min_lot_behavior: 'zero' }
    const [rounded, warning] = applyLotRounding(50, config)
    expect(rounded).toBe(0)
    expect(warning).toBe(true)
  })

  it('should handle below-lot with min_lot_behavior=warn', () => {
    const config: RoundingConfig = { lot_size: 100, min_lot_behavior: 'warn' }
    const [rounded, warning] = applyLotRounding(50, config)
    expect(rounded).toBe(50)
    expect(warning).toBe(true)
  })

  it('should handle below-lot with min_lot_behavior=round', () => {
    const config: RoundingConfig = { lot_size: 100, min_lot_behavior: 'round', round_direction: 'nearest' }
    const [rounded, warning] = applyLotRounding(50, config)
    expect(rounded).toBe(100) // Rounds to nearest lot
    expect(warning).toBe(false)
  })

  it('should preserve sign for negative shares', () => {
    const config: RoundingConfig = { lot_size: 100, min_lot_behavior: 'round', round_direction: 'nearest' }
    const [rounded, warning] = applyLotRounding(-150, config)
    expect(rounded).toBe(-200)
    expect(warning).toBe(false)
  })
})

// =============================================================================
// MAIN NORMALIZATION
// =============================================================================

describe('normalizeSizing', () => {
  describe('weight_target', () => {
    it('should compute values for absolute weight target', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '6', // Target 6% weight (currently 5%)
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed).toBeDefined()
      expect(result.computed!.direction).toBe('buy')
      expect(result.computed!.target_weight).toBeCloseTo(6, 1)
      expect(result.computed!.delta_weight).toBeCloseTo(1, 1)
      expect(result.computed!.shares_change).toBeCloseTo(200, 0) // v3: shares_change alias
      // 1% of $2M = $20,000 / $100 = 200 shares
      expect(result.computed!.delta_shares).toBeCloseTo(200, 0)
    })

    it('should return conflict error when BUY with weight decrease', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '4', // Target 4% (down from 5%)
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).not.toBeNull() // v3: object = conflict
      expect(result.direction_conflict!.code).toBe('direction_conflict')
      expect(result.direction_conflict!.suggested_direction).toBe('sell')
      expect(result.computed!.delta_shares).toBeLessThan(0)
    })
  })

  describe('weight_delta', () => {
    it('should compute values for weight delta (increase)', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '+0.5', // Add 0.5% weight
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed!.delta_weight).toBeCloseTo(0.5, 1)
      // 0.5% of $2M = $10,000 / $100 = 100 shares
      expect(result.computed!.delta_shares).toBeCloseTo(100, 0)
    })

    it('should compute values for weight delta (decrease)', () => {
      const ctx = makeContext({
        action: 'sell',
        sizing_input: '-0.5', // Reduce 0.5% weight
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed!.delta_weight).toBeCloseTo(-0.5, 1)
      expect(result.computed!.delta_shares).toBeCloseTo(-100, 0)
    })

    it('should return conflict error when SELL with positive delta', () => {
      const ctx = makeContext({
        action: 'sell',
        sizing_input: '+0.5', // Increasing exposure while selling
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).not.toBeNull() // v3: object = conflict
      expect(result.direction_conflict!.suggested_direction).toBe('buy')
    })
  })

  describe('shares_target', () => {
    it('should compute values for absolute share target', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '#1200', // Target 1200 shares (currently 1000)
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed!.target_shares).toBe(1200)
      expect(result.computed!.delta_shares).toBe(200)
    })

    it('should return conflict error when BUY targets fewer shares', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '#800', // Target 800 shares (down from 1000)
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).not.toBeNull() // v3: object = conflict
    })
  })

  describe('shares_delta', () => {
    it('should compute values for share delta (increase)', () => {
      const ctx = makeContext({
        action: 'add',
        sizing_input: '#+100', // Add 100 shares
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed!.delta_shares).toBe(100)
      expect(result.computed!.target_shares).toBe(1100)
    })

    it('should compute values for share delta (decrease)', () => {
      const ctx = makeContext({
        action: 'trim',
        sizing_input: '#-200', // Remove 200 shares
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed!.delta_shares).toBe(-200)
      expect(result.computed!.target_shares).toBe(800)
    })
  })

  describe('active_target (@t)', () => {
    const benchmarkConfig: ActiveWeightConfig = {
      source: 'portfolio_benchmark',
      benchmark_weight: 4.5, // Benchmark has 4.5% weight
    }

    it('should compute values for active target (overweight)', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '@t0.5', // Target +0.5% overweight
        has_benchmark: true,
        active_weight_config: benchmarkConfig,
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      // Target weight = benchmark (4.5%) + active (0.5%) = 5%
      // Current weight = 5%, so no change needed
      expect(result.computed!.target_weight).toBeCloseTo(5, 1)
    })

    it('should compute values for active target (underweight)', () => {
      const ctx = makeContext({
        action: 'sell',
        sizing_input: '@t-0.5', // Target -0.5% underweight
        has_benchmark: true,
        active_weight_config: benchmarkConfig,
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      // Target weight = 4.5% - 0.5% = 4% (down from 5%)
      expect(result.computed!.target_weight).toBeCloseTo(4, 1)
      expect(result.computed!.delta_weight).toBeCloseTo(-1, 1)
    })

    it('should fail without benchmark', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '@t0.5',
        has_benchmark: false,
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(false)
      expect(result.error).toContain('benchmark')
    })
  })

  describe('active_delta (@d)', () => {
    const benchmarkConfig: ActiveWeightConfig = {
      source: 'portfolio_benchmark',
      benchmark_weight: 4.5,
    }

    it('should compute values for active delta (increase)', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '@d+0.5', // Increase active weight by 0.5%
        has_benchmark: true,
        active_weight_config: benchmarkConfig,
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed!.delta_weight).toBeCloseTo(0.5, 1)
    })

    it('should compute values for active delta (decrease)', () => {
      const ctx = makeContext({
        action: 'sell',
        sizing_input: '@d-0.5', // Decrease active weight by 0.5%
        has_benchmark: true,
        active_weight_config: benchmarkConfig,
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.direction_conflict).toBeNull() // v3: null = no conflict
      expect(result.computed!.delta_weight).toBeCloseTo(-0.5, 1)
    })
  })

  describe('lot rounding integration', () => {
    it('should apply lot rounding to computed shares', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '+0.5', // Would normally be 100 shares
        rounding_config: {
          lot_size: 100,
          min_lot_behavior: 'round',
          round_direction: 'nearest',
        },
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.computed!.delta_shares).toBe(100) // Rounded to lot
      expect(result.below_lot_warning).toBe(false)
    })

    it('should set below_lot_warning when shares below lot size', () => {
      const ctx = makeContext({
        action: 'buy',
        sizing_input: '+0.01', // Very small - would be ~2 shares
        rounding_config: {
          lot_size: 100,
          min_lot_behavior: 'warn',
        },
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(true)
      expect(result.below_lot_warning).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should return error for invalid sizing input', () => {
      const ctx = makeContext({
        sizing_input: 'invalid',
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should return error for zero price', () => {
      const ctx = makeContext({
        price: { ...defaultPrice, price: 0 },
      })

      const result = normalizeSizing(ctx)

      expect(result.is_valid).toBe(false)
      expect(result.error).toContain('price')
    })
  })
})

// =============================================================================
// BATCH NORMALIZATION
// =============================================================================

describe('normalizeSizingBatch', () => {
  it('should normalize multiple variants', () => {
    const inputs = [
      {
        id: 'v1',
        action: 'buy' as const,
        sizing_input: '+0.5',
        asset_id: 'asset-1',
        current_position: defaultPosition,
        active_weight_config: null,
      },
      {
        id: 'v2',
        action: 'sell' as const,
        sizing_input: '-0.25',
        asset_id: 'asset-2',
        current_position: { ...defaultPosition, shares: 500, weight: 2.5 },
        active_weight_config: null,
      },
    ]

    const prices = new Map<string, AssetPrice>([
      ['asset-1', defaultPrice],
      ['asset-2', { ...defaultPrice, asset_id: 'asset-2', price: 50 }],
    ])

    const results = normalizeSizingBatch(
      inputs,
      prices,
      2_000_000,
      defaultRoundingConfig,
      false
    )

    expect(results.size).toBe(2)
    expect(results.get('v1')?.result.is_valid).toBe(true)
    expect(results.get('v2')?.result.is_valid).toBe(true)
  })

  it('should handle missing prices', () => {
    const inputs = [
      {
        id: 'v1',
        action: 'buy' as const,
        sizing_input: '+0.5',
        asset_id: 'asset-1',
        current_position: defaultPosition,
        active_weight_config: null,
      },
    ]

    const prices = new Map<string, AssetPrice>() // No prices

    const results = normalizeSizingBatch(
      inputs,
      prices,
      2_000_000,
      defaultRoundingConfig,
      false
    )

    expect(results.get('v1')?.result.is_valid).toBe(false)
    expect(results.get('v1')?.result.error).toContain('price')
  })
})

// =============================================================================
// SUMMARY HELPERS
// =============================================================================

// v3: Mock conflict error for tests
const mockConflictError: SizingValidationError = {
  code: 'direction_conflict',
  message: 'BUY action conflicts with -100 share decrease',
  action: 'buy',
  shares_change: -100,
  suggested_direction: 'sell',
  trigger: 'user_edit',
}

describe('hasAnyConflicts', () => {
  it('should return true when any result has conflict (v3: non-null error)', () => {
    const results = new Map([
      ['v1', { id: 'v1', result: { is_valid: true, direction_conflict: null, below_lot_warning: false }, sizing_spec: null }],
      ['v2', { id: 'v2', result: { is_valid: true, direction_conflict: mockConflictError, below_lot_warning: false }, sizing_spec: null }],
    ])

    expect(hasAnyConflicts(results)).toBe(true)
  })

  it('should return false when no conflicts (v3: all null)', () => {
    const results = new Map([
      ['v1', { id: 'v1', result: { is_valid: true, direction_conflict: null, below_lot_warning: false }, sizing_spec: null }],
    ])

    expect(hasAnyConflicts(results)).toBe(false)
  })
})

describe('hasAnyBelowLotWarnings', () => {
  it('should return true when any result has below-lot warning', () => {
    const results = new Map([
      ['v1', { id: 'v1', result: { is_valid: true, direction_conflict: null, below_lot_warning: true }, sizing_spec: null }],
    ])

    expect(hasAnyBelowLotWarnings(results)).toBe(true)
  })
})

describe('getNormalizationSummary', () => {
  it('should compute correct summary statistics (v3: direction_conflict as object or null)', () => {
    const results = new Map([
      ['v1', {
        id: 'v1',
        result: {
          is_valid: true,
          direction_conflict: null, // v3: null = no conflict
          below_lot_warning: false,
          computed: { notional_value: 10000 } as any,
        },
        sizing_spec: null
      }],
      ['v2', {
        id: 'v2',
        result: {
          is_valid: true,
          direction_conflict: mockConflictError, // v3: object = conflict
          below_lot_warning: true,
          computed: { notional_value: 5000 } as any,
        },
        sizing_spec: null
      }],
      ['v3', {
        id: 'v3',
        result: {
          is_valid: false,
          direction_conflict: null,
          below_lot_warning: false,
          error: 'Invalid',
        },
        sizing_spec: null
      }],
    ])

    const summary = getNormalizationSummary(results)

    expect(summary.total).toBe(3)
    expect(summary.valid).toBe(2)
    expect(summary.invalid).toBe(1)
    expect(summary.conflicts).toBe(1)
    expect(summary.below_lot_warnings).toBe(1)
    expect(summary.total_notional).toBe(15000)
  })
})

// =============================================================================
// V3 INTEGRATION TESTS
// =============================================================================

describe('v3 integration: conflict persistence and behavior', () => {
  it('conflict persists on variant save - normalization result includes full error object', () => {
    // Simulate: User enters conflicting sizing (BUY with negative change)
    const ctx = makeContext({
      action: 'buy',
      sizing_input: '#800', // Target 800 shares, down from 1000 = -200 shares
      trigger: 'user_edit',
    })

    const result = normalizeSizing(ctx)

    // v3: Conflict is an object that can be persisted to DB
    expect(result.is_valid).toBe(true) // Still valid! Conflicts don't invalidate
    expect(result.direction_conflict).not.toBeNull()
    expect(result.direction_conflict).toMatchObject({
      code: 'direction_conflict',
      action: 'buy',
      shares_change: -200,
      suggested_direction: 'sell',
      trigger: 'user_edit',
    })

    // The computed values are still available
    expect(result.computed).toBeDefined()
    expect(result.computed!.target_shares).toBe(800)
    expect(result.computed!.shares_change).toBe(-200)
  })

  it('conflict recomputed on load revalidation with new price', () => {
    // Simulate: Variant loaded with old computed values, price changed
    // First save with no conflict
    const ctx1 = makeContext({
      action: 'buy',
      sizing_input: '#1200', // Target 1200, up from 1000 = +200 shares
      trigger: 'user_edit',
    })

    const result1 = normalizeSizing(ctx1)
    expect(result1.direction_conflict).toBeNull() // No conflict initially

    // Price changes, causing target to be below current (simulated via position change)
    // Now 1200 target with 1500 current = -300 shares (conflict!)
    const ctx2 = makeContext({
      action: 'buy',
      sizing_input: '#1200',
      current_position: { ...defaultPosition, shares: 1500 }, // Now have 1500
      trigger: 'load_revalidation',
    })

    const result2 = normalizeSizing(ctx2)
    expect(result2.direction_conflict).not.toBeNull()
    expect(result2.direction_conflict!.trigger).toBe('load_revalidation')
    expect(result2.direction_conflict!.shares_change).toBe(-300)
  })

  it('trade sheet blocked but drafts still saved - hasAnyConflicts check', () => {
    // v3: Conflicts do NOT block saving individual variants
    // They ONLY block Trade Sheet creation

    const ctx = makeContext({
      action: 'sell',
      sizing_input: '+0.5', // Conflict: selling with positive exposure change
    })

    const result = normalizeSizing(ctx)

    // 1. Result is valid (can be saved as draft)
    expect(result.is_valid).toBe(true)

    // 2. Conflict exists
    expect(result.direction_conflict).not.toBeNull()

    // 3. Simulate batch check for Trade Sheet creation
    const batchResults = new Map([
      ['v1', { id: 'v1', result, sizing_spec: null }],
      ['v2', { id: 'v2', result: { is_valid: true, direction_conflict: null, below_lot_warning: false }, sizing_spec: null }],
    ])

    // 4. Trade Sheet creation would be blocked
    expect(hasAnyConflicts(batchResults)).toBe(true)

    // 5. But v1 is still valid and can be saved
    expect(batchResults.get('v1')!.result.is_valid).toBe(true)
  })

  it('shares_change === 0 never creates conflict (edge case)', () => {
    // Target equals current position = 0 shares_change
    const ctx = makeContext({
      action: 'buy',
      sizing_input: '#1000', // Target 1000, current 1000 = 0 change
    })

    const result = normalizeSizing(ctx)

    expect(result.is_valid).toBe(true)
    expect(result.direction_conflict).toBeNull() // v3 spec: 0 is always allowed
    expect(result.computed!.shares_change).toBe(0)
  })
})
