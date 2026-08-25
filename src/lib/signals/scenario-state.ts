/**
 * Where the price sits relative to a scenario ladder, derived once.
 *
 * ── Why this is a module and not a chain of conditions in JSX ──────────────
 *
 * The same three questions — which case is nearest, is anything on the other
 * side of the price, are these weights a distribution — were answered
 * independently by the builder, the ladder, the case list and the distribution
 * pane. They disagreed in ways that showed: the card said "below your base
 * case" on a ladder whose bear case was at the same price and equally breached,
 * and it called an unweighted mean an expected value while the pane beside it
 * refused to compute one.
 *
 * One derivation, four readers.
 */

export interface StateCase {
  id?: string
  name: string
  price: number
  /** Percent, 0-100. Null where the analyst did not assign one. */
  probability?: number | null
  timeframe?: string | null
}

/**
 * Where the price is, said in terms of the ladder rather than of one case.
 *
 * `below_all` and `above_all` are the states worth a card: the price has left
 * the range the analyst modelled entirely. `below_middle` and `above_middle`
 * are inside it — true, ordinary, and deliberately NOT emitted as cards today,
 * because the price being somewhere between bear and bull is the normal state
 * of every position. They exist here so the copy is correct if a caller ever
 * has one to render.
 */
export type ScenarioPosition = 'below_all' | 'below_middle' | 'above_middle' | 'above_all'

/**
 * Cases that share a price, kept together.
 *
 * A ladder with Bear and Base both at $800 has two cases and one price. Drawing
 * two dots at one coordinate hides one of them under the other, and saying
 * "below your base case" picks a winner arbitrarily — the sort is stable, so
 * which name appeared was an accident of insertion order.
 */
export interface CaseGroup {
  price: number
  cases: StateCase[]
  /** "Bear" or "Bear / Base". */
  label: string
  /**
   * Stable identity for this coordinate, independent of render order.
   *
   * Selection used to be an index, and two components indexed different things
   * — the dots mapped over CASES and the legend over GROUPS, both comparing
   * against one `picked` number. Selecting Bull (group 1) highlighted the case
   * at index 1, which is Base at $800: the wrong dot, on the ladder the
   * grouping exists to make unambiguous.
   *
   * Derived from the member case ids where they exist, so it survives a
   * re-sort, a refetch and a reorder of the raw array. Falls back to the price
   * for cases that have no id yet — a ladder rendered from an unsaved draft.
   */
  key: string
}

export interface ScenarioState {
  /** Ascending by price. */
  sorted: StateCase[]
  /** Ascending by price, cases at the same price merged. */
  groups: CaseGroup[]
  lowest: CaseGroup
  highest: CaseGroup
  position: ScenarioPosition
  /** True when every case sits on one side of the price. */
  oneSided: boolean
  /**
   * Probability-weighted expectation, or null.
   *
   * Null unless every case carries a probability AND they sum to 100 (±1) AND
   * the ladder shares one horizon. See `expectedBlockedBy` for which failed.
   */
  expectedValue: number | null
  /**
   * The plain mean of the case prices. Always computable, and NEVER an expected
   * value: an unweighted average of outcomes the analyst has not said are
   * equally likely is a description of the ladder's midpoint, not of what they
   * expect. Labelled "Case average" everywhere it appears.
   */
  caseAverage: number
  /** True only when `expectedValue` is a real probability-weighted number. */
  hasUsableProbabilities: boolean
  /** Why there is no expectation, when there could have been one. */
  expectedBlockedBy: string | null
}

/** Two prices this close are the same point on a ladder. */
const SAME_PRICE_EPSILON = 0.005

const pctFrom = (price: number, target: number) => (target - price) / price

/** Signed percentage move from the current price to a target. */
export function moveFrom(price: number, target: number): number {
  return pctFrom(price, target) * 100
}

/**
 * "Upside" or "downside", decided by the geometry rather than by the case name.
 *
 * A bear case ABOVE the current price is not downside. On GOOGL the price is
 * $350 against cases at $800 and $1,605, so every modelled outcome is a gain
 * and labelling the nearest one "Downside −128%" was both the wrong word and
 * the wrong sign.
 */
export function moveLabel(price: number, target: number): 'Upside' | 'Downside' {
  return target >= price ? 'Upside' : 'Downside'
}

/**
 * Bear before Base before Bull, whatever order the rows arrived in.
 *
 * A group at one price is labelled from its members, and "Base / Bear" reads as
 * a different thing from "Bear / Base" — the ladder has a direction and the
 * label should follow it. Names outside the convention keep their relative
 * order after the ones inside it, because an analyst's "Uber Bull" is theirs to
 * name and guessing where it belongs would be worse than leaving it put.
 */
const RANK: Record<string, number> = { bear: 0, base: 1, bull: 2 }
const rankOf = (name: string) => RANK[name.trim().toLowerCase()] ?? 99

function labelFor(cases: StateCase[]): string {
  return [...cases]
    .sort((a, b) => rankOf(a.name) - rankOf(b.name))
    .map(c => c.name)
    .join(' / ')
}

/** See `CaseGroup.key`. */
function keyFor(cases: StateCase[], price: number): string {
  const ids = cases.map(c => c.id).filter(Boolean) as string[]
  return ids.length === cases.length
    ? ids.slice().sort().join('+')
    : `price:${price.toFixed(4)}`
}

export function groupCases(sorted: StateCase[]): CaseGroup[] {
  const groups: CaseGroup[] = []
  for (const c of sorted) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(last.price - c.price) <= SAME_PRICE_EPSILON) {
      last.cases.push(c)
      last.label = labelFor(last.cases)
      last.key = keyFor(last.cases, last.price)
      continue
    }
    groups.push({ price: c.price, cases: [c], label: c.name, key: keyFor([c], c.price) })
  }
  return groups
}

export function deriveScenarioState(price: number, cases: StateCase[]): ScenarioState | null {
  const sorted = [...cases]
    .filter(c => Number.isFinite(c.price) && c.price > 0 && !!c.name?.trim())
    .sort((a, b) => a.price - b.price)
  if (sorted.length < 2) return null

  const groups = groupCases(sorted)
  const lowest = groups[0]
  const highest = groups[groups.length - 1]

  const position: ScenarioPosition =
    price < lowest.price ? 'below_all'
    : price > highest.price ? 'above_all'
    // Inside the range: which half, measured against the midpoint of the ends
    // rather than against a case called "Base", because not every ladder has
    // one and the name is the analyst's to choose.
    : price < (lowest.price + highest.price) / 2 ? 'below_middle'
    : 'above_middle'

  const oneSided = position === 'below_all' || position === 'above_all'

  /**
   * The weights, and whether they are a distribution.
   *
   * Kept identical to the builder's original rule rather than re-derived: a
   * set summing to 125 across six cases is the analyst's own numbers being
   * inconsistent, and normalising it would make the fair-value claim
   * unfalsifiable — no number they could enter would ever make the card
   * disagree with them.
   */
  const allWeighted = sorted.every(c =>
    typeof c.probability === 'number' && Number.isFinite(c.probability) && c.probability >= 0)
  const weightSum = allWeighted ? sorted.reduce((n, c) => n + (c.probability ?? 0), 0) : 0
  const weightsAreDistribution = allWeighted && Math.abs(weightSum - 100) <= 1

  const horizons = new Set(sorted.map(c => (c.timeframe ?? '').trim()).filter(Boolean))
  const singleHorizon = horizons.size <= 1

  const expectedValue = weightsAreDistribution && singleHorizon && weightSum > 0
    ? sorted.reduce((n, c) => n + c.price * (c.probability ?? 0), 0) / weightSum
    : null

  const expectedBlockedBy: string | null =
    !allWeighted ? null
    : !weightsAreDistribution ? `Probabilities sum to ${weightSum.toFixed(0)}%`
    : !singleHorizon ? `Mixed horizons: ${[...horizons].join(', ')}`
    : null

  return {
    sorted,
    groups,
    lowest,
    highest,
    position,
    oneSided,
    expectedValue,
    caseAverage: sorted.reduce((n, c) => n + c.price, 0) / sorted.length,
    hasUsableProbabilities: expectedValue != null,
    expectedBlockedBy,
  }
}

/**
 * The headline, the hero figure and the one-line summary, for a given state.
 *
 * Adaptive rather than templated per example: what makes the strongest claim is
 * a function of where the price sits, and the previous copy always named a
 * single case even when every case was breached.
 */
export function scenarioLanguage(price: number, s: ScenarioState, symbol: string): {
  headline: string
  metricValue: string
  metricLabel: string
  summary: string
  direction: 'good' | 'bad' | 'neutral'
} {
  const money = (v: number) => `$${v.toFixed(0)}`

  if (s.position === 'below_all') {
    const gap = Math.abs(pctFrom(s.lowest.price, price)) * 100
    return {
      // Every case, not the lowest one by name. Naming a single case
      // understates a ladder that has been breached end to end — and on a
      // ladder with a tie it named whichever case happened to sort first.
      headline: `${symbol} is trading below every case you modelled`,
      metricValue: `${gap.toFixed(0)}%`,
      metricLabel: `Below your lowest case of ${money(s.lowest.price)}`,
      summary: 'The market is pricing an outcome below every recorded scenario.',
      direction: 'bad',
    }
  }

  if (s.position === 'above_all') {
    const gap = pctFrom(s.highest.price, price) * 100
    return {
      headline: `${symbol} is trading above every case you modelled`,
      metricValue: `+${gap.toFixed(0)}%`,
      metricLabel: `Above your highest case of ${money(s.highest.price)}`,
      summary: 'The market is pricing an outcome above every recorded scenario.',
      direction: 'good',
    }
  }

  /**
   * Inside the range. Named against the nearest case on each side rather than
   * against one called "Base" — the ladder does not promise that name exists.
   *
   * These states do not emit cards today; the copy is here so that a caller
   * rendering one is not left with below-all language on a ladder that is
   * intact.
   */
  const below = s.groups.filter(g => g.price > price)[0]
  const above = [...s.groups].reverse().filter(g => g.price <= price)[0]
  const nearestAbove = below ?? s.highest
  const nearestBelow = above ?? s.lowest
  return {
    headline: `${symbol} is trading between your ${nearestBelow.label} and ${nearestAbove.label} cases`,
    metricValue: `${moveFrom(price, nearestAbove.price) >= 0 ? '+' : ''}${moveFrom(price, nearestAbove.price).toFixed(0)}%`,
    metricLabel: `To your ${nearestAbove.label} case of ${money(nearestAbove.price)}`,
    summary: 'The price is inside the range you modelled.',
    direction: 'neutral',
  }
}
