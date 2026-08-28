import type { Severity, SignalType } from './contract'
import {
  scopeBonusFor, scopeOf, scopeWeightFor,
  type CoverageRelevance, type ScopeRelevance,
} from './coverage-relevance'
import {
  DAY_MS, MATERIAL_DEVIATION_PCT, SEVERE_DEVIATION_PCT, SEVERELY_OVERDUE_DAYS,
} from './thresholds'
import { suppressionFor, type AcknowledgmentState, type JudgmentRecord } from './judgment-policy'

/**
 * Which card the reader should meet first.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Nothing, really — there was no ranking. Three separate mechanisms decided
 * order and none of them was about consequence:
 *
 *   1. Scenario cards rendered in their own block above the feed, so a gap on
 *      a 0.4% watchlist name unconditionally preceded a 12% position below its
 *      bear case.
 *   2. Every other kind scored `length - idx` — position within its own source.
 *      Those numbers are not comparable across kinds and were never meant to be.
 *   3. `interleaveByKind` then drew from the kinds by seeded weighted sampling,
 *      so the actual order changed on every refresh by design.
 *
 * ── Tier first, score second ──────────────────────────────────────────────
 *
 * The single most important structural decision here. A purely additive model
 * lets arithmetic override meaning: a 25% position attached to a news story
 * would outscore a genuine case breach on a 3% position, because materiality is
 * a big number and "this is only news" is a small one. No amount of coefficient
 * tuning fixes that, because the two are not on a scale — they are different
 * kinds of claim.
 *
 * So the tier is a hard partition and the score only ever orders WITHIN it.
 * Product semantics first, arithmetic second.
 *
 * ── Deterministic, and what that cost ─────────────────────────────────────
 *
 * `interleaveByKind` was built to make the feed feel alive: its header argues,
 * correctly for the problem it was solving, that "importance should bias
 * position, not fix it", and a re-deal on every refresh stops the surface
 * reading as the same list forever. That was the right call when scores were
 * positional noise — a deterministic sort of noise is just a fixed arbitrary
 * order.
 *
 * It is the wrong call once the scores mean something. A PM opening the feed
 * twice must not be shown a different "most important thing" each time, and a
 * ranking nobody can reproduce cannot be debugged or tested. So ranking is now
 * deterministic and the variety comes from further down: the leading tier is
 * fixed, and interleaving still mixes kinds below it. See `orderFeed`.
 *
 * ── Pure ──────────────────────────────────────────────────────────────────
 *
 * No React, no Supabase, no clock of its own. The gallery imports this module
 * directly, which is only possible because it reaches nothing that needs an
 * environment — the Phase 6B/7 lesson, applied up front rather than after the
 * layout suite fails with no test naming the cause.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A hard semantic partition. Lower sorts first.
 *
 * The boundaries are about what the reader is being asked to do, not about how
 * interesting the card is:
 *
 *   0 The price has left the framework the desk wrote down. A decision is
 *     already overdue whether or not anyone has noticed.
 *   1 The framework itself is missing or expired. Nothing has broken; there is
 *     nothing to break it against.
 *   2 Someone is waiting on you, or something is worth a look. Real, but no
 *     position has left the framework it was written against.
 *   3 Assigned work. Matters to a process, not to a position.
 *   4 Things that happened. Useful context; no decision attached.
 */
export type PriorityTier = 0 | 1 | 2 | 3 | 4

export const TIER_NAMES: Record<PriorityTier, string> = {
  0: 'decision_mismatch',
  1: 'framework_gap',
  2: 'review',
  3: 'workflow',
  4: 'informational',
}

/**
 * The tiers that lead the feed in a fixed, reproducible order.
 *
 * At or below this, ordering is strictly deterministic: these are the cards a
 * PM must see the same way on every open, and a "most important thing" that
 * changes between refreshes is not one. Above it, `interleaveByKind` still
 * mixes kinds so the tail does not read as one blocked source after another.
 *
 * The line sits after tier 1 because tiers 0 and 1 are the two that describe a
 * position: the price has left the framework, or the framework is missing.
 * Everything above is a look, a task or a story.
 */
export const LEAD_TIER: PriorityTier = 1

/**
 * Where each signal type sits, and the base score it carries within its tier.
 *
 * The base numbers are not arbitrary: they preserve the precedence the feed had
 * already worked out by hand in `MobileDashboard`'s lens scores — breach 60,
 * stale target 58, untargeted 50, conviction 40, crowded 38 — rescaled to 0–1.
 * That ordering was argued for in a comment and had been in front of users; it
 * would be careless to discard it for a fresh set of guesses.
 *
 * `scenario_gap` leads tier 0 because it is the only signal that compares the
 * price against the desk's own full ladder rather than a single number.
 */
const TIER: Record<SignalType, { tier: PriorityTier; base: number }> = {
  // 0 — the price has left the framework
  scenario_gap:          { tier: 0, base: 1.00 },
  target_hit:            { tier: 0, base: 0.85 },
  target_expired:        { tier: 0, base: 0.80 },
  thesis_conflict:       { tier: 0, base: 0.70 },
  /**
   * Between the ladder and the target breach, and above both of the others.
   *
   * `scenario_gap` stays top because it compares the price against the desk's
   * whole recorded ladder rather than one number. This sits directly beneath
   * it: a target reached is information the desk can act on at its own pace,
   * where an approved trade that has not been executed is the book actively
   * disagreeing with a decision already made — the one tier-0 condition that
   * is nobody's judgement call and gets worse purely by being ignored.
   *
   * No existing value moved to make room for it.
   */
  execution_unconfirmed: { tier: 0, base: 0.90 },

  // 1 — the framework is missing or the position contradicts it
  no_target:             { tier: 1, base: 0.85 },
  conviction_oversized:  { tier: 1, base: 0.70 },
  conviction_undersized: { tier: 1, base: 0.65 },
  active_risk:           { tier: 1, base: 0.60 },
  no_research:           { tier: 1, base: 0.55 },

  // 2 — someone is waiting, or it is worth a look
  //
  // `recommendation` leads the tier because a proposed trade has a colleague
  // blocked on the reader's answer, where everything below it is an observation
  // nobody is waiting on. It is not tier 0 or 1: no position has left its
  // framework and no framework is missing — somebody is simply asking.
  recommendation:        { tier: 2, base: 0.90 },
  research_stale:        { tier: 2, base: 0.70 },
  crowding:              { tier: 2, base: 0.55 },
  team_focus:            { tier: 2, base: 0.40 },
  catalyst_ahead:        { tier: 2, base: 0.60 },

  // 3 — assigned work
  project_overdue:       { tier: 3, base: 0.60 },
  awaiting_review:       { tier: 3, base: 0.50 },

  // 4 — things that happened, and things colleagues wrote
  //
  // Posts sit here with news rather than in a tier of their own. A colleague's
  // trade idea is genuinely interesting and genuinely not a decision the reader
  // is being asked to make, which is exactly what tier 4 means. Trade ideas lead
  // the tier because they at least propose an action.
  trade_idea:            { tier: 4, base: 0.70 },
  pair_trade:            { tier: 4, base: 0.68 },
  thesis_update:         { tier: 4, base: 0.60 },
  research_note:         { tier: 4, base: 0.55 },
  discussion:            { tier: 4, base: 0.45 },
  thought:               { tier: 4, base: 0.40 },
  earnings_result:       { tier: 4, base: 0.50 },
  earnings_ahead:        { tier: 4, base: 0.45 },
  corporate_action:      { tier: 4, base: 0.45 },
  unusual_move:          { tier: 4, base: 0.40 },
  news:                  { tier: 4, base: 0.30 },
  economic_release:      { tier: 4, base: 0.20 },
}

/** Anything not in the table. Ranks last within tier 4 rather than crashing. */
const UNTIERED = { tier: 4 as PriorityTier, base: 0.1 }

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Position size, in bands rather than as a number.
 *
 * A linear model would make a 20% position worth twenty times a 1% one, which
 * is not how anybody thinks about a book: the interesting distinction is
 * "meaningful / large / dominant", and past about 10% the difference stops
 * changing what the reader does. Bands also keep materiality from swamping the
 * dimensions that carry more meaning.
 *
 * `null` is not zero. An unheld or unknown-weight name gets the neutral band,
 * not the bottom one — several signal types simply do not carry weight (see
 * `TargetBreach`, which has none), and scoring those as though the position
 * were tiny would bury the highest-tier cards in the product.
 */
export function materialityBand(weightPct: number | null | undefined, held: boolean): number {
  if (weightPct == null || !Number.isFinite(weightPct)) {
    // Held but unweighted is still a live position; unheld is a watchlist name.
    return held ? 0.4 : 0.15
  }
  if (weightPct <= 0) return 0.15
  if (weightPct < 1) return 0.25
  if (weightPct < 3) return 0.45
  if (weightPct < 5) return 0.6
  if (weightPct < 10) return 0.8
  return 1
}

/**
 * How far reality has diverged from what was written down.
 *
 * Bucketed, and bucketed WITHIN a signal type by the caller rather than
 * compared across types here. "12% through a bull case" and "12% overweight
 * versus benchmark" are both twelve percent and mean nothing like each other;
 * one universal deviation formula would silently equate them.
 *
 * The thresholds match the rule `scenarioGap.ts` already used to promote a card
 * to `critical`, so severity and ranking cannot disagree about what "materially
 * through" means.
 */
export function deviationBand(deviationPct: number | null | undefined): number {
  if (deviationPct == null || !Number.isFinite(deviationPct)) return 0
  const d = Math.abs(deviationPct)
  if (d >= SEVERE_DEVIATION_PCT) return 1
  if (d >= MATERIAL_DEVIATION_PCT) return 0.6
  if (d > 0) return 0.25
  return 0
}

/**
 * Recency as a bounded modifier, never as the sort key.
 *
 * The failure this exists to prevent is the one the brief names: a two-hour-old
 * stale-research card leading a 12% position below its bear case because it is
 * newer. Capped at `RECENCY_MAX` and decaying to zero over `RECENCY_DAYS`, it
 * can break a tie between comparable cards and can never reorder tiers.
 *
 * An old unresolved high-impact signal therefore does not sink: it loses this
 * component and keeps everything else, and everything else is most of the score.
 */
const RECENCY_MAX = 0.12
const RECENCY_DAYS = 14
export function recencyBoost(occurredAt: number | null | undefined, now: number): number {
  if (occurredAt == null || !Number.isFinite(occurredAt)) return 0
  const ageDays = (now - occurredAt) / DAY_MS
  if (ageDays <= 0) return RECENCY_MAX
  if (ageDays >= RECENCY_DAYS) return 0
  return RECENCY_MAX * (1 - ageDays / RECENCY_DAYS)
}

/**
 * Urgency from what the signal IS, not from when the row was written.
 *
 * Severity is already computed by every builder from real conditions — a price
 * 15% through a case, a project weeks overdue — so this reads that rather than
 * inventing a parallel judgement of the same facts.
 */
const SEVERITY_URGENCY: Record<Severity, number> = {
  critical: 1,
  attention: 0.5,
  informational: 0.15,
}

// ─────────────────────────────────────────────────────────────────────────────
// The model
// ─────────────────────────────────────────────────────────────────────────────

export interface PriorityInput {
  /** Stable identity, used as the final tie-breaker. Usually the card id. */
  id: string
  type: SignalType
  severity: Severity
  /** ISO or epoch ms. When the underlying event happened. */
  occurredAt?: string | number | null
  /** Position weight, where the signal carries one. */
  weightPct?: number | null
  /** Whether the asset is in the book at all. */
  held?: boolean
  /**
   * Deviation from the recorded framework, as a percentage, already normalised
   * by the caller to mean the same thing within this signal type.
   */
  deviationPct?: number | null
  /** For workflow signals only. */
  overdueDays?: number | null
  /**
   * @deprecated Use `coverage`. Retained so existing callers and tests keep
   * working: `owned === false` maps to `'none'`, `true` to `'direct'`, and
   * `undefined` to `'unknown'`. `coverage` wins when both are present.
   *
   * The name was always misleading. It never meant "owns the position" — it
   * meant "is this the reader's responsibility", which is coverage.
   */
  owned?: boolean

  /**
   * What this asset is to this reader: declared coverage, assigned coverage,
   * merely held, none of those, or not yet known.
   *
   * Resolved by `lib/signals/coverage-relevance`, from the one canonical
   * coverage query, and shared with the desktop scorer so both shells agree on
   * who covers what. `'unknown'` is neutral and never a penalty — burying a
   * 12% position below its bear case because a query had not returned would be
   * the worst possible failure mode, which is why the refusals live in that
   * module rather than being re-decided per caller.
   */
  coverage?: CoverageRelevance
  /**
   * The structured form of the same fact, and the one the ranker prefers.
   *
   * `coverage` is a bare enum and can only ever describe a relationship to the
   * asset the item is about. `scope` can also carry a readthrough — relevant
   * because of a relationship to something else the reader owns — which is
   * where this is going. Both are accepted so no caller had to be rewritten to
   * land the type; `scope` wins where present. See `ScopeRelevance`.
   */
  scope?: ScopeRelevance
  /**
   * Who wrote it, relative to this reader. Absent for machine-derived signals,
   * which have no author — and absent must score exactly as `other`, so a
   * signal's total is unchanged by this field existing.
   */
  authorRelation?: 'self' | 'followed' | 'other' | null
  /**
   * Reactions from colleagues. Absent and zero are the same thing.
   *
   * Deliberately weak: it is the only popularity term in the model, and a
   * feedback loop that promotes what is already being read is the easiest way
   * to make a research feed converge on whatever is loudest.
   */
  engagementCount?: number | null
  /**
   * True when the item is in the feed BECAUSE it is unresolved, not because it
   * is recent — an open proposal nobody has executed or rejected.
   *
   * Such an item must not be scored as though it had no recency component:
   * measured on production, the average open proposal was 4,098 hours old,
   * which at desktop's 18-hour half-life rounded to five ten-billionths. Its
   * relevance is a fact about its state, not about the calendar.
   */
  openProposal?: boolean
  /** The reader's stored judgment for this card, if any. */
  judgment?: JudgmentRecord | null
}

export interface PriorityComponents {
  base: number
  materiality: number
  deviation: number
  urgency: number
  ownership: number
  recency: number
  /** Negative. The standing cost of having already been answered. */
  acknowledgment: number
  /**
   * The additive lift for a name the reader covers. Zero for everyone else.
   *
   * Separate from `ownership` so `diversify` can discount it — see
   * `comparableTotal`. Folding it into `ownership` made a covered card look
   * incomparable to every uncovered one and quietly disabled the run rule.
   */
  coverage: number
  /**
   * Who wrote it. Zero for everything with no author, which is every
   * machine-derived signal — so adding this field moved no signal's score.
   */
  author: number
  /** What colleagues did with it. Zero when nobody reacted. */
  engagement: number
  /**
   * Always zero, and deliberately present.
   *
   * Phase 6B records `feed_not_useful` and `feed_wrong_person`, and Phase 8 is
   * explicitly forbidden from consuming them. Declaring the slot now means the
   * day ranking may read that telemetry it becomes one function and one number
   * rather than a change to the shape of every call site and every test.
   */
  personalization: number
}

/**
 * Why a card ranked where it did, as data rather than as a sentence.
 *
 * The foundation for "why am I seeing this?", and deliberately not the copy for
 * it. A ranker that emitted finished strings would decide tone, length and
 * language for every surface that ever renders them, and would have to be
 * edited to change a word. Presentation translates these; the ranker states
 * them.
 *
 * `detail` is where a readthrough will carry its `via` link, so the sentence
 * "Microsoft's capex outlook is relevant to NVDA, which is in your scope" can
 * be built by whoever is rendering it, from facts the ranker supplied.
 */
export type RankReasonCode =
  | 'in_my_scope'
  | 'assigned_to_me'
  | 'held'
  | 'readthrough'
  | 'urgency'
  | 'freshness'
  | 'unresolved'
  | 'material'
  | 'off_framework'
  | 'followed_author'
  | 'own_post'
  | 'peer_interest'
  | 'acknowledged'

export interface RankReason {
  code: RankReasonCode
  /** Signed contribution to the total, so a surface can rank the reasons. */
  contribution: number
  /** Structured facts for presentation to phrase. Never a rendered string. */
  detail?: Record<string, unknown>
}

export interface Priority {
  tier: PriorityTier
  tierName: string
  /** 0–1 within the tier. Never compared across tiers. */
  total: number
  components: PriorityComponents
  acknowledgment: AcknowledgmentState
  /** True when the card should not be shown at all. */
  suppressed: boolean
  /** What the reader is responsible for here, resolved once. */
  scope: ScopeRelevance
  /** Strongest first. Empty when nothing rose above the noise floor. */
  reasons: RankReason[]
}

/**
 * How much each component can contribute, within a tier.
 *
 * They sum to 1 before the acknowledgment penalty, which is subtractive. Base
 * carries the most weight because it encodes the signal's own meaning, which is
 * the thing least likely to be wrong.
 */
/** How much of the score an acknowledgment can take away. */
const ACK_WEIGHT = 0.5

/**
 * Additive lift for a name the reader is responsible for. See `scopeBonusFor`.
 *
 * ── One number where there were two ───────────────────────────────────────
 *
 * Desktop carried 0.12 against its own arithmetic and mobile 0.10 against
 * this one, and a single declaration was applied on both scales in sequence,
 * because mobile ranked rows that desktop had already scored. 0.10 is kept —
 * it is the constant that belongs to the model that survived — and desktop's
 * 0.12 is gone rather than averaged, because averaging two numbers tuned
 * against two different scales produces a third number tuned against neither.
 */
const SCOPE_BONUS = 0.10

/**
 * Additive lift for who wrote it, folded in from the desktop scorer.
 *
 * Desktop scored `authorRelevance` at 0.2 of its total: followed 0.9, own 0.7,
 * everyone else 0.3. The ORDER was right and worth keeping — a colleague you
 * follow is a stated interest, and your own writing is a reminder of what you
 * were thinking — but 0.2 of the score is far too much authority for it. It
 * ranked a followed author's throwaway line above an unfollowed colleague's
 * carefully argued one, on the strength of the follow alone.
 *
 * Additive and small, so it cannot cross a tier: an urgent scenario gap still
 * beats any post, however well connected its author. Within tier 4 — where
 * every post lives — base spans about 0.12 to 0.28, so 0.06 reorders posts
 * without overwhelming what kind of post they are.
 */
const AUTHOR_BONUS = 0.06
const AUTHOR_WEIGHT: Record<'self' | 'followed' | 'other', number> = {
  followed: 1,
  self: 0.6,
  other: 0,
}

/**
 * Additive lift for peer reactions. Deliberately the smallest term in the model.
 *
 * Desktop weighted engagement at 0.2, equal with asset relevance and only
 * slightly behind freshness — which makes a research feed a popularity ranking,
 * and a self-reinforcing one: the cards that get read get reactions, and the
 * cards with reactions get shown. It is a real signal about what colleagues
 * found worth responding to, and it is the one input in this model that is
 * measuring the feed's own behaviour rather than the book's.
 *
 * So it survives at a fifth of its former authority, enough to break a tie
 * between comparable posts and not enough to decide anything on its own.
 */
const ENGAGEMENT_BONUS = 0.04

/**
 * The floor an unresolved item's recency cannot fall below.
 *
 * `recencyBoost` decays to zero over 14 days, which is right for something that
 * HAPPENED and wrong for something that is still open. Desktop discovered this
 * the hard way: at an 18-hour half-life the average open proposal scored five
 * ten-billionths, so every trade idea sorted below anything written this week
 * and the Ideas filter looked empty. Its fix was a 0.55 floor on a 0–1
 * freshness term; the same proportion of this model's smaller recency span is
 * carried over rather than re-guessed.
 */
const PROPOSAL_RECENCY_FLOOR = 0.12 * 0.55

/** Exported for tests, so the floor is asserted against the constant. */
export const PROPOSAL_RECENCY_FLOOR_FOR_TEST = PROPOSAL_RECENCY_FLOOR

const WEIGHTS = {
  base: 0.40,
  materiality: 0.22,
  deviation: 0.18,
  urgency: 0.14,
  ownership: 0.06,
} as const

const toEpoch = (v: string | number | null | undefined): number | null => {
  if (v == null) return null
  const t = typeof v === 'number' ? v : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Reconcile the new `coverage` field with the legacy `owned` boolean.
 *
 * `coverage` wins when set. Otherwise the boolean is translated, so every
 * existing caller and test keeps its exact behaviour: `false` was a full
 * penalty and is `'none'`; `true` and `undefined` both scored 1 and map to
 * `'direct'` and `'unknown'`, which also both score 1.
 */
function resolveCoverage(input: PriorityInput): CoverageRelevance {
  if (input.coverage) return input.coverage
  if (input.owned === false) return 'none'
  if (input.owned === true) return 'direct'
  return 'unknown'
}

/**
 * What the reader is responsible for here, from whichever field the caller set.
 *
 * `scope` is the structured form and wins, because it is the only one that can
 * carry a readthrough. The other two are the older, narrower spellings of the
 * same fact and are translated rather than deprecated in place — every existing
 * caller and test keeps its exact behaviour.
 */
function resolveScope(input: PriorityInput): ScopeRelevance {
  if (input.scope) return input.scope
  return scopeOf(resolveCoverage(input))
}

export function priorityFor(input: PriorityInput, now: number): Priority {
  const scope = resolveScope(input)
  const placement = TIER[input.type] ?? UNTIERED
  let tier = placement.tier

  /**
   * A judgment only counts for the signal it actually answered.
   *
   * `not_price_driven` closes the no-target question and says nothing about a
   * scenario gap on the same name — not its resolution, and not its 180 days of
   * quiet either. The whole record is discarded when out of scope, so one
   * answer about valuation method can never silence a price that has left the
   * ladder.
   *
   * That reasoning, and the `resolved || suppressed` composition below it, now
   * live in `suppressionFor` — because desktop needs the same answer and cannot
   * get it by computing a mobile priority. Two implementations of "has this
   * been dealt with" is the same failure as two definitions of "covered".
   */
  const { acknowledgment: ack, suppressed } = suppressionFor(input.judgment, input.type, now)

  /**
   * Severely overdue assigned work can leave the workflow tier.
   *
   * A project two days late is housekeeping and belongs below every investment
   * signal. One three weeks late, with somebody waiting, is a real failure and
   * pinning it beneath every news story would be its own kind of wrong. It is
   * promoted to the review tier, not to a decision tier: it is still not a
   * position that has left its framework.
   */
  if (tier === 3 && (input.overdueDays ?? 0) >= SEVERELY_OVERDUE_DAYS) {
    tier = 2
  }

  const held = input.held ?? (input.weightPct != null && input.weightPct > 0)

  const components: PriorityComponents = {
    base: placement.base * WEIGHTS.base,
    materiality: materialityBand(input.weightPct, held) * WEIGHTS.materiality,
    deviation: deviationBand(input.deviationPct) * WEIGHTS.deviation,
    urgency: SEVERITY_URGENCY[input.severity] * WEIGHTS.urgency,
    // Scope, graded across the span this component always had.
    //
    // `owned === false` scored 0 and everything else scored 1, so the full
    // range was already WEIGHTS.ownership. `scopeWeightFor` divides that
    // existing range rather than widening it — which is why no other weight
    // moved, and why a reader with no scope gets a bit-for-bit unchanged
    // feed (every card resolves to `unknown`, which scores 1, a constant).
    ownership: scopeWeightFor(scope) * WEIGHTS.ownership,
    /**
     * The lift that makes declaring coverage worth doing.
     *
     * The graded band above spans WEIGHTS.ownership — 0.06 — and that turned
     * out to be too little to change what a reader sees: covered-versus-held is
     * 0.024 of it, against a materiality term weighted 0.22. Measured on
     * staging, declaring two names moved the ranked feed by nothing.
     *
     * Exactly zero for `held`, `none` and `unknown`, so a reader who has
     * declared nothing keeps the feed they had. And it cannot cross a tier —
     * `compareRanked` sorts by tier before score — so an urgent uncovered
     * signal still outranks a weak covered one.
     */
    coverage: scopeBonusFor(scope) * SCOPE_BONUS,
    // Folded in from the desktop scorer at a fifth of their former authority.
    // Both are exactly zero in their absent case, so no machine-derived signal
    // moved by a millionth when these fields were added.
    author: AUTHOR_WEIGHT[input.authorRelation ?? 'other'] * AUTHOR_BONUS,
    engagement: engagementWeight(input.engagementCount) * ENGAGEMENT_BONUS,
    /**
     * Recency, floored for something that is in the feed because it is still
     * open. See PROPOSAL_RECENCY_FLOOR — a February proposal nobody has
     * executed is a live question today, and scoring it as stale is what made
     * the Ideas filter look empty.
     */
    recency: input.openProposal
      ? Math.max(recencyBoost(toEpoch(input.occurredAt), now), PROPOSAL_RECENCY_FLOOR)
      : recencyBoost(toEpoch(input.occurredAt), now),
    // `|| 0` normalises the negative zero that `-0 * 0.5` produces. Harmless
    // arithmetically, but it prints as "-0.000" in the debug line and fails an
    // `Object.is` comparison, which is a confusing way to learn nothing is wrong.
    acknowledgment: -ack.penalty * ACK_WEIGHT || 0,
    personalization: 0,
  }

  const total = Object.values(components).reduce((a, b) => a + b, 0)

  return {
    tier,
    tierName: TIER_NAMES[tier],
    // Clamped so the penalty cannot drive a card below an untiered one and
    // invert the ordering the tier was supposed to guarantee.
    total: Math.max(0, Math.min(1, total)),
    components,
    acknowledgment: ack,
    suppressed,
    scope,
    reasons: reasonsFor(components, scope, input),
  }
}

/** `min(1, log2(n+1)/4)` — the desktop curve, kept; four reactions is a lot. */
function engagementWeight(count: number | null | undefined): number {
  if (!count || count <= 0) return 0
  return Math.min(1, Math.log2(count + 1) / 4)
}

/**
 * The drivers worth telling a reader about, strongest first.
 *
 * Only components that actually contributed appear, so a card with no scope
 * relationship does not report "not in your scope" as a reason it is being
 * shown. The threshold is a noise floor rather than a product decision: a
 * contribution of a thousandth is arithmetic, not an explanation.
 */
const REASON_FLOOR = 0.005

function reasonsFor(
  c: PriorityComponents,
  scope: ScopeRelevance,
  input: PriorityInput,
): RankReason[] {
  const out: RankReason[] = []
  const push = (code: RankReasonCode, contribution: number, detail?: Record<string, unknown>) => {
    if (Math.abs(contribution) >= REASON_FLOOR) out.push({ code, contribution, detail })
  }

  const scopeContribution = c.ownership + c.coverage
  switch (scope.kind) {
    case 'personal_scope': push('in_my_scope', scopeContribution); break
    case 'assigned_scope': push('assigned_to_me', scopeContribution); break
    case 'held': push('held', scopeContribution); break
    // The link travels with the reason, so presentation can name the asset the
    // item reads through to without asking the ranker for a sentence.
    case 'readthrough': push('readthrough', scopeContribution, { via: scope.via }); break
    default: break
  }

  /**
   * Only a critical signal reads as urgent.
   *
   * Every card carries an urgency contribution — `informational` is 0.15 of the
   * urgency weight, which is the baseline, not a claim — so pushing this
   * unconditionally put an "Urgent" chip on a six-week-old thought and on every
   * trade idea in the feed. A badge that appears on everything is not an alert;
   * it is decoration that teaches the reader to stop seeing the word.
   *
   * `attention` severity is deliberately silent too: a proposal already says
   * "Open decision", and stacking "Urgent" on top of it says nothing more.
   *
   * This changes which REASONS are emitted and no score whatsoever — `urgency`
   * is still in `components` and still in `total` for every card.
   */
  if (input.severity === 'critical') push('urgency', c.urgency)
  push('material', c.materiality)
  push('off_framework', c.deviation)
  if (input.openProposal) push('unresolved', c.recency, { status: input.type })
  else push('freshness', c.recency)
  if (input.authorRelation === 'followed') push('followed_author', c.author)
  if (input.authorRelation === 'self') push('own_post', c.author)
  push('peer_interest', c.engagement, { reactions: input.engagementCount ?? 0 })
  push('acknowledged', c.acknowledgment)

  return out.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
}

// ─────────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────────

export interface RankedItem<T> {
  item: T
  priority: Priority
  input: PriorityInput
}

/**
 * Sort ranked items into the order the reader meets them.
 *
 * Every tie-break is total and deterministic, which is a requirement rather
 * than a nicety: two cards with equal scores must not swap places between
 * renders, or the feed moves under the reader's thumb and no test of ordering
 * can be trusted.
 *
 *   1. tier          — semantics before arithmetic
 *   2. total         — the score, within the tier
 *   3. occurredAt    — newer first, among genuinely equal cards
 *   4. id            — a stable string, so the result is a total order
 *
 * Step 4 is what makes this reproducible. Without it `Array.sort` leaves equal
 * elements in input order, and input order depends on how the sources happened
 * to resolve.
 */
export function compareRanked<T>(a: RankedItem<T>, b: RankedItem<T>): number {
  if (a.priority.tier !== b.priority.tier) return a.priority.tier - b.priority.tier
  if (a.priority.total !== b.priority.total) return b.priority.total - a.priority.total
  const at = toEpoch(a.input.occurredAt) ?? 0
  const bt = toEpoch(b.input.occurredAt) ?? 0
  if (at !== bt) return bt - at
  return a.input.id < b.input.id ? -1 : a.input.id > b.input.id ? 1 : 0
}

/**
 * Rank a feed, dropping what the reader has already dealt with.
 *
 * Ranking runs AFTER eligibility and deduplication, never as a substitute for
 * either. Phase 7 established that a specific decision event beats a generic
 * attention reminder, and it settles that by removing the weaker card — which
 * is right, because two cards about one holding is a duplication problem and
 * lowering one of them still leaves both on screen.
 */
export function rankFeed<T>(
  items: T[],
  toInput: (item: T) => PriorityInput,
  now: number,
): RankedItem<T>[] {
  return items
    .map(item => {
      const input = toInput(item)
      return { item, input, priority: priorityFor(input, now) }
    })
    .filter(r => !r.priority.suppressed)
    .sort(compareRanked)
}

/**
 * A one-line account of why a card ranked where it did.
 *
 * For tests, the gallery and bug reports — never for the product surface. A
 * reader shown "Priority score: 82" learns nothing they can act on and starts
 * arguing with the number instead of the investment.
 */
export function explainPriority(p: Priority): string {
  const parts = Object.entries(p.components)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(3)}`)
  return `${p.tierName} (${p.tier}) · ${p.total.toFixed(3)} = ${parts.join(' ')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentation diversity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many cards of one signal type may appear back to back.
 *
 * Two, not one. A desk that genuinely has three critical scenario gaps should
 * see them together — that is the feed working. Six no-target cards in a row is
 * the feed reporting the shape of the database instead of the shape of the
 * problem, which is what hands-on testing found.
 */
const MAX_RUN = 2

/**
 * How far down the ranking diversity may reach for an alternative.
 *
 * Two bounds doing different work.
 *
 * The score bound stops a genuinely weaker card displacing a stronger one: an
 * alternative may only step in when it was close to winning anyway.
 *
 * The tier bound stops variety reaching down the feed for something merely
 * different. It is a CEILING on an escalating reach, not a fixed window: the
 * first repeat looks one tier down and a longer run looks two. Two, not more,
 * so an informational card can never interrupt a decision — see `diversify`.
 */
const DIVERSITY_TOLERANCE = 0.15
const MAX_TIER_REACH = 2

/**
 * Break up runs of one signal type without discarding the ranking.
 *
 * ── Why this is a separate pass and not a scoring term ────────────────────
 *
 * Diversity is a property of a SEQUENCE, not of a card. Expressed as a penalty
 * inside `priorityFor` it would have to know what came before it, which makes
 * the score depend on position — and then the score cannot be tested, explained
 * or compared, which is most of what Phase 8 was for. Keeping it downstream
 * means the ranking still answers "how consequential is this card" and this
 * answers "what should the reader meet next", which are different questions.
 *
 * Deterministic by construction: a greedy scan in ranked order, taking the
 * first eligible alternative. No shuffle, no seed, no clock. The same input
 * produces the same sequence every time, which is the property the whole phase
 * depends on.
 *
 * Not applied when the reader has filtered to one type: they asked for all of
 * that category, and interleaving a category with itself is meaningless.
 */
/**
 * A category may not take more than this many of the opening cards.
 *
 * ── Why signal-type runs were not enough ─────────────────────────────────
 *
 * The existing rule caps consecutive cards of one TYPE. A desk whose decisions
 * tier holds no-target, target-expired, crowding and conviction cards satisfies
 * it completely while showing fifteen Decisions in a row — every adjacent pair
 * is a different type, and the reader still meets one category for three
 * screens and concludes the feed only does that.
 *
 * News in particular was never reached without filtering, because it is tier 4
 * and every Decision outranks it. That is correct as ranking and wrong as a
 * first impression: a relevant news card buried behind fifteen decisions is a
 * card the reader will never see.
 *
 * So a second, coarser constraint applies to the opening only: within the first
 * `OPENING`, one category may hold at most `MAX_OPENING_PER_CATEGORY`. It is a
 * cap, not a quota — nothing is promoted to fill a category, and if no credible
 * alternative exists the cap simply does not bind.
 */
const OPENING = 8
const MAX_OPENING_PER_CATEGORY = 4

/**
 * A card's score with the coverage lift removed.
 *
 * Diversity asks "is there a credible alternative to another card of this
 * type?", and credibility must not be judged by whose name the reader follows.
 * Comparing raw totals let the coverage bonus push every uncovered alternative
 * outside `tolerance`, so the run rule found nothing to swap in and silently
 * stopped binding — a feed of nothing but covered names, which is precisely
 * what the bonus is not allowed to produce.
 *
 * Coverage still decides the ORDER, because `compareRanked` sorts on the full
 * total. It just does not get to decide what counts as a competitor.
 */
const comparableTotal = <T>(r: RankedItem<T>): number =>
  r.priority.total - (r.priority.components.coverage ?? 0)

export function diversify<T>(
  ranked: RankedItem<T>[],
  options: {
    maxRun?: number
    tolerance?: number
    enabled?: boolean
    /**
     * The canonical category of an item, for the opening cap. Omitted — as the
     * unit tests omit it — the cap does not apply and only the run rule runs.
     */
    categoryOf?: (item: T) => string | null
  } = {},
): RankedItem<T>[] {
  const { maxRun = MAX_RUN, tolerance = DIVERSITY_TOLERANCE, enabled = true, categoryOf } = options
  if (!enabled || ranked.length < 3) return ranked

  const pool = [...ranked]
  const out: RankedItem<T>[] = []
  let runType: SignalType | null = null
  let runLength = 0
  /** How many of the opening each category has taken. */
  const openingCount = new Map<string, number>()

  while (pool.length) {
    let index = 0

    /**
     * The opening cap, applied before the run rule.
     *
     * Only while filling the first `OPENING` slots, and only when a category
     * has already had its share AND something else is competitive. The score
     * floor is the same one the run rule uses, so this can no more promote
     * junk than that can.
     */
    if (categoryOf && out.length < OPENING) {
      const headCat = categoryOf(pool[0].item)
      if (headCat && (openingCount.get(headCat) ?? 0) >= MAX_OPENING_PER_CATEGORY) {
        const head = pool[0]
        const alt = pool.findIndex(r => {
          const c = categoryOf(r.item)
          return c != null && c !== headCat
            && r.priority.tier - head.priority.tier <= MAX_TIER_REACH + 1
            && comparableTotal(r) >= comparableTotal(head) - (tolerance + 0.25)
        })
        if (alt > 0) index = alt
      }
    }

    // Only look for an alternative when taking the head would extend a run
    // past the cap. Otherwise the ranking stands untouched.
    if (index === 0 && runType != null && pool[0].input.type === runType && runLength >= maxRun) {
      const head = pool[0]
      /**
       * The longer the run, the further diversity may reach.
       *
       * A fixed one-tier window was not enough in practice. A desk with eight
       * no-target positions has eight tier-1 cards and frequently nothing else
       * in that tier, so the window found no alternative and the feed ran all
       * eight consecutively — which is what hands-on testing reported.
       *
       * Escalating fixes that without abandoning priority: the first repeat
       * looks one tier down, a longer run looks two, and the score window opens
       * with it. Two tiers is the ceiling, so a news story still cannot be
       * pulled above a decision however monotonous the run gets — the guarantee
       * that matters is preserved, and only the patience for monotony changes.
       */
      const over = runLength - maxRun
      const reach = Math.min(1 + over, MAX_TIER_REACH)
      const window = tolerance + over * 0.08

      const alt = pool.findIndex(r =>
        r.input.type !== runType
        && r.priority.tier - head.priority.tier <= reach
        && r.priority.tier >= head.priority.tier
        && comparableTotal(r) >= comparableTotal(head) - window)
      // No eligible alternative means priority wins and the run continues,
      // which is the correct outcome: the feed should not reorder itself into
      // something less useful for the sake of looking varied.
      if (alt > 0) index = alt
    }

    const chosen = pool.splice(index, 1)[0]
    out.push(chosen)
    if (categoryOf) {
      const c = categoryOf(chosen.item)
      if (c) openingCount.set(c, (openingCount.get(c) ?? 0) + 1)
    }
    if (chosen.input.type === runType) runLength += 1
    else { runType = chosen.input.type; runLength = 1 }
  }

  return out
}
