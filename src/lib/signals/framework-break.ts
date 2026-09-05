import type { CurrentBook, PortfolioPositionContext } from '../holdings/portfolio-context'
import { capitalFrom, capitalLine, FRAMEWORK_BREAK, type CapitalContext } from './portfolio-issues'
import type { ScenarioState } from './scenario-state'

/**
 * The shared Portfolio taxonomy moved to `portfolio-issues` when a second
 * issue arrived: a module named for one member cannot own the register of all
 * of them. Re-exported here so existing callers are unchanged.
 */
export {
  capitalLine, FRAMEWORK_BREAK, MATERIAL_NO_THESIS, PORTFOLIO_FILTER_OPTIONS,
  PORTFOLIO_FILTER_PREFIX, portfolioFilterKey, portfolioIssueFromFilterKey,
} from './portfolio-issues'
export type { CapitalContext } from './portfolio-issues'

/** The shape this family passes to the builder. See `CapitalContext`. */
export type FrameworkCapital = CapitalContext

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
  return capitalFrom(candidates, assetId, FRAMEWORK_BREAK)
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
