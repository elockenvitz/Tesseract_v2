import type { PricePoint } from '../../components/signals/PriceContext'

/**
 * What we actually know about a name's price, stated rather than inferred.
 *
 * ── Why this has to be explicit ───────────────────────────────────────────
 *
 * The asset universe is thin and unevenly thin. Measured 2026-08-20: 912
 * assets, 68 with a current price, 135 with any stored history, and 506 whose
 * exchange is the literal string `'Unknown'`. So the three facts below are
 * genuinely independent, and components kept inferring one from another:
 *
 *   - having an `assetId` does NOT mean a symbol resolves
 *   - a resolved symbol does NOT mean there is a current price
 *   - a current price does NOT mean there is history
 *
 * Every one of those inferences fails on real rows today, and the failure mode
 * is the worst kind: a chart appears, drawn from whatever data was reachable.
 * The rule this module exists to enforce is that a card would rather show
 * nothing than show the wrong name's tape.
 *
 * Pure — no React, no Supabase, no network.
 */

export type PriceAvailability =
  /** No symbol could be resolved. Nothing about price can be said at all. */
  | 'unresolved'
  /** Symbol is known, but nothing is cached for it. */
  | 'no_history'
  /** Symbol is known and there is enough history to draw. */
  | 'history'

export interface PriceIdentity {
  /** The symbol, uppercased, or null when it could not be resolved. */
  symbol: string | null
  availability: PriceAvailability
  /** The series, present only when `availability === 'history'`. */
  series: PricePoint[] | null
  /**
   * Why there is no chart, in words a developer can act on. Never rendered —
   * the reader gets the card's own copy — but it turns "the chart is missing"
   * into a specific answer during triage.
   */
  reason: string
}

/**
 * Two closes is the floor.
 *
 * `PriceContext` needs a line, and one point is not a line — it renders its own
 * empty state below two. Deciding it here as well means the caller knows
 * whether a chart will appear BEFORE it composes a pane around one.
 */
export const MIN_POINTS_FOR_CHART = 2

/**
 * Resolve what can be drawn for a symbol.
 *
 * `lookup` is whatever the caller uses to find a series — normally the price
 * history map, already keyed by traded symbol. Passed in rather than imported
 * so this module stays free of hooks and testable without a query client.
 */
export function priceIdentity(
  rawSymbol: string | null | undefined,
  lookup: (symbol: string) => PricePoint[] | undefined,
): PriceIdentity {
  const symbol = typeof rawSymbol === 'string' && rawSymbol.trim()
    ? rawSymbol.trim().toUpperCase()
    : null

  if (!symbol) {
    return { symbol: null, availability: 'unresolved', series: null, reason: 'no symbol on the card' }
  }

  /**
   * `'UNKNOWN'` and `'N/A'` are values in this database, not absences.
   *
   * 506 assets carry `exchange = 'Unknown'`, and the same placeholder habit
   * reaches symbols. Treating one as a real ticker would send it to the price
   * lookup, and — far worse — into a chart title.
   */
  if (symbol === 'UNKNOWN' || symbol === 'N/A' || symbol === '-') {
    return { symbol: null, availability: 'unresolved', series: null, reason: `placeholder symbol ${symbol}` }
  }

  const series = lookup(symbol)
  if (!series || series.length < MIN_POINTS_FOR_CHART) {
    return {
      symbol,
      availability: 'no_history',
      series: null,
      reason: series?.length
        ? `only ${series.length} close(s) cached for ${symbol}`
        : `nothing cached for ${symbol}`,
    }
  }

  return { symbol, availability: 'history', series, reason: 'ok' }
}

/** Convenience for the common branch: draw, or do not. */
export function canChart(id: PriceIdentity): id is PriceIdentity & { symbol: string; series: PricePoint[] } {
  return id.availability === 'history'
}
