/**
 * Turning a PM's approval into an executable trade.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * The Decision Inbox accept path wrote `accepted_trades` with the raw
 * `sizing_input` string and NOTHING ELSE: `delta_shares`, `delta_weight`,
 * `target_shares`, `target_weight`, `notional_value` and
 * `price_at_acceptance` were all null. `apply_trade_to_holdings` opens with
 * `IF p_target_shares IS NULL AND p_delta_shares IS NULL` and RETURNS
 * `applied:false` rather than raising, so nothing moved and nothing threw.
 *
 * Before Decision Execution Truth that produced a silent lie — two
 * production trades still read `complete` with null sizing and no evidence
 * row. Afterwards it produces an honest refusal. Neither is a trade.
 *
 * Trade Lab never had this problem because it runs `normalizeSizing` upstream
 * at variant-create time and passes `computed` through. The Inbox had no
 * equivalent step. This module is that step.
 *
 * ── One valuation snapshot per decision ──────────────────────────────────
 *
 * Price and portfolio value come from the SAME holdings snapshot that
 * produced the weight the PM was shown, and that is a deliberate product
 * decision rather than convenience.
 *
 * Production makes the reason concrete. SHOP carries three prices: the book
 * marks it at $82.40, the newest cached close is $149.09, and
 * `assets.current_price` says $78.90. The PM approved "trim 50bp" against a
 * 2.8430576% weight — a number that only exists because the book is marked
 * at $82.40. Sizing that approval at $149.09 sells ~6,534 shares instead of
 * 2,110 for the same instruction, and lands the position at a weight the PM
 * never approved. `target = current + delta` only closes if both sides are
 * measured in the same money.
 *
 * So: the book's own price basis, or refuse. Never a third number, and never
 * a fabricated one — `proposal-sizing.ts` substitutes a price of 100 when it
 * has none, which is exactly the trap this path must not fall into.
 */

import { supabase } from '../supabase'
import { currentBook, type HoldingRow } from '../holdings/portfolio-context'
import { normalizeSizing, type NormalizationContext } from '../trade-lab/normalize-sizing'
import { parseSizingInput, toSizingSpec } from '../trade-lab/sizing-parser'
import type { TradeAction, ComputedValues, SizingSpec } from '../../types/trading'

/**
 * The valuation snapshot a single decision is sized against.
 *
 * Every field comes from one `portfolio_holdings` date. `asOf` is carried so
 * a caller can say WHEN the book was true rather than implying "now".
 */
export interface AcceptSizingBasis {
  currentShares: number
  currentWeight: number
  /** The book's carrying price for this asset, in the snapshot's money. */
  price: number
  portfolioTotalValue: number
  asOf: string | null
  /** True when the asset is not in the book — a genuinely new position. */
  isNewPosition: boolean
}

export type AcceptSizingRefusal = {
  ok: false
  /** Shown to the PM and written to `execution_note`. Must say what is missing. */
  reason: string
}

export type AcceptSizingResult =
  | { ok: true; computed: ComputedValues; spec: SizingSpec | null; basis: AcceptSizingBasis }
  | AcceptSizingRefusal

/**
 * Lot rounding for the pilot.
 *
 * Whole shares, rounded toward zero, matching the only other caller that
 * sizes outside Trade Lab (`SuggestionReviewPanel`). No portfolio-level
 * rounding config is read anywhere on this path; when one exists it belongs
 * here rather than as a second literal somewhere else.
 */
const PILOT_ROUNDING = {
  lot_size: 1,
  min_lot_behavior: 'round' as const,
  round_direction: 'toward_zero' as const,
}

/**
 * Read the book once and derive everything a decision needs from it.
 *
 * Returns a refusal rather than a guess when the book cannot price the
 * asset. A new position is allowed — its price then comes from the close on
 * the book's OWN snapshot date, which keeps the valuation moment consistent
 * even though the position itself is absent.
 */
export async function resolveAcceptSizingBasis(
  portfolioId: string,
  assetId: string,
  symbol: string | null,
): Promise<AcceptSizingBasis | AcceptSizingRefusal> {
  const { data, error } = await supabase
    .from('portfolio_holdings')
    .select('portfolio_id, asset_id, shares, price, date')
    .eq('portfolio_id', portfolioId)
    // Newest first so a truncating limit drops the OLDEST rows. Unordered,
    // `limit` cut a nondeterministic set and "latest snapshot" became
    // whichever rows happened to survive.
    .order('date', { ascending: false, nullsFirst: false })
    .limit(5000)

  if (error) {
    return { ok: false, reason: `Could not read the portfolio's holdings to size this trade: ${error.message}` }
  }

  // The snapshot-date rule lives inside `currentBook`, not here. Trusting the
  // caller to pre-filter is what drifted 22 of 27 aggregating query sites.
  const book = currentBook((data ?? []) as unknown as HoldingRow[])
  const totals = book.byPortfolio.get(portfolioId)

  if (!totals || !(totals.totalValue > 0)) {
    return {
      ok: false,
      reason: 'This portfolio has no valued holdings snapshot, so a target weight cannot be converted into shares.',
    }
  }

  const position = book.byKey.get(`${portfolioId}:${assetId}`)

  if (position) {
    const price = position.price
    if (price == null || !(price > 0)) {
      return {
        ok: false,
        reason: 'The holdings snapshot carries no price for this asset, so a weight cannot be converted into shares.',
      }
    }
    return {
      currentShares: position.shares ?? 0,
      currentWeight: position.weightPct ?? 0,
      price,
      portfolioTotalValue: totals.totalValue,
      asOf: totals.asOf,
      isNewPosition: false,
    }
  }

  /*
   * Not held. There is no carrying price to borrow, so take the close on the
   * book's own snapshot date — the same valuation moment, which is the
   * property that matters. Deliberately NOT the newest close: that would
   * reintroduce the mixed-basis error for exactly the trades where the PM
   * has least intuition about the number.
   */
  if (!symbol || !totals.asOf) {
    return {
      ok: false,
      reason: 'This asset is not held and has no price on the portfolio’s snapshot date, so a new position cannot be sized.',
    }
  }

  const { data: closeRow } = await supabase
    .from('price_history_cache')
    .select('close, date')
    .eq('symbol', symbol)
    .lte('date', totals.asOf)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const close = (closeRow as { close?: number } | null)?.close
  if (close == null || !(close > 0)) {
    return {
      ok: false,
      reason: `No price for ${symbol} on or before ${totals.asOf}, so a new position cannot be sized against this book.`,
    }
  }

  return {
    currentShares: 0,
    currentWeight: 0,
    price: Number(close),
    portfolioTotalValue: totals.totalValue,
    asOf: totals.asOf,
    isNewPosition: true,
  }
}

/** Narrow a basis-or-refusal. */
export const isRefusal = (v: AcceptSizingBasis | AcceptSizingRefusal): v is AcceptSizingRefusal =>
  (v as AcceptSizingRefusal).ok === false

/**
 * The same basis, from a book the caller already has.
 *
 * The Decision Inbox holds a `CurrentBook` for the row it is rendering, so
 * the PM's preview can be computed with no extra query and — the point —
 * from the IDENTICAL inputs the commit will use. A preview sized from a
 * different basis than the commit would be a more subtle version of the bug
 * this whole change exists to fix.
 *
 * Returns a refusal for an unheld asset: the book cannot price what it does
 * not hold, and the close lookup that covers that case needs a round trip
 * the server side does. The preview says so rather than guessing.
 */
export function basisFromBook(
  book: { byKey: Map<string, { shares: number | null; price: number | null; weightPct: number | null }>; byPortfolio: Map<string, { totalValue: number; asOf: string | null }> } | undefined,
  portfolioId: string | null | undefined,
  assetId: string | null | undefined,
): AcceptSizingBasis | AcceptSizingRefusal {
  if (!book || !portfolioId || !assetId) {
    return { ok: false, reason: 'Reading the current book…' }
  }
  const totals = book.byPortfolio.get(portfolioId)
  if (!totals || !(totals.totalValue > 0)) {
    return { ok: false, reason: 'This portfolio has no valued holdings snapshot.' }
  }
  const position = book.byKey.get(`${portfolioId}:${assetId}`)
  if (!position) {
    return { ok: false, reason: 'Not currently held — the share count is computed on approval.' }
  }
  if (position.price == null || !(position.price > 0)) {
    return { ok: false, reason: 'The holdings snapshot carries no price for this asset.' }
  }
  return {
    currentShares: position.shares ?? 0,
    currentWeight: position.weightPct ?? 0,
    price: position.price,
    portfolioTotalValue: totals.totalValue,
    asOf: totals.asOf,
    isNewPosition: false,
  }
}

/**
 * Convert the approved sizing string into executable quantities.
 *
 * Pure given a basis, so the arithmetic is testable without a database.
 */
export function computeAcceptSizing(
  basis: AcceptSizingBasis,
  sizingInput: string,
  action: TradeAction,
  assetId: string,
): AcceptSizingResult {
  const trimmed = (sizingInput ?? '').trim()
  if (!trimmed) {
    return { ok: false, reason: 'No sizing was supplied, so there is nothing to execute.' }
  }

  const parsed = parseSizingInput(trimmed, { has_benchmark: false })
  if (!parsed.is_valid) {
    return {
      ok: false,
      reason: `“${trimmed}” is not a sizing instruction this path can execute${parsed.error ? `: ${parsed.error}` : ''}. Size it in Trade Lab instead.`,
    }
  }

  const ctx: NormalizationContext = {
    action,
    sizing_input: trimmed,
    current_position: {
      shares: basis.currentShares,
      weight: basis.currentWeight,
      cost_basis: null,
      active_weight: null,
    },
    portfolio_total_value: basis.portfolioTotalValue,
    price: {
      asset_id: assetId,
      price: basis.price,
      // The book's snapshot date, not now. A card that shows a book number
      // must be able to say when the book was true.
      timestamp: basis.asOf ?? new Date().toISOString(),
      source: 'close',
    },
    rounding_config: PILOT_ROUNDING,
    // Active-weight frameworks (@t / @d) need a benchmark this path does not
    // load. `normalizeSizing` rejects them rather than inventing one.
    active_weight_config: null,
    has_benchmark: false,
    trigger: 'user_edit',
  }

  const result = normalizeSizing(ctx)
  if (!result.is_valid || !result.computed) {
    return {
      ok: false,
      reason: result.error
        ? `This sizing could not be converted into shares: ${result.error}`
        : 'This sizing could not be converted into shares.',
    }
  }

  const computed = result.computed
  const moves = (computed.delta_shares ?? 0) !== 0 || (computed.target_shares ?? null) !== null
  if (!moves) {
    return { ok: false, reason: 'This sizing resolves to no share change, so there is nothing to execute.' }
  }

  return { ok: true, computed, spec: toSizingSpec(trimmed, parsed), basis }
}
