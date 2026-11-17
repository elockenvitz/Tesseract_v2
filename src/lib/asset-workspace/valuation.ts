/**
 * The scenario ladder as a valuation, not as two numbers.
 *
 * ── What the Overview said before ─────────────────────────────────────────
 *
 * `bear $205 · bull $450 · skew 2.1:1`. One line of text for the whole
 * valuation, with the middle of the distribution missing and no indication of
 * how likely the analyst thought either end was. A reader could not tell a
 * 50/50 bear/bull from a 12/62, and those are different investments.
 *
 * The probabilities were already in the database (`analyst_price_targets.
 * probability`), already typed on `TargetRow`, and already mapped onto
 * `LadderCase` — but `useAssetWorkspace` did not name the column in its
 * `select`, so every rung arrived with `probability: null` and the Overview
 * had nothing to draw. The fix is one column; this module is what makes it
 * worth drawing.
 *
 * ── Why an expected value is refused more often than it is given ──────────
 *
 * A probability-weighted expected value is only a number you can act on when
 * the weights are a distribution over ONE horizon. Live data does not usually
 * satisfy that, and the interesting part is saying why rather than printing
 * something anyway:
 *
 *   AAPL   Bull 12mo 62% · Base 6mo 19% · Bear 6mo 12% · Uber Bull 12mo 7%
 *
 * Those weights sum to 100, but a 6-month bear and a 12-month bull are not
 * outcomes of the same experiment. Averaging them produces a figure with no
 * horizon, which is worse than no figure because it looks like one.
 *
 * So `blocker` is a first-class result, not an error path. Each value names a
 * condition a reader can go and fix.
 *
 * ── Two things this deliberately does NOT do ──────────────────────────────
 *
 * It does not RENORMALISE weights that miss 100. Scaling 40/30/20 up to
 * 44/33/22 invents conviction the analyst did not express, and it would hide
 * the likelier explanation: a scenario was deleted, or one was never weighted.
 * `probabilitySum` is reported so the surface can state the actual figure.
 *
 * It does not GUESS the scale. Weights entered as 0.6/0.3/0.1 sum to 1, and
 * reading that as "sums to 100%" would be a hundredfold reinterpretation of
 * somebody's conviction. Fractions are refused with the sum shown, which is
 * a question to the reader rather than an answer invented for them.
 *
 * Units: prices are in whatever currency the asset quotes in, and this module
 * never formats them — see `lib/market-data/currency`. `impliedPct` is a
 * RATIO of two prices in that same unit, so it is unit-invariant and stays
 * correct even where the currency is unknown.
 */

/** One rung, with the figures a reader needs beside it. */
export interface ValuationScenario {
  /** The winning `analyst_price_targets` row, so a caller can link back. */
  id: string
  name: string
  price: number
  /** As the analyst entered it, 0-100. Null when never weighted. */
  probability: number | null
  /** Free text, e.g. "12 months". Null when unstated. */
  timeframe: string | null
  /** Move from spot to this target, in percent. Null without a usable spot. */
  impliedPct: number | null
}

/**
 * Why there is no expected value. Each names something a reader can resolve.
 */
export type ExpectedValueBlocker =
  /** Fewer than two rungs: a weighted average of one number is that number. */
  | 'single_scenario'
  /** At least one rung carries no probability. */
  | 'missing_probabilities'
  /** The weights do not form a distribution. `probabilitySum` says what they do. */
  | 'probabilities_do_not_sum'
  /** The rungs describe different horizons, so they are not one distribution. */
  | 'mixed_horizons'

export interface ExpectedValue {
  /** Sum of price x weight, in the asset's quoting unit. */
  price: number
  /** Move from spot to that expectation, in percent. Null without a spot. */
  impliedPct: number | null
  /** The single horizon the weights share. Null when none was stated. */
  horizon: string | null
}

export interface Valuation {
  /** Lowest price first, so the ladder reads bear to bull without naming them. */
  scenarios: ValuationScenario[]
  expected: ExpectedValue | null
  /** Null exactly when `expected` is present. */
  blocker: ExpectedValueBlocker | null
  /** The weights' total, when every rung had one. Null otherwise. */
  probabilitySum: number | null
  /** Lowest and highest rung, when there are at least two. */
  range: { low: number; high: number } | null
}

/** What this module needs from a `LadderCase`, and nothing more. */
export interface ValuationInput {
  id: string
  name: string
  price: number | null
  probability: number | null
  timeframe: string | null
}

/** Weights may miss 100 by this much and still count as a distribution. */
export const PROBABILITY_SUM_TOLERANCE = 0.5

/**
 * Horizons compare on normalised text.
 *
 * "12 Months", "12 months" and " 12  months " are one horizon; an unstated
 * one is its own value so that a stated and an unstated horizon never read as
 * equal. Returns null for "nothing was said", which is how an all-unstated
 * ladder still produces an expected value, labelled as having no horizon.
 */
function normalizeHorizon(raw: string | null): string | null {
  if (raw == null) return null
  const text = raw.trim().replace(/\s+/g, ' ').toLowerCase()
  return text === '' ? null : text
}

function impliedPctOf(price: number, spot: number | null): number | null {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null
  return ((price - spot) / spot) * 100
}

/**
 * Build the valuation. Pure: no clock, no network, no formatting.
 *
 * `spot` is optional because a price target is worth showing without a live
 * quote -- the implied moves simply go null rather than the block vanishing.
 */
export function buildValuation(
  /*
   * Nullish is accepted, not just an empty array.
   *
   * `rungs` is one field on a large hook result, and the stubs that render
   * this page in tests supply the fields they care about. A missing one threw
   * `Cannot read properties of undefined (reading 'filter')` and took the
   * whole Overview down -- a real crash shape, since any caller reading a
   * partial cache entry hits it too. An absent ladder is no ladder.
   */
  input: readonly ValuationInput[] | null | undefined,
  spot: number | null = null,
): Valuation {
  const scenarios: ValuationScenario[] = (input ?? [])
    .filter(r => r.price != null && Number.isFinite(r.price))
    .map(r => ({
      id: r.id,
      name: r.name,
      price: r.price as number,
      probability:
        r.probability != null && Number.isFinite(r.probability) ? r.probability : null,
      timeframe: r.timeframe,
      impliedPct: impliedPctOf(r.price as number, spot),
    }))
    /* Price order, not scenario name. The ladder reads as a distribution, and
       a name like "Uber Bull" has no place in a hand-written rank. */
    .sort((a, b) => a.price - b.price)

  const range =
    scenarios.length >= 2
      ? { low: scenarios[0].price, high: scenarios[scenarios.length - 1].price }
      : null

  const weighted = scenarios.filter(s => s.probability != null)
  const probabilitySum =
    weighted.length === scenarios.length && scenarios.length > 0
      ? weighted.reduce((sum, s) => sum + (s.probability as number), 0)
      : null

  const blocker = blockerFor(scenarios, probabilitySum)
  if (blocker) {
    return { scenarios, expected: null, blocker, probabilitySum, range }
  }

  const price = scenarios.reduce(
    (sum, s) => sum + s.price * ((s.probability as number) / 100),
    0,
  )
  /* The shared horizon, in the analyst's own words rather than normalised --
     the normalised form exists only to decide equality. */
  const horizon = scenarios.find(s => normalizeHorizon(s.timeframe) != null)?.timeframe ?? null

  return {
    scenarios,
    expected: { price, impliedPct: impliedPctOf(price, spot), horizon },
    blocker: null,
    probabilitySum,
    range,
  }
}

/**
 * The first unmet condition, checked most-fundamental first.
 *
 * Order is deliberate: telling a reader their horizons disagree is noise when
 * half the rungs have no weight at all.
 */
function blockerFor(
  scenarios: readonly ValuationScenario[],
  probabilitySum: number | null,
): ExpectedValueBlocker | null {
  if (scenarios.length < 2) return 'single_scenario'
  if (probabilitySum == null) return 'missing_probabilities'
  if (Math.abs(probabilitySum - 100) > PROBABILITY_SUM_TOLERANCE) {
    return 'probabilities_do_not_sum'
  }
  const horizons = new Set(scenarios.map(s => normalizeHorizon(s.timeframe)))
  if (horizons.size > 1) return 'mixed_horizons'
  return null
}

/**
 * The sentence a surface shows instead of an expected value.
 *
 * Kept here, beside the rule that produced it, so the wording cannot drift
 * from the condition. Each one states the fact and implies the remedy without
 * instructing the reader.
 */
export function blockerText(
  blocker: ExpectedValueBlocker,
  v: Pick<Valuation, 'probabilitySum' | 'scenarios'>,
): string {
  switch (blocker) {
    case 'single_scenario':
      return 'One scenario only, so there is no distribution to weight.'
    case 'missing_probabilities': {
      const missing = v.scenarios.filter(s => s.probability == null).length
      return missing === v.scenarios.length
        ? 'No scenario carries a probability.'
        : `${missing} of ${v.scenarios.length} scenarios carry no probability.`
    }
    case 'probabilities_do_not_sum': {
      const sum = v.probabilitySum
      const shown = sum == null ? 'unknown' : `${trimNumber(sum)}%`
      return `Probabilities total ${shown}, not 100%.`
    }
    case 'mixed_horizons':
      return 'Scenarios run to different horizons, so they are not one distribution.'
  }
}

/** 100 -> "100", 99.5 -> "99.5". No trailing zeros on a whole number. */
function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}
