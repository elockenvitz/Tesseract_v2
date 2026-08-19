/**
 * What kind of thing a holdings row actually is, and what may be claimed about it.
 *
 * Every lens in this product starts from `portfolio_holdings`, which is a list
 * of book lines rather than a list of listed instruments. Cash is a line. So are
 * sweep vehicles and, in some uploads, accruals. They have a value and a weight
 * and no other financial properties at all, and every card type that reasons
 * about price, targets or coverage is nonsense when pointed at one.
 *
 * This was not theoretical. `CASH_USD` sits in 29 of the org's portfolios, so
 * the moment a "position with no price target" card existed it produced 29
 * copies of "cash is a real position with no price on it" — a card that is
 * simultaneously true, unanswerable and the single loudest thing in the feed.
 */

/**
 * Book lines that are not instruments.
 *
 * Matched on symbol rather than `asset_type`, because `asset_type` is NULL on
 * the row that matters: `CASH_USD` carries no type, no lifecycle status and no
 * classification of any kind. A predicate that read the column would return
 * "unknown, assume tradable" for the exact case it exists to catch.
 *
 * The upstream `scripts/backfill-price-history.mjs` already excludes
 * `CASH_USD` by name for the same reason, so this is the second place that
 * knowledge lives and the last one that should have to.
 */
const CASH_SYMBOLS = new Set(['CASH_USD', 'CASH', 'USD', 'CASH_USD_SWEEP'])

/** Prefixes used by uploads for non-instrument book lines. */
const CASH_PREFIXES = ['CASH_', 'CCY_', 'FX_CASH']

/**
 * True when the row is a cash or cash-equivalent book line.
 *
 * Cash is not excluded from the feed wholesale. It is a legitimate subject for
 * exactly the claims that are about SIZE — an unusually large cash weight is a
 * real finding, and arguably a more interesting one than any single position.
 * It is excluded from every claim that presupposes a price: targets, coverage,
 * conviction against upside, crowding across books.
 */
export function isCashLine(symbol: string | null | undefined, assetType?: string | null): boolean {
  const s = (symbol ?? '').trim().toUpperCase()
  if (!s) return false
  if (CASH_SYMBOLS.has(s)) return true
  if (CASH_PREFIXES.some(p => s.startsWith(p))) return true
  const t = (assetType ?? '').trim().toLowerCase()
  return t === 'cash' || t === 'cash_equivalent' || t === 'money_market'
}

/**
 * True when it makes sense to state a price target, an upside or a thesis.
 *
 * The single predicate every price-shaped lens should gate on, so a tenth card
 * type cannot reintroduce "CASH_USD has no research" by forgetting the check.
 */
export function isPriceable(symbol: string | null | undefined, assetType?: string | null): boolean {
  return !isCashLine(symbol, assetType)
}

/**
 * How far a stated target may sit from the price before it stops being a view.
 *
 * 3x, matching `scenarioGap`'s long-standing constant: a real thesis can
 * plausibly carry a 2x, and nothing legitimate puts a target more than three
 * times away from the tape.
 */
export const IMPLAUSIBLE_TARGET_MULTIPLE = 3

/**
 * Whether a target and a price can be talking about the same security.
 *
 * ── What this is really detecting ─────────────────────────────────────────
 *
 * Measured against production: GOOGL carries a $1,605 target against a $344
 * close (4.7x), AMZN a $90 target against $259 (0.35x), PLTR $50 against $172
 * (0.29x). Every one of those would render as a confident card claiming a 366%
 * upside or a 65% downside, and every one of them is an artifact rather than a
 * view: a target entered against a pre-split share count, a figure typed into
 * the wrong field, or a number nobody has revisited across a corporate action.
 *
 * ── Why this is a guard and not an adjustment ─────────────────────────────
 *
 * The honest fix for a split is to adjust the target by the split ratio. This
 * database has no corporate-actions table — no splits, no dividends, no
 * ratio anywhere — so there is nothing to adjust BY. Inferring a ratio from the
 * size of the discrepancy would be inventing the very number the product is
 * missing, and it would silently "fix" the two cases here that are data-entry
 * errors rather than splits.
 *
 * So the card is suppressed rather than corrected, and the reason is recorded.
 * A target this far from the tape is a research-data problem to be fixed at the
 * source; the feed's job is to stop asserting a return nobody believes, not to
 * guess what was meant. Real adjustment needs a corporate-actions feed, which is
 * a separate piece of work with a separate data dependency.
 */
export function targetIsPlausible(target: number, price: number): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(price) || target <= 0 || price <= 0) return false
  const ratio = Math.max(target / price, price / target)
  return ratio <= IMPLAUSIBLE_TARGET_MULTIPLE
}
