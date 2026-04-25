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
  AcceptedTrade,
  ComputedValues,
  SizingValidationError,
  TradeAction,
} from '../types/trading'
import type { SizingSpec } from '../lib/trade-lab/sizing-parser'
import { detectDirectionConflict } from '../lib/trade-lab/normalize-sizing'

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
  acceptedTrade: AcceptedTrade | null

  // Display values
  currentShares: number
  simShares: number
  currentWeight: number
  simWeight: number
  benchWeight: number | null
  activeWeight: number | null
  deltaWeight: number
  deltaShares: number
  /** Signed delta notional: simShares × price − currentShares × price.
   *  Positive for buys/adds, negative for sells/trims. */
  notional: number
  /** Absolute post-trade notional value: simShares × price. */
  simNotional: number

  // Derived
  derivedAction: TradeAction

  // Status flags
  isNew: boolean
  isRemoved: boolean
  isCash: boolean
  hasConflict: boolean
  hasWarning: boolean
  conflict: SizingValidationError | null
  /** True when the variant's computed delta conflicts with the originating idea's action direction.
   *  E.g., idea says SELL but sizing increases exposure. */
  hasIdeaDirectionConflict: boolean
  /** True when this row has a pending accepted_trade (committed but not yet
   *  executed or reconciled). Used by HoldingsSimulationTable to lock the row:
   *  the PM must revert the pending trade via the Trade Book before editing
   *  the position further. For paper/manual_eod portfolios Phase 1
   *  auto-completes on accept so this should be false in normal operation. */
  isCommittedPending: boolean
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
  benchmarkWeightMap?: Record<string, number>
  acceptedTrades?: AcceptedTrade[]
  /** Map of asset_id → originating idea action (from trade queue item).
   *  Used for idea-direction conflict detection — the variant's action may be
   *  auto-derived from deltas and differ from the idea's intended direction. */
  ideaActionByAsset?: Record<string, TradeAction>
}

// =============================================================================
// HELPERS
// =============================================================================

/** Check if the computed delta conflicts with the originating idea's intended direction.
 *  E.g., idea says SELL but user sized +1% which increases exposure.
 *  Uses a sub-share threshold so rounding residue (e.g. -0.3 shares from a
 *  fractional baseline being rounded up) doesn't trip a false conflict. */
const IDEA_CONFLICT_SHARES_EPS = 1
function checkIdeaDirectionConflict(
  ideaAction: TradeAction | null | undefined,
  deltaShares: number,
  hasSizing: boolean,
): boolean {
  if (!ideaAction || !hasSizing || Math.abs(deltaShares) < IDEA_CONFLICT_SHARES_EPS) return false
  const isBuyIntent = ideaAction === 'buy' || ideaAction === 'add'
  const isSellIntent = ideaAction === 'sell' || ideaAction === 'trim'
  if (isBuyIntent && deltaShares < 0) return true
  if (isSellIntent && deltaShares > 0) return true
  return false
}

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
    // New position: positive delta = buy (new long), negative = sell (new short)
    if (deltaShares < 0 || deltaWeight < -0.005) return 'sell'
    return 'buy'
  }
  if (isRemoved) return 'sell'
  // Increasing position = add, decreasing = trim (display maps trim → "Reduce")
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
  assetBenchmarkWeight?: number | null,
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

  // Active-weight: @t (active target), @d (active delta)
  if (s.startsWith('@')) {
    if (assetBenchmarkWeight == null) return null
    const bw = assetBenchmarkWeight
    if (s.startsWith('@t')) {
      const num = parseFloat(s.substring(2))
      if (isNaN(num)) return null
      // @t0.5 means target active weight of 0.5% → portfolio weight = benchmark + active
      const targetWeight = bw + num
      const targetShares = totalValue > 0 && price > 0
        ? (targetWeight / 100) * totalValue / price
        : currentShares
      return { weight: targetWeight, shares: Math.round(targetShares) }
    }
    if (s.startsWith('@d')) {
      const num = parseFloat(s.substring(2))
      if (isNaN(num)) return null
      // @d+0.25 means change active weight by 0.25% → change portfolio weight by same amount
      const targetWeight = currentWeight + num
      const targetShares = totalValue > 0 && price > 0
        ? (targetWeight / 100) * totalValue / price
        : currentShares
      return { weight: targetWeight, shares: Math.round(targetShares) }
    }
    return null
  }

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
  assetBenchmarkWeight?: number | null,
): number {
  if (!variant) return currentWeight
  const spec = variant.sizing_spec as SizingSpec | null

  // Use server-computed spec when available
  if (spec) {
    if (spec.framework === 'weight_target') return spec.value
    if (spec.framework === 'weight_delta') return currentWeight + spec.value
    if (spec.framework === 'active_target' && assetBenchmarkWeight != null) {
      return assetBenchmarkWeight + spec.value
    }
    if (spec.framework === 'active_delta') {
      return currentWeight + spec.value
    }
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
  benchmarkWeightMap,
  acceptedTrades,
  ideaActionByAsset,
}: UseSimulationRowsOptions) {
  return useMemo(() => {
    // Step 1: Build maps
    const baselineMap = new Map<string, BaselineHolding>()
    baselineHoldings.forEach(h => baselineMap.set(h.asset_id, h))

    const variantMap = new Map<string, IntentVariant>()
    variants.forEach(v => variantMap.set(v.asset_id, v))

    const acceptedTradeMap = new Map<string, AcceptedTrade>()
    acceptedTrades?.forEach(t => acceptedTradeMap.set(t.asset_id, t))

    // A trade counts as "committed pending" if it exists and is neither
    // complete nor cancelled — matches the filter used for the pro-forma
    // baseline fold in SimulationPage.
    const isPending = (t: AcceptedTrade | undefined) =>
      !!t && t.execution_status !== 'complete' && t.execution_status !== 'cancelled'

    const totalValue = baselineHoldings.reduce((s, h) => s + h.value, 0)
    const rows: SimulationRow[] = []

    // Helper: is this a cash holding? (handled separately by synthetic cash row)
    const isCashSymbol = (sym: string) => {
      const s = sym.toUpperCase()
      return s === 'CASH' || s === '$CASH' || s === 'CASH_USD'
    }

    // Step 2: For each baseline holding → lookup variant → build row
    baselineMap.forEach((holding, assetId) => {
      const variant = variantMap.get(assetId) || null
      const computed = (variant?.computed as ComputedValues) || null

      // Benchmark / active weight: prefer benchmarkWeightMap, fall back to variant context
      const benchWeight = benchmarkWeightMap?.[assetId] ?? variant?.active_weight_config?.benchmark_weight ?? null
      const activeWeight = benchWeight !== null ? holding.weight - benchWeight : null

      // Quick client-side estimate when computed is null but sizing_input exists
      const price = priceMap[assetId] || holding.price
      const est = !computed && variant?.sizing_input
        ? quickEstimate(variant.sizing_input, holding.weight, holding.shares, price, totalValue, benchWeight)
        : null

      // Weight delta is exact from sizing input ("+0.5" → +0.5%), so the
      // client-side `est` weight matches what the server returns and is safe
      // to render optimistically. Shares is NOT — the server applies asset
      // lot-size rounding (e.g. 24 share lots) while `est` rounds to the
      // nearest whole share, so the two disagree and the column visibly
      // flashes from est-shares → server-shares. To keep the load clean,
      // shares stays on baseline values until `computed` returns; only
      // weight gets the optimistic preview.
      const rawIntendedWeight = est ? est.weight : getIntendedWeight(variant, computed, holding.weight, benchWeight)
      const rawSimShares = computed?.target_shares ?? holding.shares
      // Treat as "full exit" whenever the target weight is ≤ ~0 OR the
      // target shares are below one lot. Using strict `=== 0` on shares
      // misfires when the baseline has fractional shares (e.g. 1,075.12):
      // integer lot rounding on the delta leaves ~0.12 sub-share residue,
      // so the row is labelled "reduce/trim" instead of "close/sell".
      // Intent comes from target weight — if the user typed "0", they
      // want out regardless of rounding artifacts.
      const CLOSE_WEIGHT_EPS = 0.005 // half of 2-decimal display precision
      const CLOSE_SHARES_EPS = 1     // below one whole share → effectively gone
      const isRemoved = computed
        ? (computed.target_weight <= CLOSE_WEIGHT_EPS || Math.abs(computed.target_shares) < CLOSE_SHARES_EPS)
        : (est ? (est.weight <= CLOSE_WEIGHT_EPS || Math.abs(est.shares) < CLOSE_SHARES_EPS) : false)

      // When the row is "removed" (closing a position), clamp sim weight
      // and sim shares to exactly 0. Without this clamp, fractional baseline
      // residue leaks into Sim Wt (~0.005%), Sim Shrs (0.12), and Sim $
      // ($12) — all of which display as confusing non-zero crumbs next to
      // a CLOSE badge. Intent is zero; display follows intent.
      const intendedWeight = isRemoved ? 0 : rawIntendedWeight
      const simShares = isRemoved ? 0 : rawSimShares

      const dw = (computed || est) ? intendedWeight - holding.weight : 0
      // Delta shares: when closing, the delta is -currentShares exactly
      // (the user is selling everything the row holds), rounded to int.
      // For non-close cases, only use the server's `computed.delta_shares`
      // — the est-based fallback would round differently than the server's
      // lot-size logic and flash the wrong number for ~one render before
      // the server reply lands. Defaulting to 0 in the meantime keeps the
      // column quiet until the real value is known.
      const ds = isRemoved
        ? -Math.round(holding.shares)
        : (computed?.delta_shares ?? 0)
      // Signed notional: positive for buys/adds, negative for sells/trims.
      // For closes this is -currentValue so Δ$ reflects the full exit.
      //
      // Notional is derived from the *weight delta × NAV*, not from
      // `computed.delta_shares × current_price`. Why: when normalize-sizing
      // ran against a stale / fallback price (e.g. a $100 placeholder
      // because priceMap hadn't populated for a new position yet), the
      // stored `delta_shares` is inflated relative to the current real
      // price. Multiplying those inflated shares by the real current
      // price here then over-consumes cash by whatever factor
      // (real_price / stale_price) was. The weight delta, on the other
      // hand, is consistent with intent — so deriving the dollar flow
      // from it keeps the cash row and AAPL row in sync (AAPL +Xbps,
      // cash −Xbps), regardless of what price the variant was computed
      // against. For closes we still emit -currentValue so the full
      // exit shows up on Δ $.
      const notional = isRemoved
        ? -holding.value
        : (computed || est)
          ? (dw / 100) * totalValue
          : 0
      // Absolute sim notional: post-trade position value. Exactly 0 when
      // the position is being closed (no fractional-share residue).
      const simNotional = isRemoved ? 0 : simShares * price

      // Derive action from deltas, then recompute conflict using derived action.
      // This prevents stale DB action (e.g. 'add' from initial creation) from
      // causing false conflicts when the user's sizing implies a different direction.
      const derived = deriveAction(false, isRemoved, ds, dw, computed !== null || est !== null, variant?.action || 'add')
      // Only run the conflict check against server-finalized `computed` values.
      // Using the client-side `est` during the optimistic window can produce a
      // false-positive conflict from sub-share rounding residue that clears
      // when the server responds — the "flashing conflict alert" the user sees.
      const conflict = variant && computed
        ? detectDirectionConflict(derived, computed.delta_shares ?? ds, 'user_edit')
        : null

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
        acceptedTrade: acceptedTradeMap.get(assetId) || null,
        currentShares: holding.shares,
        simShares,
        currentWeight: holding.weight,
        simWeight: intendedWeight,
        benchWeight,
        activeWeight,
        deltaWeight: dw,
        deltaShares: ds,
        notional,
        simNotional,
        derivedAction: derived,
        isNew: false,
        isRemoved,
        isCash: isCashSymbol(holding.symbol),
        hasConflict: conflict !== null,
        hasWarning: variant?.below_lot_warning ?? false,
        conflict,
        // Idea-direction conflict: gated on server-finalized `computed` so the
        // optimistic-update window doesn't flash a false positive from
        // sub-share rounding in the client-side `est` delta.
        hasIdeaDirectionConflict: computed
          ? checkIdeaDirectionConflict(
              ideaActionByAsset?.[assetId] ?? variant?.action,
              computed.delta_shares ?? ds,
              !!variant?.sizing_input,
            )
          : false,
        isCommittedPending: isPending(acceptedTradeMap.get(assetId)),
      })
    })

    // Step 3: For each variant not in baseline → "new position" row
    variantMap.forEach((variant, assetId) => {
      if (baselineMap.has(assetId)) return

      const computed = (variant.computed as ComputedValues) || null
      const asset = (variant as any).asset

      const benchWeight = benchmarkWeightMap?.[assetId] ?? variant.active_weight_config?.benchmark_weight ?? null
      const activeWeight = benchWeight !== null ? 0 - benchWeight : null

      const price = priceMap[assetId] || 0
      const est = !computed && variant.sizing_input
        ? quickEstimate(variant.sizing_input, 0, 0, price, totalValue, benchWeight)
        : null

      // Same rationale as the baseline branch: weight est is exact and
      // safe to render optimistically; shares est rounds differently than
      // the server's lot-size logic and would flash on first paint, so
      // shares stays at 0 until `computed` returns.
      const intendedWeight = est ? est.weight : getIntendedWeight(variant, computed, 0, benchWeight)
      const simShares = computed?.target_shares ?? 0

      const dw = (computed || est) ? intendedWeight : 0
      const ds = computed?.target_shares ?? 0
      // Signed notional derived from intended weight × NAV (see the baseline
      // branch for the stale-price rationale). Using weight here keeps the
      // cash flow consistent with intent even if `computed.delta_shares`
      // was normalized against a fallback price.
      const notional = (computed || est) ? (dw / 100) * totalValue : 0
      // Absolute sim notional: post-trade position value. Also derive from
      // weight so it stays aligned with the displayed sim-weight column.
      const simNotional = (dw / 100) * totalValue

      const derivedNew = deriveAction(true, false, ds, dw, computed !== null || est !== null, variant.action)
      // Gate conflict detection on server-finalized `computed` values to avoid
      // transient false positives from sub-share rounding during the
      // optimistic-update window. See the baseline branch for full notes.
      const conflict = computed
        ? detectDirectionConflict(derivedNew, computed.delta_shares ?? ds, 'user_edit')
        : null

      rows.push({
        asset_id: assetId,
        symbol: asset?.symbol || 'Unknown',
        company_name: asset?.company_name || '',
        sector: asset?.sector || null,
        baseline: null,
        variant,
        computed,
        acceptedTrade: acceptedTradeMap.get(assetId) || null,
        currentShares: 0,
        simShares,
        currentWeight: 0,
        simWeight: intendedWeight,
        benchWeight,
        activeWeight,
        deltaWeight: dw,
        deltaShares: ds,
        notional,
        simNotional,
        derivedAction: derivedNew,
        isNew: true,
        isRemoved: false,
        isCash: false,
        hasConflict: conflict !== null,
        hasWarning: variant.below_lot_warning ?? false,
        conflict,
        // Idea-direction conflict: gated on server-finalized `computed` so the
        // optimistic-update window doesn't flash a false positive from
        // sub-share rounding in the client-side `est` delta.
        hasIdeaDirectionConflict: computed
          ? checkIdeaDirectionConflict(
              ideaActionByAsset?.[assetId] ?? variant.action,
              computed.delta_shares ?? ds,
              !!variant.sizing_input,
            )
          : false,
        isCommittedPending: isPending(acceptedTradeMap.get(assetId)),
      })
    })

    // Step 4: Categorize rows — NO auto-sort so rows don't jump on add/edit.
    // Baseline holdings keep their natural order (from stored simulation data),
    // new positions append at the bottom in insertion order.
    // User-controlled sort via column headers in HoldingsSimulationTable.
    const WEIGHT_THRESHOLD = 0.005  // half of 2-decimal display precision
    const SHARES_THRESHOLD = 0.5    // less than 1 share

    const tradedRows: SimulationRow[] = []
    const untradedRows: SimulationRow[] = []
    const newPositionRows: SimulationRow[] = []
    const baselineRows: SimulationRow[] = []
    const allNewRows: SimulationRow[] = []

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

      if (row.isNew) {
        allNewRows.push(row)
      } else {
        baselineRows.push(row)
      }
    })

    const sortedRows = [...baselineRows, ...allNewRows]

    // Step 5: Synthetic cash row — shows net cash impact of all trades.
    // Derive cash sim weight as 100% minus sum of all position sim weights so
    // the footer total is always exactly 100%.
    const netTradeNotional = sortedRows.reduce((sum, r) => sum + r.notional, 0)
    const cashNotional = -netTradeNotional  // cash moves opposite to trades
    const totalSimWeight = sortedRows.reduce((sum, r) => sum + r.simWeight, 0)
    const totalCurrentWeight = sortedRows.reduce((sum, r) => sum + r.currentWeight, 0)

    // Find existing cash baseline (if portfolio already has a cash position)
    const cashBaseline = baselineHoldings.find(h =>
      h.symbol.toUpperCase() === 'CASH' || h.symbol.toUpperCase() === '$CASH' || h.symbol.toUpperCase() === 'CASH_USD'
    )
    const baseCashWeight = cashBaseline?.weight ?? (100 - totalCurrentWeight)
    const cashSimWeight = 100 - totalSimWeight
    const cashDeltaWeight = cashSimWeight - baseCashWeight

    // If a real cash holding exists in the rows, update its deltas to reflect trade impact.
    // Cash is treated like a real position: trades consume/add cash, so delta shares = -netTradeNotional / cashPrice.
    //
    // Denominator note: a cash-funded trade (buy paid with cash, or sell
    // releasing cash) PRESERVES NAV — cash decreases/increases exactly as
    // position value increases/decreases. The post-trade portfolio total is
    // still `totalValue`. The earlier `totalValue + cashNotional` formula
    // treated the trade as net-new inflow/outflow, which silently drifted
    // cash's new weight off the correct value and made the footer "Δ Wt"
    // total non-zero when it should conserve (e.g. buying $165K of AAPL
    // with $165K of cash should show AAPL +Xbps and cash −Xbps summing to 0).
    //
    // Rule: compute cash's new weight against the SAME denominator as
    // every other position — `totalValue`. Then cash_delta = new − current.
    if (cashBaseline && netTradeNotional !== 0) {
      const cashRowInList = sortedRows.find(r => r.isCash)
      if (cashRowInList) {
        const cashPrice = cashBaseline.price || 1
        const cashDeltaShares = Math.round(cashNotional / cashPrice)
        const cashSimShares = cashBaseline.shares + cashDeltaShares
        const cashSimValue = cashSimShares * cashPrice
        const portfolioSimValue = totalValue // NAV is preserved on cash-funded trades
        const cashNewWeight = portfolioSimValue > 0 ? (cashSimValue / portfolioSimValue) * 100 : 0
        const cashWeightDelta = cashNewWeight - cashBaseline.weight

        cashRowInList.simShares = cashSimShares
        cashRowInList.deltaShares = cashDeltaShares
        cashRowInList.simWeight = cashNewWeight
        cashRowInList.deltaWeight = cashWeightDelta
        cashRowInList.notional = cashNotional
        cashRowInList.simNotional = cashSimValue
        cashRowInList.derivedAction = cashNotional >= 0 ? 'add' : 'trim'
      }
    }

    // Show a synthetic cash row whenever the baseline has no explicit cash
    // holding. Previously we only rendered it when there were pending trades
    // to show cash impact, but that hides the cash position the rest of the
    // time — the PM can't see "how much cash do I have" at rest. Always
    // surface cash:
    //   - With no trades: displays the baseline cash weight (100% - sum of
    //     position weights) with zero deltas. Often this is 0% for fully
    //     invested portfolios, which is still correct and informative.
    //   - With trades: cash weight + delta reflect net trade impact, same
    //     as before.
    const hasTrades = netTradeNotional !== 0
    const showSyntheticCash = !cashBaseline
    const cashRow: SimulationRow | null = showSyntheticCash ? {
      asset_id: '__cash__',
      symbol: 'CASH_USD',
      company_name: 'Cash & Equivalents',
      sector: null,
      baseline: cashBaseline ? {
        shares: cashBaseline.shares,
        price: cashBaseline.price,
        value: cashBaseline.value,
        weight: cashBaseline.weight,
      } : null,
      variant: null,
      computed: null,
      acceptedTrade: null,
      currentShares: 0,
      simShares: 0,
      currentWeight: baseCashWeight,
      simWeight: cashSimWeight,
      benchWeight: null,
      activeWeight: null,
      deltaWeight: cashDeltaWeight,
      deltaShares: 0,
      notional: cashNotional,
      // Sim notional for cash = target cash weight × portfolio total value.
      // This gives the table a consistent "what's this row worth post-trade"
      // column even for the synthetic cash line.
      simNotional: (cashSimWeight / 100) * (totalValue || 0),
      derivedAction: cashNotional >= 0 ? 'add' : 'trim',
      isNew: !cashBaseline && cashNotional !== 0,
      isRemoved: false,
      isCash: true,
      hasConflict: false,
      hasWarning: false,
      conflict: null,
      hasIdeaDirectionConflict: false,
      isCommittedPending: false,
    } : null

    // Step 6: Summary
    const summary: SimulationRowSummary = {
      totalPositions: sortedRows.length,
      tradedCount: tradedRows.length,
      untradedCount: untradedRows.length,
      newPositionCount: newPositionRows.length,
      conflictCount: sortedRows.filter(r => r.hasConflict).length,
      warningCount: sortedRows.filter(r => r.hasWarning).length,
      totalNotional: netTradeNotional,
      netDeltaWeight: sortedRows.reduce((sum, r) => sum + r.deltaWeight, 0),
    }

    return {
      rows: sortedRows,
      cashRow,
      tradedRows,
      untradedRows,
      newPositionRows,
      summary,
    }
  }, [baselineHoldings, variants, priceMap, benchmarkWeightMap, acceptedTrades, ideaActionByAsset])
}
