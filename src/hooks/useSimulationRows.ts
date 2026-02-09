/**
 * useSimulationRows Hook
 *
 * Merges baselineHoldings[] + intentVariants[] into a unified SimulationRow[]
 * model for the Holdings Simulation Table.
 */

import { useMemo } from 'react'
import type {
  BaselineHolding,
  IntentVariant,
  ComputedValues,
  SizingValidationError,
  TradeAction,
} from '../types/trading'
import type { SizingSpec } from '../lib/trade-lab/sizing-parser'

// =============================================================================
// TYPES
// =============================================================================

export interface SimulationRow {
  asset_id: string
  symbol: string
  company_name: string
  sector: string | null

  baseline: {
    shares: number
    price: number
    value: number
    weight: number
  } | null

  variant: IntentVariant | null
  computed: ComputedValues | null

  // Display values
  currentShares: number
  simShares: number
  currentWeight: number
  simWeight: number
  benchWeight: number | null
  activeWeight: number | null
  deltaWeight: number
  deltaShares: number
  notional: number

  // Derived
  derivedAction: TradeAction

  // Status flags
  isNew: boolean
  isRemoved: boolean
  hasConflict: boolean
  hasWarning: boolean
  conflict: SizingValidationError | null
}

export interface SimulationRowSummary {
  totalPositions: number
  tradedCount: number
  untradedCount: number
  newPositionCount: number
  conflictCount: number
  warningCount: number
  totalNotional: number
  netDeltaWeight: number
}

interface UseSimulationRowsOptions {
  baselineHoldings: BaselineHolding[]
  variants: IntentVariant[]
  priceMap: Record<string, number>
}

// =============================================================================
// HELPERS
// =============================================================================

/** Derive the correct action from computed deltas (no manual override needed) */
function deriveAction(
  isNew: boolean,
  isRemoved: boolean,
  deltaShares: number,
  deltaWeight: number,
  hasComputed: boolean,
  fallback: TradeAction,
): TradeAction {
  // Before computed values arrive, trust the stored action from the trade idea
  if (!hasComputed) return fallback
  if (isNew) {
    // New position with negative delta = short sell
    if (deltaShares < 0 || deltaWeight < -0.005) return 'sell'
    return 'buy'
  }
  if (isRemoved) return 'sell'
  if (deltaShares > 0 || deltaWeight > 0.005) return 'add'
  if (deltaShares < 0 || deltaWeight < -0.005) return 'trim'
  return fallback
}

/**
 * Quick client-side parse of sizing_input for instant feedback.
 * Returns { weight, shares } estimates or null if unparseable.
 */
function quickEstimate(
  input: string,
  currentWeight: number,
  currentShares: number,
  price: number,
  totalValue: number,
): { weight: number; shares: number } | null {
  const s = input.trim()
  if (!s) return null

  // Shares-based: #500, #+100, #-50
  if (s.startsWith('#')) {
    const rest = s.substring(1)
    const num = parseFloat(rest)
    if (isNaN(num)) return null
    const isDelta = rest.startsWith('+') || rest.startsWith('-')
    const targetShares = isDelta ? currentShares + num : num
    const targetWeight = totalValue > 0 && price > 0
      ? (targetShares * price / totalValue) * 100
      : currentWeight
    return { weight: targetWeight, shares: Math.round(targetShares) }
  }

  // Active-weight: @t..., @d... — can't compute without benchmark, skip
  if (s.startsWith('@')) return null

  // Weight-based: 2.5, +0.5, -0.25
  const num = parseFloat(s.replace(/%/g, ''))
  if (isNaN(num)) return null
  const isDelta = s.startsWith('+') || s.startsWith('-')
  const targetWeight = isDelta ? currentWeight + num : num
  const targetShares = totalValue > 0 && price > 0
    ? (targetWeight / 100) * totalValue / price
    : currentShares
  return { weight: targetWeight, shares: Math.round(targetShares) }
}

/** Get the user's intended sim weight from sizing spec, preferring exact input over recomputed */
function getIntendedWeight(
  variant: IntentVariant | null,
  computed: ComputedValues | null,
  currentWeight: number,
): number {
  if (!variant) return currentWeight
  const spec = variant.sizing_spec as SizingSpec | null

  // Use server-computed spec when available
  if (spec) {
    if (spec.framework === 'weight_target') return spec.value
    if (spec.framework === 'weight_delta') return currentWeight + spec.value
  }
  if (computed) return computed.target_weight
  return currentWeight
}

// =============================================================================
// HOOK
// =============================================================================

export function useSimulationRows({
  baselineHoldings,
  variants,
  priceMap,
}: UseSimulationRowsOptions) {
  return useMemo(() => {
    // Step 1: Build maps
    const baselineMap = new Map<string, BaselineHolding>()
    baselineHoldings.forEach(h => baselineMap.set(h.asset_id, h))

    const variantMap = new Map<string, IntentVariant>()
    variants.forEach(v => variantMap.set(v.asset_id, v))

    const totalValue = baselineHoldings.reduce((s, h) => s + h.value, 0)
    const rows: SimulationRow[] = []

    // Step 2: For each baseline holding → lookup variant → build row
    baselineMap.forEach((holding, assetId) => {
      const variant = variantMap.get(assetId) || null
      const computed = (variant?.computed as ComputedValues) || null
      const conflict = variant
        ? (variant.direction_conflict as SizingValidationError | null)
        : null

      // Benchmark / active weight from variant context
      const benchWeight = variant?.active_weight_config?.benchmark_weight ?? null
      const activeWeight = benchWeight !== null ? holding.weight - benchWeight : null

      // Quick client-side estimate when computed is null but sizing_input exists
      const price = priceMap[assetId] || holding.price
      const est = !computed && variant?.sizing_input
        ? quickEstimate(variant.sizing_input, holding.weight, holding.shares, price, totalValue)
        : null

      const intendedWeight = est ? est.weight : getIntendedWeight(variant, computed, holding.weight)
      const simShares = est ? est.shares : (computed?.target_shares ?? holding.shares)
      const isRemoved = computed ? computed.target_shares === 0 : (est ? est.shares === 0 : false)

      const dw = (computed || est) ? intendedWeight - holding.weight : 0
      const ds = est ? simShares - holding.shares : (computed?.delta_shares ?? 0)
      // Signed notional: positive for buys/adds, negative for sells/trims
      const notional = est ? ds * price : (computed ? (computed.delta_shares ?? 0) * price : 0)

      rows.push({
        asset_id: assetId,
        symbol: holding.symbol,
        company_name: holding.company_name,
        sector: holding.sector,
        baseline: {
          shares: holding.shares,
          price: holding.price,
          value: holding.value,
          weight: holding.weight,
        },
        variant,
        computed,
        currentShares: holding.shares,
        simShares,
        currentWeight: holding.weight,
        simWeight: intendedWeight,
        benchWeight,
        activeWeight,
        deltaWeight: dw,
        deltaShares: ds,
        notional,
        derivedAction: deriveAction(false, isRemoved, ds, dw, computed !== null || est !== null, variant?.action || 'add'),
        isNew: false,
        isRemoved,
        hasConflict: conflict !== null,
        hasWarning: variant?.below_lot_warning ?? false,
        conflict,
      })
    })

    // Step 3: For each variant not in baseline → "new position" row
    variantMap.forEach((variant, assetId) => {
      if (baselineMap.has(assetId)) return

      const computed = (variant.computed as ComputedValues) || null
      const conflict = variant.direction_conflict as SizingValidationError | null
      const asset = (variant as any).asset

      const benchWeight = variant.active_weight_config?.benchmark_weight ?? null
      const activeWeight = benchWeight !== null ? 0 - benchWeight : null

      const price = priceMap[assetId] || 0
      const est = !computed && variant.sizing_input
        ? quickEstimate(variant.sizing_input, 0, 0, price, totalValue)
        : null

      const intendedWeight = est ? est.weight : getIntendedWeight(variant, computed, 0)
      const simShares = est ? est.shares : (computed?.target_shares ?? 0)

      const dw = (computed || est) ? intendedWeight : 0
      const ds = est ? simShares : (computed?.delta_shares ?? 0)
      // Signed notional: positive for buys, negative for sells
      const notional = est ? ds * price : (computed ? (computed.delta_shares ?? 0) * price : 0)

      rows.push({
        asset_id: assetId,
        symbol: asset?.symbol || 'Unknown',
        company_name: asset?.company_name || '',
        sector: asset?.sector || null,
        baseline: null,
        variant,
        computed,
        currentShares: 0,
        simShares,
        currentWeight: 0,
        simWeight: intendedWeight,
        benchWeight,
        activeWeight,
        deltaWeight: dw,
        deltaShares: ds,
        notional,
        derivedAction: deriveAction(true, false, ds, dw, computed !== null || est !== null, variant.action),
        isNew: true,
        isRemoved: false,
        hasConflict: conflict !== null,
        hasWarning: variant.below_lot_warning ?? false,
        conflict,
      })
    })

    // Step 4: Categorize rows and sort stably (no row jumping on edit)
    // Baseline holdings stay in weight-desc order, new positions at bottom
    const WEIGHT_THRESHOLD = 0.005  // half of 2-decimal display precision
    const SHARES_THRESHOLD = 0.5    // less than 1 share

    const tradedRows: SimulationRow[] = []
    const untradedRows: SimulationRow[] = []
    const newPositionRows: SimulationRow[] = []
    const baselineRows: SimulationRow[] = []
    const allNewRows: SimulationRow[] = [] // All new positions for sort order (includes traded)

    rows.forEach(row => {
      const hasMeaningfulTrade = row.variant?.sizing_input &&
        (Math.abs(row.deltaWeight) >= WEIGHT_THRESHOLD || Math.abs(row.deltaShares) >= SHARES_THRESHOLD)

      if (hasMeaningfulTrade) {
        tradedRows.push(row)
      } else if (row.isNew) {
        newPositionRows.push(row)
      } else {
        untradedRows.push(row)
      }

      // Separate list for stable sort: baseline vs new
      if (row.isNew) {
        allNewRows.push(row)
      } else {
        baselineRows.push(row)
      }
    })

    // Stable sort: baseline holdings by weight desc (position doesn't change when traded)
    baselineRows.sort((a, b) => b.currentWeight - a.currentWeight)
    allNewRows.sort((a, b) => Math.abs(b.deltaWeight) - Math.abs(a.deltaWeight))

    const sortedRows = [...baselineRows, ...allNewRows]

    // Step 5: Summary
    const summary: SimulationRowSummary = {
      totalPositions: sortedRows.length,
      tradedCount: tradedRows.length,
      untradedCount: untradedRows.length,
      newPositionCount: newPositionRows.length,
      conflictCount: sortedRows.filter(r => r.hasConflict).length,
      warningCount: sortedRows.filter(r => r.hasWarning).length,
      totalNotional: sortedRows.reduce((sum, r) => sum + r.notional, 0),
      netDeltaWeight: sortedRows.reduce((sum, r) => sum + r.deltaWeight, 0),
    }

    return {
      rows: sortedRows,
      tradedRows,
      untradedRows,
      newPositionRows,
      summary,
    }
  }, [baselineHoldings, variants, priceMap])
}
