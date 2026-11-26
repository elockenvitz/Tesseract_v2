/**
 * When may a price move be attributed to a decision?
 *
 * ── The defect this exists to stop ───────────────────────────────────────
 *
 * Measured in the QA org, 2026-11-20. A synthetic MSFT decision recorded at
 * 00:26 UTC was reported in Outcomes as:
 *
 *     RETURN  +35.8%     P&L  +$156K
 *     "You increased exposure to MSFT before strong appreciation.
 *      Conviction has been rewarded."
 *
 * The decision was twenty minutes old. Three prices were in play:
 *
 *     market close 2026-11-19        $523.10   price_history_cache, yahoo_chart_v8
 *     execution (price_at_acceptance) $430.20   portfolio_holdings.price, SEEDED
 *     decision snapshot               $385.20   copied from assets.current_price
 *
 * 523.10 / 385.20 - 1 = +35.80%, exactly the figure displayed. Every point of
 * it is MSFT's real move from roughly July to November 2026 -- all of it
 * BEFORE the decision existed. The P&L came from a different basis again
 * (1674 x (523.10 - 430.20) = $155,514), so the two numbers in one row did
 * not even agree with each other.
 *
 * ── Why a freshness check is not enough ──────────────────────────────────
 *
 * `assets.current_price` has NO observation timestamp -- there is no
 * `price_updated_at` column on that table at all. A snapshot taken from it
 * carries `snapshot_at` = when the ROW was written, which says nothing about
 * when the PRICE was seen. MSFT's $385.20 looked current and was four months
 * stale. So the decision-side price can never, on its own, establish that it
 * was observed at decision time.
 *
 * The question that CAN be answered from recorded facts is the other one:
 * does a market observation exist that is dated AFTER the decision? If the
 * newest close predates the decision, then whatever the entry price was,
 * nothing has been observed since -- and no return can be claimed by any
 * arithmetic. That is the gate implemented here.
 *
 * It fails closed. A missing or unparseable date is "cannot attribute",
 * never "attribute anyway".
 */

/** Why a move could not be attributed, for the UI to explain itself. */
export type AttributionBlock =
  | 'no_decision_time'
  | 'no_observation_date'
  | 'observation_predates_decision'

export interface AttributionWindow {
  /** True only when a dated observation exists strictly after the decision. */
  canAttribute: boolean
  /** Set when `canAttribute` is false. */
  blockedBy: AttributionBlock | null
}

const parse = (value: string | null | undefined): number | null => {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * May the move between a decision and a market observation be attributed to
 * that decision?
 *
 * @param decisionAt  when the decision was taken (approved_at, else created_at)
 * @param priceAsOf   the observation date of the price being measured TO
 */
export function attributionWindow(
  decisionAt: string | null | undefined,
  priceAsOf: string | null | undefined,
): AttributionWindow {
  const decided = parse(decisionAt)
  if (decided == null) return { canAttribute: false, blockedBy: 'no_decision_time' }

  const observed = parse(priceAsOf)
  if (observed == null) return { canAttribute: false, blockedBy: 'no_observation_date' }

  // Strictly after. A close stamped the same instant as the decision was not
  // observed following it, and an equal timestamp is far more likely to mean
  // "same day, no new information" than a genuine post-decision print.
  if (observed <= decided) {
    return { canAttribute: false, blockedBy: 'observation_predates_decision' }
  }

  return { canAttribute: true, blockedBy: null }
}

/** What the Outcomes surface shows in place of a return it cannot support. */
export const INSUFFICIENT_DATA_LABEL = 'Too early to evaluate'

/**
 * The direction of a position change, from the shares that actually moved.
 *
 * The idea's BUY/SELL thesis word is NOT the direction of the trade. A `buy`
 * idea sized from 6.14% down to 4.00% REDUCES the position, and `action`
 * still says `buy` -- which is how Outcomes came to describe a 1,674-share
 * cut as "You increased exposure to MSFT".
 *
 * This is the same invariant `executionActionType` enforces when the
 * execution event is written (PR #341); this is the read side, for rows whose
 * event was written before that fix or which carry no event at all.
 *
 * Returns null when no signed quantity is available, so the caller can decide
 * whether to fall back to the thesis word rather than having a guess made for
 * it.
 */
export function positionDirection(
  quantityBefore: number | null | undefined,
  quantityAfter: number | null | undefined,
): 'buy' | 'sell' | null {
  if (quantityBefore == null || quantityAfter == null) return null
  const before = Number(quantityBefore)
  const after = Number(quantityAfter)
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null
  const delta = after - before
  if (delta === 0) return null
  return delta > 0 ? 'buy' : 'sell'
}
