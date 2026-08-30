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

/**
 * How many asset ids a retrieval query may carry.
 *
 * `.in('asset_id', ids)` becomes a literal list in a PostgREST GET URL: 100
 * UUIDs is roughly 3.9 KB, comfortably inside the usual 8 KB request-line
 * limit, and generous against the 20–60 names an analyst actually covers.
 */
/**
 * Why a candidate is relevant to this reader, as a structured fact.
 *
 * ── Why a shape and not a string ──────────────────────────────────────────
 *
 * `CoverageRelevance` answers "what is this asset to this reader", and every
 * value it can take describes a relationship to the asset ITSELF. That is the
 * assumption this type exists to stop hardening.
 *
 * Relevance does not end at an exact ticker match. An event about MSFT can
 * matter because hyperscaler capex moves NVDA, and NVDA is in the reader's
 * scope — the item is relevant, the reason is a relationship, and the
 * explanation names a DIFFERENT asset than the one the row is about. A bare
 * enum cannot carry that: there is nowhere to put the target, the relationship,
 * its strength, or the sentence a reader would need to believe it.
 *
 * So relevance is a small record. Today every value is a direct relationship
 * and `via` is always absent. The `readthrough` kind is declared and carries no
 * score, deliberately — see `scopeWeightFor`. Adding the graph later is then a
 * new producer of this type and a number in one switch, not a change to the
 * ranker's inputs, its outputs, or any call site.
 *
 * ── Vocabulary ────────────────────────────────────────────────────────────
 *
 * The product language is scope, not coverage:
 *
 *   personal_scope — the reader chose this name as part of My Scope
 *   assigned_scope — the organization assigned this name to the reader
 *   held           — the book has exposure; nobody has claimed attention for it
 *   readthrough    — out of scope, and relevant through a relationship to
 *                    something that is in scope. Not yet scored.
 *   none           — the reader has scope, and this is outside all of it
 *   unknown        — we decline to answer; see the three refusals above
 *
 * The legacy `CoverageRelevance` strings stay for now because renaming them
 * would touch every test and every call site for no behavioural gain. `scopeOf`
 * is the one translation point.
 */
export type ScopeKind =
  | 'personal_scope'
  | 'assigned_scope'
  | 'held'
  | 'readthrough'
  | 'none'
  | 'unknown'

/**
 * The relationship that made an out-of-scope item relevant.
 *
 * Reserved shape. Nothing produces it yet; the ranker must not be rewritten to
 * accept it when something does.
 */
export interface ReadthroughLink {
  /** The asset the item is actually about. */
  sourceAssetId: string
  /** The in-scope asset it reads through to. */
  targetAssetId: string
  /** e.g. `supplier`, `customer`, `capex_exposure`, `same_theme`. */
  relationshipType: string
  /** 0–1. How strongly the relationship carries. */
  strength: number
  /** Why, in words a reader can check. Not UI copy — an input to it. */
  explanation: string
}

export interface ScopeRelevance {
  kind: ScopeKind
  /** Present only for `readthrough`. */
  via?: ReadthroughLink
}

const SCOPE_OF: Record<CoverageRelevance, ScopeKind> = {
  direct: 'personal_scope',
  assigned: 'assigned_scope',
  held: 'held',
  none: 'none',
  unknown: 'unknown',
}

/** The one translation point between the legacy enum and the scope vocabulary. */
export function scopeOf(relevance: CoverageRelevance): ScopeRelevance {
  return { kind: SCOPE_OF[relevance] }
}

/** Scope for an asset, straight from the index. The usual entry point. */
export function scopeRelevanceFor(
  index: CoverageIndex,
  assetId: string | null | undefined,
): ScopeRelevance {
  return scopeOf(coverageRelevanceFor(index, assetId))
}

/**
 * How much scope is worth, in [0, 1] — the ONE place that decides it.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Two projections and two additive bonuses. Desktop scored `assetRelevance`
 * across a 0.2 span and added 0.12; mobile scored `ownership` across 0.06 and
 * added 0.10. One declaration was therefore applied twice, on two scales tuned
 * independently, and the "right" magnitude was a different number on each. One
 * ranking model has one number.
 *
 * The bands keep the order the two scales agreed on — declared above assigned's
 * equal, both above held, held above none — and `unknown` stays neutral at the
 * top rather than at the bottom, because a pending query must never read as
 * "not your problem".
 */
export function scopeWeightFor(scope: ScopeRelevance): number {
  switch (scope.kind) {
    case 'personal_scope':
    case 'assigned_scope':
      return 1
    case 'held':
      return 0.6
    /**
     * Declared, and deliberately unscored.
     *
     * A readthrough is worth something between `held` and `assigned_scope`, and
     * probably scaled by `via.strength` — but choosing that number is a product
     * decision that needs a graph to measure against, and guessing it now would
     * bake an unmeasured constant into the one place relevance is decided.
     * Neutral until then: it can be produced, carried, explained and tested
     * without moving anybody's feed.
     */
    case 'readthrough':
      return 1
    case 'none':
      return 0
    case 'unknown':
      return 1
  }
}

/**
 * The additive lift for a name the reader is responsible for.
 *
 * Exactly zero for `held`, `none` and `unknown`, so a reader who has declared
 * nothing keeps the feed they had — the property that made this safe to ship as
 * two constants, and the one worth keeping now that it is one.
 *
 * `readthrough` gets nothing yet, for the reason above.
 */
export function scopeBonusFor(scope: ScopeRelevance): number {
  return scope.kind === 'personal_scope' || scope.kind === 'assigned_scope' ? 1 : 0
}

export const MAX_COVERAGE_ASSETS = 100

/**
 * The assets a retrieval query should ask about — the third projection of this
 * one index, and the reason there is still only one definition of "covered".
 *
 * `coverageWeightFor` and `desktopAssetRelevanceFor` project the index onto a
 * SCORE. This projects it onto a SET, because scoring an item requires it to
 * have been fetched, and the feed was fetching by recency alone: coverage could
 * reorder a page but never pull a covered idea onto it. See
 * docs/tickets/ideas-candidate-retrieval.md.
 *
 * ── Why `held` is excluded ────────────────────────────────────────────────
 *
 * The same distinction the bands draw, applied one stage earlier. `held` is a
 * fact about a portfolio, not a claim about this reader's attention, and the
 * book is large: keying retrieval off it would let every name anybody holds
 * into the candidate set and turn a relevance pool into a second recency pool
 * with extra steps. Holdings keep the weaker scoring band they already have.
 *
 * ── Why an empty result is the important case ─────────────────────────────
 *
 * Refusal 1, at the retrieval stage. A reader with nothing declared — which is
 * nearly everyone today — gets `[]`, the caller issues no extra query, and the
 * candidate set is bit-for-bit what it was before this shipped. Coverage that
 * nobody has declared must not cost anybody a request.
 *
 * `ready` is honoured for the same reason `coverageRelevanceFor` honours it: a
 * pending query must not look like "you cover nothing", and here it also must
 * not fire a query against a half-built set.
 *
 * The result is sorted and capped so that a reader who covers more names than
 * one query can carry gets a stable, explicable subset rather than whatever
 * `Set` iteration order happened to produce. `direct` before `assigned`: the
 * reader's own claim outranks the organization's claim about them, which is the
 * same precedence `coverageRelevanceFor` applies.
 */
export function retrievalAssetIdsFor(
  index: CoverageIndex,
  limit: number = MAX_COVERAGE_ASSETS,
): string[] {
  if (!index.ready) return []
  const direct = [...index.direct].filter(id => UUID.test(id)).sort()
  const assigned = [...index.assigned]
    .filter(id => UUID.test(id) && !index.direct.has(id))
    .sort()
  return [...direct, ...assigned].slice(0, Math.max(0, limit))
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
    /**
     * No label. Assignment is not a finding.
     *
     * "Assigned to you" told the reader something about our coverage table and
     * nothing about the price having left their cases. On a 390px row it cost
     * a slot beside "2 portfolios · 3 cases", both of which are about the
     * position, and it read as an obscure scope tag rather than a reason.
     *
     * The relevance SCORE is unchanged, so assigned names still rank where
     * they ranked. Only the chip is gone.
     *
     * When a finding really was directed by a person, that belongs in the
     * headline or the body of that finding — "Ana asked you to look at this" —
     * where it carries a name and an ask, not in generic metadata.
     */
    return { relevance, label: null }
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
