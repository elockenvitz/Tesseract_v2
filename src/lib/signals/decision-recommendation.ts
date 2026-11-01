import type { RecommendationInput } from './builders/recommendation'
import type { DecisionRecord } from '../desktop-decisions/model'
import { workOf } from '../desktop-decisions/model'

/**
 * A decision waiting on somebody, as the recommendation card's input.
 *
 * ── Why this adapter exists at all ────────────────────────────────────────
 *
 * The card already existed and so did a producer for it, and the producer was
 * reading the wrong table. `useRecommendationCards` filters
 * `trade_queue_items.status` on `pending` / `proposed` / `awaiting_review`.
 * Measured against production, none of those three values occurs in that
 * column in any organisation: the workflow writes `idea`, `deciding`,
 * `discussing`, `approved`, `executed`, `deleted`, `simulating`, `archived`,
 * `cancelled` and `rejected`. So that producer has returned an empty array for
 * every reader, on the phone too, since it was written.
 *
 * `pending` is a `decision_requests` status. That table is where the product
 * actually records a request awaiting an answer -- 30 rows across the estate,
 * 14 in the reviewing organisation -- and `useDecisionScan` already reads it
 * into `DecisionRecord`. This maps that record onto the card's input, so the
 * card gets its rows from the table that has them and nothing about the card
 * itself changes.
 *
 * Pure, and deliberately outside React: what a decision IS, is a question the
 * decisions model answers, and nothing here re-decides it. `workOf` is the
 * same predicate the Decisions lens uses to put a row in "Needs action", so a
 * request cannot be waiting on one surface and settled on the other.
 */

/**
 * Identity is the REQUEST, not the idea.
 *
 * One idea reaching two books produces two decision requests, and they are
 * answered separately -- a trim approved in one fund and withdrawn in another
 * is two pieces of history. Keying the card on `ideaId` would collapse them
 * into one card whose approval means nothing in particular, which is the
 * mistake `subjectOf` documents at length for the same reason.
 */
export function recommendationInputFrom(d: DecisionRecord): RecommendationInput | null {
  // Nobody has answered it. Everything else is history, and history belongs in
  // the Decisions record rather than in an attention feed.
  if (workOf(d) !== 'decide') return null

  // The card is about a name. A request whose idea no longer resolves to an
  // asset has nothing to put in `entity`, and the builder would suppress it a
  // step later on an empty symbol anyway.
  if (!d.assetId || !d.symbol) return null

  const requestedAt = d.requestedAt
  if (!requestedAt) return null

  return {
    id: d.id,
    assetId: d.assetId,
    symbol: d.symbol,
    companyName: d.companyName,
    action: d.action,
    /**
     * `sizing_weight` is a TARGET weight, and this is the one mapping worth
     * arguing about.
     *
     * The submission writes `sizing_mode: 'weight'` beside it and the one row
     * that also captured a current weight settles the intent: AAPL, buy,
     * `sizing_weight` 30 against a book weight of 25.3. That is a target, not
     * a delta.
     *
     * Some rows nonetheless hold a delta, because a person typed one: `sell`
     * with -1 against a book holding none of the name. Those are bad data and
     * they are NOT corrected here -- `buildRecommendationCard` already refuses
     * a weight outside 0-100, and refuses a `buy` proposing less than the
     * current weight. Guessing which figure a negative was meant to be is the
     * weight-inflation defect class exactly: a number nobody stated, rendered
     * at the loudest size on the card. Suppression is the honest outcome.
     */
    proposedWeightPct: d.sizingWeight,
    /**
     * The book's weight at submission, where the snapshot captured it.
     *
     * `DecisionRecord.baselineWeight` is read, rather than this adapter
     * reaching back into `submission_snapshot` for a second opinion. Null is
     * common and is handled: the builder treats null as "we could not look it
     * up" and leads with the proposal alone, marked `stated`, instead of
     * computing a delta against a number nobody recorded.
     *
     * It is null for every pending row in the reviewing organisation, because
     * the snapshot key is fragmented across writers. See the finding; it is
     * not fixed here, and the card degrades honestly rather than inventing a
     * baseline.
     */
    currentWeightPct: d.baselineWeight,
    /**
     * The baseline was the book AS AT submission, so the request's own date is
     * its real vintage. Not today's: stamping a decision-time weight with the
     * current date would claim a freshness the number does not have, which is
     * the mistake the builder's own metric comment warns about.
     */
    currentWeightAsOf: d.baselineWeight != null ? requestedAt : null,
    /**
     * The requester's rationale, never the decision note.
     *
     * `contextNote` is why this was PROPOSED, which is what a reader needs in
     * order to answer it. `decisionNote` is why it was decided and does not
     * exist yet on a pending row -- and where it does exist it is usually a
     * provenance string the system wrote about its own plumbing.
     *
     * Rows with no rationale are suppressed by the builder on content quality,
     * which is correct: a recommendation with no readable reason cannot be
     * approved on its merits. Four of the fourteen pending rows go that way.
     */
    rationale: d.contextNote,
    recommendedBy: d.requestedByName,
    portfolioId: d.portfolioId,
    portfolioName: d.portfolioName ?? 'Portfolio',
    createdAt: requestedAt,
  }
}
