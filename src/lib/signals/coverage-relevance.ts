/**
 * Coverage as a relevance signal — one definition, both shells.
 *
 * CoverageQuickStart's confirmation promises "Tesseract will use this to decide
 * what to put in front of you". This module is what makes that true, and it is
 * deliberately the ONLY place that decides what "relevant to this reader" means.
 *
 * Mobile and desktop currently run two different ranking algorithms (see
 * docs/tickets/ideas-ranking-divergence.md). They now consume the same coverage
 * definition through this module, so the two brains at least agree on the
 * facts even while they disagree on the arithmetic. Adding a second notion of
 * "covered" — one per shell — is the thing this file exists to prevent.
 *
 * ── What "relevant" means here, and what it does not ──────────────────────
 *
 * Relevance is about THIS reader's responsibility for a name, not about the
 * firm's book:
 *
 *   direct   — the reader declared personal coverage of the asset
 *   assigned — the organization assigned the asset to this reader
 *   held     — the asset is in a portfolio the reader can see, and they
 *              neither declared nor were assigned it
 *   none     — none of the above, for a reader who HAS coverage
 *   unknown  — we decline to answer; see the refusals below
 *
 * `direct` and `assigned` are kept apart even though they currently score the
 * same. They are different facts — one is a claim the reader made, the other is
 * a claim the organization made about them — and collapsing them now would make
 * "why is this here?" unanswerable later.
 *
 * `held` is deliberately NOT coverage. A position is a fact about a portfolio;
 * coverage is a claim about attention. An analyst covers names the firm does
 * not hold (that is most of the job) and the book holds names nobody is
 * actively working. Holdings stay a separate, weaker signal.
 *
 * ── The three refusals ────────────────────────────────────────────────────
 *
 * `unknown` is not a failure mode, it is a decision, and it is what stops this
 * feature from degrading everybody's feed:
 *
 *   1. A reader with NO coverage at all gets `unknown` for everything. Their
 *      feed is exactly what it was before this shipped. Coverage that nobody
 *      has declared must not silently penalise every card in the product.
 *
 *   2. An entity that is not an asset — a macro release, a workflow item, a
 *      market card whose "id" is a ticker string — gets `unknown`. "Not in your
 *      coverage" is not a fact about those; it is a sign the question was
 *      wrong.
 *
 *   3. Coverage that failed to load gets `unknown`, never `none`. Burying real
 *      findings because a query did not return is the worst possible failure
 *      mode, and it is the one the original `PriorityInput.owned` comment
 *      warned about when it said unknown ownership must never be a penalty.
 */

import type { SignalCard } from './contract'

/** Asset ids are UUIDs; a market card's "entity id" is a ticker string. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CoverageRelevance = 'direct' | 'assigned' | 'held' | 'none' | 'unknown'

/**
 * The reader's coverage, resolved once per session and shared by both shells.
 *
 * `ready` is the difference between "this reader covers nothing" and "we have
 * not found out yet", which refusal 3 depends on. Without it a cold load looks
 * identical to an empty coverage set and every card takes a penalty for a
 * pending query.
 */
export interface CoverageIndex {
  ready: boolean
  direct: ReadonlySet<string>
  assigned: ReadonlySet<string>
  held: ReadonlySet<string>
}

export const EMPTY_COVERAGE_INDEX: CoverageIndex = {
  ready: false,
  direct: new Set(),
  assigned: new Set(),
  held: new Set(),
}

/** True when the reader has told us — or been told — anything at all. */
export function hasAnyCoverage(index: CoverageIndex): boolean {
  return index.direct.size > 0 || index.assigned.size > 0
}

/**
 * What this asset is to this reader.
 *
 * Order matters: a name the reader declared AND was assigned reads as `direct`,
 * because their own claim is the more specific fact about their attention.
 */
export function coverageRelevanceFor(
  index: CoverageIndex,
  assetId: string | null | undefined,
): CoverageRelevance {
  // Refusal 2 — not an asset we can answer about.
  if (!assetId || !UUID.test(assetId)) return 'unknown'
  // Refusal 3 — coverage has not resolved.
  if (!index.ready) return 'unknown'

  if (index.direct.has(assetId)) return 'direct'
  if (index.assigned.has(assetId)) return 'assigned'
  if (index.held.has(assetId)) return 'held'

  // Refusal 1 — a reader who covers nothing gets no opinion, rather than a
  // uniform penalty that would reorder nothing and only compress the scale.
  if (!hasAnyCoverage(index)) return 'unknown'

  return 'none'
}

/**
 * The ownership multiplier the priority model applies, in [0, 1].
 *
 * These are not new magnitudes. `priorityFor` already scored
 * `owned === false` at 0 and everything else at 1, so the full span was always
 * `WEIGHTS.ownership` — 0.06. This grades that existing span rather than
 * widening it, which is why no weight had to be retuned and why a feed with no
 * coverage is bit-for-bit unchanged.
 *
 *   direct / assigned  1.00  the reader is responsible for this name
 *   held               0.60  in the book, nobody has claimed it
 *   none               0.00  the reader has coverage and this is not in it
 *   unknown            1.00  neutral; never a penalty
 *
 * 0.06 is small on purpose and the tier sort makes it structural rather than
 * tuned: `compareRanked` orders by tier BEFORE score, so coverage can only
 * reorder cards that already share a tier. A covered `research_stale` can pass
 * an uncovered `catalyst_ahead`; it can never pass a `scenario_gap`, because a
 * price that has left its framework is in a tier of its own. That is what
 * "a genuinely urgent non-covered signal still outranks a weak covered one"
 * means here — a guarantee of the ordering, not a hope about the weights.
 */
export function coverageWeightFor(relevance: CoverageRelevance): number {
  switch (relevance) {
    case 'direct':
    case 'assigned':
      return 1
    case 'held':
      return 0.6
    case 'none':
      return 0
    case 'unknown':
      return 1
  }
}

/**
 * Asset relevance for the DESKTOP scorer, which uses its own 0-1 scale.
 *
 * Desktop's `scoreFeedItem` scored `heldAssetIds.has(assetId) ? 0.9 : 0.3`.
 * Those two numbers are preserved exactly for `held` and `none`, so a reader
 * with no coverage sees no change at all; coverage adds a band above holdings
 * rather than rescaling what was there.
 */
export function desktopAssetRelevanceFor(relevance: CoverageRelevance): number {
  switch (relevance) {
    case 'direct':
    case 'assigned':
      return 1
    case 'held':
      return 0.9
    case 'none':
    case 'unknown':
      return 0.3
  }
}

/**
 * The additive lift a covered name gets, on both shells' scales.
 *
 * ── Why a separate term and not a bigger multiplier ──────────────────────
 *
 * Real staging measurement, not theory. With coverage folded only into the
 * existing bands, declaring two names moved the desktop Ideas feed by zero
 * positions: `assetRelevance` spans 0.2, a held name already scored 0.9 and a
 * covered one 1.0, so coverage was worth 0.02 of score against a freshness term
 * weighted 0.25 — an eight-hour age difference outweighed it. The seam was
 * populated and the promise on the confirmation screen was still false.
 *
 * Widening the existing bands instead would have changed the feed of every
 * reader who has declared NOTHING, because `held` and `none` are what they
 * score on. This term is exactly zero for `held`, `none` and `unknown`, so
 * their feed stays bit-for-bit what it was; only a reader who has actually told
 * us something sees anything move. That is the property worth protecting.
 *
 * The magnitudes are per-scale and deliberately bounded — see the constants at
 * each call site. Neither can cross a tier on mobile, because `compareRanked`
 * sorts by tier before score: a covered `research_stale` still cannot outrank a
 * `scenario_gap`. Coverage reorders comparable things; it does not overrule
 * urgency.
 */
export function coverageBonusFor(relevance: CoverageRelevance): number {
  return relevance === 'direct' || relevance === 'assigned' ? 1 : 0
}

export interface CoverageExplanation {
  relevance: CoverageRelevance
  /** Short clause for the card, or null when there is nothing worth saying. */
  label: string | null
}

/**
 * Why this card is in front of the reader, when that is worth saying.
 *
 * Only `direct` and `assigned` produce a label. Labelling `held` would put a
 * badge on most of the feed for anybody with a book, and labelling `none` or
 * `unknown` would be explaining an absence — both are noise, and a label on
 * every card is a label nobody reads.
 *
 * ── Why the symbol came back OUT of the label ────────────────────────────
 *
 * It was "Because you follow NVDA" and "You cover NVDA", on the reasoning that
 * a checkable statement beats a vague one — "Because you follow this" is not a
 * statement anybody can verify.
 *
 * The reasoning was right and the premise was wrong. This label is appended to
 * the CONTEXT ROW of a card whose headline already names the subject, so the
 * ticker was being printed twice within about 40 pixels, and the row it landed
 * in is the one the reader scans for "is any of this my problem". At six words
 * it was the longest chip in that row and it pushed the row to a second line on
 * a 390px card. "Because you follow this" is indeed unverifiable; "My Scope",
 * sitting under "AMZN is trading above every case you modelled", is not.
 *
 * These are also the two phrases the product has settled on for relevance —
 * My Scope, Assigned to you, In portfolio — so the card now says what the rest
 * of the surface says rather than inventing a sentence for the same fact.
 */
export function coverageExplanationFor(
  index: CoverageIndex,
  assetId: string | null | undefined,
  /**
   * Kept in the signature, and no longer read.
   *
   * The labels used to interpolate it — "Because you follow NVDA". They do not
   * any more, and the parameter stays because it is part of a signature three
   * call sites already satisfy and because a label that wants the symbol is a
   * plausible future: dropping it would churn those call sites now and again
   * later. Prefixed so the compiler knows the omission is deliberate.
   */
  _symbol?: string | null,
): CoverageExplanation {
  const relevance = coverageRelevanceFor(index, assetId)
  if (relevance === 'direct') {
    return { relevance, label: 'My Scope' }
  }
  if (relevance === 'assigned') {
    return { relevance, label: 'Assigned to you' }
  }
  return { relevance, label: null }
}

/**
 * A short, stable key for a coverage index, for React Query cache keys.
 *
 * Ranking is a pure function of the feed and this index, so a consumer that
 * caches ranked output has to re-key when coverage changes — otherwise
 * declaring a name changes nothing until something else happens to invalidate
 * the query, which is exactly the "the boolean is populated but the feed did
 * not move" failure this work exists to avoid.
 *
 * Sizes plus a cheap order-independent checksum: short enough for a key, and
 * it changes whenever the membership changes. Not a hash with collision
 * guarantees — the cost of a collision is one stale render, not a wrong answer.
 */
export function coverageSignature(index: CoverageIndex): string {
  if (!index.ready) return 'pending'
  let sum = 0
  for (const set of [index.direct, index.assigned]) {
    for (const id of set) {
      for (let i = 0; i < id.length; i += 4) sum = (sum + id.charCodeAt(i)) % 1_000_003
    }
  }
  return `${index.direct.size}:${index.assigned.size}:${index.held.size}:${sum}`
}

/**
 * Attach the "why this is here" chip to a card, when there is one to attach.
 *
 * Applied once over the assembled feed rather than inside each of the ~20 card
 * builders: a builder knows what happened to a name, not who is reading, and
 * threading the reader's coverage into all of them would put a per-reader fact
 * inside functions whose output is otherwise identical for the whole desk.
 *
 * Returns the SAME object when there is nothing to say — which is most cards —
 * so the common path allocates nothing and referential equality survives for
 * memoised card components.
 *
 * The chip carries no `href`. It is an explanation, not navigation: a reader
 * who taps "Because you follow NVDA" expecting the card and landing in coverage
 * settings has been punished for reading the label.
 */
export function withCoverageContext(card: SignalCard, index: CoverageIndex): SignalCard {
  const { label } = coverageExplanationFor(index, card.entity?.id, card.entity?.ticker)
  if (!label) return card
  // Never twice — the feed can be re-decorated on a re-rank.
  if (card.context.some(c => c.label === label)) return card
  return { ...card, context: [...card.context, { label }] }
}
