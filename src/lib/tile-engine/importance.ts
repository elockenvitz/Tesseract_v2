/**
 * Importance, delegated. This module ranks nothing.
 *
 * ── The sovereignty rule ──────────────────────────────────────────────────
 *
 * `lib/signals/feed-priority` is the only thing in the product allowed to
 * decide what the reader meets first. It carries a hard tier partition, a
 * weighted score within the tier, an acknowledgment penalty, coverage
 * weighting and a total tie-break, and every one of those was argued for
 * against a specific failure. A second scorer in the tile engine would not be
 * an improvement on it; it would be a rival, and the observable symptom would
 * be two surfaces disagreeing about the most important thing in the book.
 *
 * So this file is an ADAPTER and nothing else. It translates a `Situation`
 * into the `PriorityInput` the existing scorer already understands, calls
 * `rankFeed`, and returns what came back. No coefficients, no tiers, no
 * thresholds, and — critically — no `base` override: the engine does not get
 * to nudge a situation up the order by describing it enthusiastically.
 *
 * ── What "the situation's type" means for ranking ─────────────────────────
 *
 * The lead finding declares a `signalType`, and that is what ranks. Corroborating
 * findings deliberately do NOT add score. A name with three findings is not
 * three times as urgent as a name with one — it is one situation, and inflating
 * it would rediscover the additive-model failure the priority module's header
 * warns about, where arithmetic overrides meaning.
 *
 * The one thing corroboration is allowed to do is fill gaps: if the lead has no
 * weight but a supporting finding does, the situation genuinely carries that
 * weight and withholding it would under-rank a real position. Filling a missing
 * input is not the same as adding to a present one.
 */

import {
  rankFeed, type PriorityInput, type RankedItem,
} from '../signals/feed-priority'
import type { JudgmentRecord } from '../signals/judgment-policy'
import type { CoverageRelevance } from '../signals/coverage-relevance'
import type { Situation } from './situation'

/**
 * What the reader has already said, keyed by situation id.
 *
 * Threaded through rather than looked up, because the engine has no data
 * access of its own and must not grow one. `priorityFor` applies the
 * acknowledgment penalty; nothing here interprets the record.
 */
export type JudgmentLookup = (situation: Situation) => JudgmentRecord | null

/**
 * The first non-null value across the lead and its corroboration.
 *
 * Gap-filling only. See the header: a present value is never combined with
 * another, because two findings about one subject are describing the same
 * position from two angles, not two positions.
 */
function firstDefined<T>(s: Situation, pick: (f: Situation['lead']) => T | null | undefined): T | null {
  const v = pick(s.lead)
  if (v != null) return v
  for (const f of s.supporting) {
    const sv = pick(f)
    if (sv != null) return sv
  }
  return null
}

/**
 * The strongest coverage claim in the group.
 *
 * `unknown` is neutral in the scorer and must not win over a real answer: a
 * lead whose coverage query had not returned would otherwise erase a
 * supporting finding that knows the reader covers the name. Ordered by
 * strength, with `unknown` last, so the situation is scored on the best
 * information any member had.
 */
const COVERAGE_STRENGTH: Record<CoverageRelevance, number> = {
  direct: 0, assigned: 1, held: 2, none: 3, unknown: 4,
}

function situationCoverage(s: Situation): CoverageRelevance | undefined {
  let best: CoverageRelevance | undefined
  for (const f of [s.lead, ...s.supporting]) {
    const c = f.stakes.coverage
    if (!c) continue
    if (!best || COVERAGE_STRENGTH[c] < COVERAGE_STRENGTH[best]) best = c
  }
  return best
}

export function situationPriorityInput(
  s: Situation,
  judgmentFor?: JudgmentLookup,
): PriorityInput {
  return {
    id: s.id,
    type: s.lead.signalType,
    severity: s.severity,
    occurredAt: s.occurredAt,
    weightPct: firstDefined(s, f => f.stakes.weightPct),
    held: firstDefined(s, f => f.stakes.held) ?? undefined,
    deviationPct: firstDefined(s, f => f.stakes.deviationPct),
    overdueDays: firstDefined(s, f => f.stakes.overdueDays),
    coverage: situationCoverage(s),
    judgment: judgmentFor ? judgmentFor(s) : null,
    // No `base`. See the header — the engine may not describe its way upward.
  }
}

/**
 * Rank situations using the product's existing scorer.
 *
 * A one-line function on purpose. If this ever grows a branch, the tile engine
 * has started having opinions about order and the rule at the top of this file
 * has been broken.
 */
export function rankSituations(
  situations: Situation[],
  now: number,
  judgmentFor?: JudgmentLookup,
): RankedItem<Situation>[] {
  return rankFeed(situations, s => situationPriorityInput(s, judgmentFor), now)
}
