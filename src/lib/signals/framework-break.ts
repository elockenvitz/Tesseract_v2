import {
  portfolioIssueKey,
  type CurrentBook,
  type PortfolioPositionContext,
} from '../holdings/portfolio-context'
import type { ScenarioState } from './scenario-state'

/**
 * A price outside the written framework, on capital somebody actually owns.
 *
 * ── What this adds, and what it deliberately does not ─────────────────────
 *
 * The classifier already exists and is not touched: `deriveScenarioState`
 * decides `below_all` / `above_all`, and `buildScenarioGapCard` owns every
 * validity gate — two usable cases, a tolerable quote age, the
 * implausible-multiple guard. All of that is upstream of this file and none of
 * it is re-implemented here, because a second framework classifier is exactly
 * how two surfaces come to disagree about what "outside the range" means.
 *
 * What is added is the OTHER half of the sentence. "AAPL is below every case
 * you modelled" is a fact about a ladder; "and 15.2% of Large Cap Core is
 * behind it" is what makes it a decision. Until now the card could not tell a
 * 15% position from a watchlist name — `held` was a regex over its own context
 * chips and `weightPct` was hard-null.
 *
 * ── Held is the whole boundary ────────────────────────────────────────────
 *
 * Unheld and outside the framework is a real finding and stays exactly as it
 * was: a research observation about a name somebody covers. It is not a
 * capital issue, because there is no capital. Nothing here reframes it, and
 * `frameworkCapitalFor` returns null rather than inventing an exposure.
 */

/** One book's stake in a name whose price has left the framework. */
export interface FrameworkCapital {
  portfolioId: string
  portfolioName: string | null
  /** Share of that book, or null where the book cannot support the claim. */
  weightPct: number | null
  weightIsMeaningful: boolean
  marketValue: number | null
  /** Positions in that book — why a weight may be missing. */
  positionCount: number
  /** The holdings snapshot the numbers came from. ISO. */
  asOf: string | null
  /** How many books hold it at all, for quiet context. */
  bookCount: number
  /** `portfolioId:assetId:framework_break`. */
  issueKey: string
}

/** The issue type this family dedupes under. */
export const FRAMEWORK_BREAK = 'framework_break'

/**
 * Every book that could legitimately carry this issue, most material first.
 *
 * Each candidate is a separate identity — `portfolioIssueKey` includes the
 * book — because a name at 15% of one book and 0.4% of another are two
 * situations. What varies is the CARD, not the truth: see `frameworkCapitalFor`
 * for why V1 renders one of them.
 */
export function frameworkBreakCandidates(
  book: CurrentBook | null | undefined,
  assetId: string,
): PortfolioPositionContext[] {
  const held = book?.byAsset.get(assetId) ?? []
  if (!held.length) return []
  return [...held].sort(compareMateriality)
}

/**
 * Which book a card should name when several hold the name.
 *
 * ── Why not just the first ────────────────────────────────────────────────
 *
 * "First" has meant three different arbitrary things in this codebase already:
 * whichever row PostgREST returned, whichever name sorted first alphabetically
 * — the active-risk defect Stage 1 corrected — and whichever snapshot was
 * newest. Each was stable enough not to look broken and wrong enough to
 * describe the wrong book.
 *
 * Measurable weight wins, largest first, because that is what the reader is
 * being asked about. Where no book can support a weight claim the tie is
 * broken on name and then id: not because either is meaningful, but because a
 * reproducible choice can be explained and a query-order one cannot.
 */
function compareMateriality(a: PortfolioPositionContext, b: PortfolioPositionContext): number {
  const aw = a.weightIsMeaningful && a.weightPct != null ? a.weightPct : null
  const bw = b.weightIsMeaningful && b.weightPct != null ? b.weightPct : null
  if (aw != null && bw != null && aw !== bw) return bw - aw
  if (aw != null && bw == null) return -1
  if (aw == null && bw != null) return 1
  // Neither is measurable. Market value is still a real number where both
  // halves of the position exist, and a bigger stake is a better subject.
  const av = a.marketValue ?? null
  const bv = b.marketValue ?? null
  if (av != null && bv != null && av !== bv) return bv - av
  if (av != null && bv == null) return -1
  if (av == null && bv != null) return 1
  return (a.portfolioName ?? '').localeCompare(b.portfolioName ?? '')
    || a.portfolioId.localeCompare(b.portfolioId)
}

/**
 * The capital behind a framework break, or null when there is none.
 *
 * Null means the name is not held, and the card stays the research observation
 * it already was. It never means "held, size unknown" — that is a real
 * `FrameworkCapital` whose `weightPct` is null, which is a different answer and
 * has to stay a different answer. Rendering the two the same is how "we cannot
 * tell" becomes "it is nothing".
 */
export function frameworkCapitalFor(
  book: CurrentBook | null | undefined,
  assetId: string,
): FrameworkCapital | null {
  const candidates = frameworkBreakCandidates(book, assetId)
  if (!candidates.length) return null
  const primary = candidates[0]
  return {
    portfolioId: primary.portfolioId,
    portfolioName: primary.portfolioName,
    weightPct: primary.weightPct,
    weightIsMeaningful: primary.weightIsMeaningful,
    marketValue: primary.marketValue,
    positionCount: primary.positionCount,
    asOf: primary.asOf,
    bookCount: candidates.length,
    issueKey: portfolioIssueKey(primary.portfolioId, assetId, FRAMEWORK_BREAK),
  }
}

/**
 * How much of which book, in the card's own words.
 *
 * ── The two honest forms ──────────────────────────────────────────────────
 *
 *   "15.2% of Large Cap Core"   the weight is measured and the book can carry it
 *   "Held in Large Cap Core"    the position is real and its share is not knowable
 *
 * There is no third form, and in particular there is no "0.0%" and no "—". A
 * two-name book makes every position look enormous, and a row with no price
 * has no share at all; both are reasons the number is absent, and neither is a
 * reason to print a zero. The break itself is unaffected — being held is what
 * makes it a capital issue, and the weight only decides how loudly.
 */
export function capitalLine(capital: FrameworkCapital): string {
  const book = capital.portfolioName ?? 'this book'
  return capital.weightIsMeaningful && capital.weightPct != null
    ? `${capital.weightPct.toFixed(1)}% of ${book}`
    : `Held in ${book}`
}

/**
 * The card's language when capital is behind the break.
 *
 * Leads with the capital tension rather than with the ladder. `scenarioLanguage`
 * still owns the unheld phrasing and the numbers; this replaces only the three
 * strings that change when the reader owns the thing.
 */
export function frameworkBreakCopy(
  state: ScenarioState,
  symbol: string,
  capital: FrameworkCapital,
): { headline: string; metricLabel: string; summary: string } | null {
  if (state.position !== 'below_all' && state.position !== 'above_all') return null

  const below = state.position === 'below_all'
  const boundary = below ? state.lowest : state.highest
  const line = capitalLine(capital)

  return {
    /**
     * The boundary by name where the ladder gives one unambiguously.
     *
     * `CaseGroup.label` is "Bear" on an ordinary ladder and "Bear / Base" where
     * two cases share a price — which is the tie the grouping exists to stop
     * the card resolving arbitrarily. Either reads correctly here, and neither
     * invents a case the analyst did not write.
     */
    headline: below
      ? `${symbol} has fallen below your ${boundary.label.toLowerCase()} case`
      : `${symbol} has passed every case you wrote`,
    // The book carries the metric's label, because the metric is the distance
    // and the thing that makes the distance matter is whose money is in it.
    metricLabel: line,
    /**
     * What the reader has to decide, plus the capital at stake — and neither
     * number repeated from above.
     *
     * The metric already states the distance and its label already states the
     * book, so this says the consequence. Short, because `SignalCardView`
     * reserves exactly two lines and paints "more" over the end of the second.
     */
    summary: below
      ? 'Either the thesis has broken or this is the best entry you modelled.'
      : 'No stated upside is left on capital you are still holding.',
  }
}

/**
 * How Curate names this family, without inventing a `SignalType`.
 *
 * ── Why a pseudo-key ──────────────────────────────────────────────────────
 *
 * A held framework break and an unheld one are the same `SignalType`. Adding a
 * second would mean a new tier to place, a new judgment scope, a new registry
 * entry and a second derivation — all to express a distinction the same card
 * already makes in its own words and now records in `SignalCard.capital`.
 *
 * `research:<framing>` reached this conclusion first and this is deliberate
 * parity with it: the filter speaks `portfolio:<issue>`, resolves it against
 * the card's own capital stamp, and nothing downstream of the filter ever sees
 * the key. The `SignalType` union is untouched.
 */
export const PORTFOLIO_FILTER_PREFIX = 'portfolio:'

export function portfolioFilterKey(issueType: string): string {
  return `${PORTFOLIO_FILTER_PREFIX}${issueType}`
}

/** The capital issue a filter key names, or null when it is not one of ours. */
export function portfolioIssueFromFilterKey(key: string): string | null {
  if (!key.startsWith(PORTFOLIO_FILTER_PREFIX)) return null
  return key.slice(PORTFOLIO_FILTER_PREFIX.length) || null
}

/**
 * The Portfolio rows Curate offers.
 *
 * One today. The next family — a material position with nothing written about
 * it — sits beside it by appending one entry here and stamping its own
 * `issueType`; no taxonomy is rewritten to make room. Deliberately not
 * pre-listed: Curate does not show rows for signals that cannot be produced,
 * and an option that never matches anything teaches a reader to distrust the
 * whole sheet.
 */
export const PORTFOLIO_FILTER_OPTIONS: { key: string; label: string }[] = [
  { key: portfolioFilterKey(FRAMEWORK_BREAK), label: 'Framework break' },
]
