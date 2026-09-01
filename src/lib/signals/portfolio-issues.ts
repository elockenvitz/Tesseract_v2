import {
  portfolioIssueKey,
  type CurrentBook,
  type PortfolioPositionContext,
} from '../holdings/portfolio-context'

/**
 * The Portfolio family: capital that is out of line with what was written.
 *
 * ── Why the taxonomy lives here and not beside one issue ──────────────────
 *
 * The prefix, the key functions and the filter rows were introduced in
 * `framework-break.ts`, which was right while there was one issue and wrong the
 * moment there were two: a module named for one member cannot own the register
 * of all of them. Moved rather than duplicated, and `framework-break` now reads
 * from here like everything else.
 *
 * ── What a Portfolio issue is ─────────────────────────────────────────────
 *
 * A statement about a (book, asset) pair rather than about a name. Research
 * asks whether the written view is any good; Portfolio asks whether the money
 * matches it. The same underlying fact can be both — a name with no thesis is a
 * documentation gap AND, once real capital is behind it, an allocation nobody
 * has justified — and which one the reader is shown depends on whether the desk
 * actually owns it.
 *
 * No issue here adds a `SignalType`. Each is a stamp on a card the product
 * already builds, resolved by `categoryOf` ahead of the registry. See
 * `SignalCard.capital`.
 */

/** A price outside the written scenario range, on a position the desk holds. */
export const FRAMEWORK_BREAK = 'framework_break'

/** Meaningful capital with no written investment view behind it. */
export const MATERIAL_NO_THESIS = 'material_no_thesis'

/**
 * How Curate names this family, without inventing a `SignalType`.
 *
 * The filter speaks `portfolio:<issue>`, resolves it against the card's own
 * capital stamp, and nothing downstream of the filter ever sees the key. Same
 * mechanism as `research:<framing>`, and for the same reason: a second type per
 * distinction would mean a new tier to place, a new judgment scope and a new
 * registry entry, all to express something the card already says in words.
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
 * Only issues that can actually be produced. An option that never matches
 * anything teaches a reader to distrust the whole sheet, so nothing is listed
 * here until its derivation exists.
 *
 * "Unwritten position" rather than "Material position without a thesis": the
 * row sits in a single-line list beside "Framework break", and the long form
 * wraps at 390px. It also puts the finding first — what is missing — where the
 * long form leads with an adjective.
 */
export const PORTFOLIO_FILTER_OPTIONS: { key: string; label: string }[] = [
  { key: portfolioFilterKey(FRAMEWORK_BREAK), label: 'Framework break' },
  { key: portfolioFilterKey(MATERIAL_NO_THESIS), label: 'Unwritten position' },
]

/** One book's stake in a name that carries a capital issue. */
export interface CapitalContext {
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
  /** `portfolioId:assetId:issueType`. */
  issueKey: string
  /**
   * Which issue this is.
   *
   * On the context and not only on the card, because the feed classifies
   * ENTRIES and an insight entry has no card until render time. Carrying it
   * here is what lets one value answer both — see `unwrittenPositionCapital`.
   */
  issueType: string
}

/**
 * Where "nobody has written this up yet" stops being a reasonable answer.
 *
 * ── Not a new number ──────────────────────────────────────────────────────
 *
 * 2%, taken from `UNTARGETED_MIN_PCT`, which is the product's existing rule for
 * the same shape of claim: a sized position missing a piece of decision
 * structure. Its reasoning transfers exactly — "starter positions and residual
 * tails routinely carry no target and flagging them would produce a card per
 * name on a long book, which is the filler problem the feed has already been
 * through once. At 2% of a portfolio the absence is a decision nobody made."
 *
 * A missing thesis is a stronger absence than a missing target, so a threshold
 * that is defensible for the weaker one is defensible here. Raising it would be
 * inventing a finance rule inside an implementation; lowering it would put the
 * feed back into filler.
 *
 * `MIN_WEIGHT_PCT` (0.5) is deliberately NOT used. It is the floor below which
 * a position is too small to discuss at all, not the point at which its silence
 * becomes a decision.
 */
export const MATERIAL_POSITION_MIN_PCT = 2

/**
 * The books where a position is big enough for its silence to be a decision.
 *
 * Empty for a name nobody owns, for a book whose weight cannot be measured, and
 * for a stake below the bar. All three are absences rather than zeroes: a
 * position whose share is unknowable is NOT known to be immaterial, and
 * treating it as material would be a claim the data does not support.
 *
 * That is the one asymmetry with `frameworkBreakCandidates`, and it is
 * deliberate. A framework break is real whatever the size — the price has left
 * the range either way — so being held is enough. This issue IS the size, so an
 * unmeasurable weight cannot establish it.
 */
export function materialPositionCandidates(
  book: CurrentBook | null | undefined,
  assetId: string,
): PortfolioPositionContext[] {
  const held = book?.byAsset.get(assetId) ?? []
  return held
    .filter(p =>
      p.weightIsMeaningful
      && p.weightPct != null
      && p.weightPct >= MATERIAL_POSITION_MIN_PCT
      // Cash has no thesis and never will. It sits in 29 of this org's
      // portfolios, so without this the largest single category of card would
      // be "cash is a real position with nothing written about it" — true,
      // unanswerable, and repeated 29 times.
      && !p.isCash)
    .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
}

/**
 * The capital behind an unwritten position, or null when there is none.
 *
 * Null means no book holds enough of it for the absence to be a decision — the
 * card stays the Research observation it already was, which is the correct home
 * for a watchlist name or a starter position with nothing written.
 *
 * Where several books qualify the heaviest names the card, and `bookCount`
 * carries the rest. Never a sum: a name at 8% of one book and 3% of another is
 * not an 11% position in anything.
 */
export function materialCapitalFor(
  book: CurrentBook | null | undefined,
  assetId: string,
): CapitalContext | null {
  const candidates = materialPositionCandidates(book, assetId)
  if (!candidates.length) return null
  return capitalFrom(candidates, assetId, MATERIAL_NO_THESIS)
}

/** Shared shape-building, so two issues cannot disagree about the fields. */
export function capitalFrom(
  candidates: readonly PortfolioPositionContext[],
  assetId: string,
  issueType: string,
): CapitalContext {
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
    issueKey: portfolioIssueKey(primary.portfolioId, assetId, issueType),
    issueType,
  }
}

/**
 * How much of which book, in the card's own words.
 *
 *   "15.2% of Large Cap Core"   the weight is measured and the book can carry it
 *   "Held in Large Cap Core"    the position is real and its share is not knowable
 *
 * No third form, and in particular no "0.0%" and no em dash. `material_no_thesis`
 * can only ever take the first — an unmeasurable weight never reaches it — but
 * the function is shared, and a formatter that silently could not express the
 * second would be a trap for the next issue.
 */
export function capitalLine(capital: CapitalContext): string {
  const book = capital.portfolioName ?? 'this book'
  return capital.weightIsMeaningful && capital.weightPct != null
    ? `${capital.weightPct.toFixed(1)}% of ${book}`
    : `Held in ${book}`
}

/**
 * The card's language when meaningful capital has no written view behind it.
 *
 * ── Capital first, and not compliance ─────────────────────────────────────
 *
 * The Research version of this card says "AAPL has no investment thesis",
 * which is a statement about a document. The finding here is that money is
 * already committed: the position exists, it is a real share of a real book,
 * and nothing on file argues for it. The reader is not being asked to tidy a
 * record, they are being told an allocation is running without a stated reason.
 */
export function materialNoThesisCopy(
  symbol: string,
  capital: CapitalContext,
): { headline: string; metricValue: string; metricLabel: string; summary: string } {
  return {
    headline: `${symbol} is a position without a written view`,
    /**
     * The hero number is the capital, and that is the whole reframe.
     *
     * `insightMetric` returns null for `no_case` on purpose — "0 of 3" at the
     * loudest size reads as a score, and it argued that the position size would
     * be worse still because it would make the card look like it is about the
     * size. That is right for a Research card and inverted here: this card IS
     * about the size. The absence is what the headline says; the number says
     * how much is riding on it.
     */
    metricValue: capital.weightPct != null ? `${capital.weightPct.toFixed(1)}%` : '—',
    metricLabel: `of ${capital.portfolioName ?? 'the book'}`,
    // Short: `SignalCardView` reserves exactly two lines and paints "more" over
    // the end of the second.
    summary: 'Nothing on file states the view this capital is backing.',
  }
}

/**
 * The unwritten-position capital for an insight, or null.
 *
 * ── Why this exists rather than two call sites applying two gates ─────────
 *
 * The issue needs BOTH halves: the framing must be `no_case` and the stake
 * must be material. The builder knew the first and the feed knew the second,
 * so each applied its own — and the feed's category filter, which runs before
 * any card is built, could not apply either. A held, material, unwritten
 * position was therefore stamped correctly on the card and still classified as
 * Research, because the object the filter sees is the ENTRY, and an insight
 * entry has no card.
 *
 * One function, called by both, so the entry's answer and the card's answer
 * are the same answer.
 *
 * `incomplete_case` is deliberately excluded: a partial view is still a view.
 */
export function unwrittenPositionCapital(
  book: CurrentBook | null | undefined,
  assetId: string | null | undefined,
  framing: string | null | undefined,
): CapitalContext | null {
  if (framing !== 'no_case' || !assetId) return null
  return materialCapitalFor(book, assetId)
}
