import type { Severity, SignalType } from './contract'
import {
  DAY_MS, MATERIAL_DEVIATION_PCT, SEVERE_DEVIATION_PCT, SEVERELY_OVERDUE_DAYS,
} from './thresholds'
import { acknowledgmentFor, judgmentApplies, type AcknowledgmentState, type JudgmentRecord } from './judgment-policy'

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
   * Whether this reader owns the asset, position or workflow.
   *
   * `undefined` means unknown, which is the current state for every signal on
   * mobile: no feed hook queries `coverage`. Unknown is neutral — never a
   * penalty. Hiding a 12% position below its bear case because we could not
   * establish who covers it would be the worst possible failure mode.
   */
  owned?: boolean
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
   * Always zero, and deliberately present.
   *
   * Phase 6B records `feed_not_useful` and `feed_wrong_person`, and Phase 8 is
   * explicitly forbidden from consuming them. Declaring the slot now means the
   * day ranking may read that telemetry it becomes one function and one number
   * rather than a change to the shape of every call site and every test.
   */
  personalization: number
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

export function priorityFor(input: PriorityInput, now: number): Priority {
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
   */
  const judgment = input.judgment && judgmentApplies(input.judgment.key, input.type)
    ? input.judgment
    // A record with no semantic key has no scope to be out of, so it still
    // applies: the legacy path below is the only thing that can read it.
    : input.judgment && !input.judgment.key ? input.judgment : null

  const ack = acknowledgmentFor(judgment, now)
  const suppressed = ack.resolved || ack.suppressed

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
    // Unknown ownership scores the same as owned. See `PriorityInput.owned`:
    // the alternative is penalising signals for a query the mobile feed does
    // not make, which would bury real findings for a data-plumbing reason.
    ownership: (input.owned === false ? 0 : 1) * WEIGHTS.ownership,
    recency: recencyBoost(toEpoch(input.occurredAt), now),
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
  }
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
            && r.priority.total >= head.priority.total - (tolerance + 0.25)
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
        && r.priority.total >= head.priority.total - window)
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
