/**
 * How loud one attention item is, from the score the attention system already
 * computed and the feed has never read.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * `rankFeed` scores a card mostly from a per-SignalType constant carrying the
 * largest weight in the model. For a workflow card that constant is the whole
 * of it: `weightPct` and `deviationPct` are null, so the two next-largest
 * components are inert, and severity — the only thing left that varies — moves
 * a total by at most 0.119 and can never change a tier.
 *
 * The consequence was measured rather than guessed. Eight overdue projects, one
 * of them a day late and one forty-six days late, all scored exactly 0.576.
 * They formed a contiguous block at the head of the ranking, no alternative sat
 * within the composer's tolerance of any of them, and the reader was shown
 * seven Overdue tiles in a row. Inside the block the order fell through every
 * tie-break to a SHA-256 digest, so the reader did not even meet the latest
 * project first.
 *
 * ── Why this reads a score instead of grading severity ────────────────────
 *
 * Because the score already exists and is better than anything a new rule here
 * would invent. `calculateScore` in `hooks/useAttention` computes, per item:
 *
 *   a severity multiplier          10 to 20
 *   ten points per day overdue     unbounded
 *   owner 15, or assignee 10
 *   decision 30, or action 20
 *   blocked 25
 *   recent activity 10, or stale -5
 *
 * It is applied to every item, it is mirrored server-side, and the attention
 * sections are already sorted by it. The feed simply never looked. Fourteen
 * separate severity expressions could each have been graded by hand instead;
 * this reads one number that already accounts for all of them and stays correct
 * when a collector changes.
 *
 * ── Why a lift, and why it saturates ──────────────────────────────────────
 *
 * A lift on the type's own floor rather than an absolute base, because a late
 * project is still workflow. It is the loudest workflow there is, and it should
 * not become a decision.
 *
 * Saturating rather than linear, because the overdue term has no ceiling: a
 * project a hundred days late scores over a thousand and would swamp every
 * other card in the product. `researchBaseFor` in `lib/research/case-state`
 * solved the same problem the same way and states the reason — past some point
 * a bigger number does not change what the reader does about it.
 */

import { baseFor } from './feed-priority'
import type { SignalType } from './contract'

/** One entry of `AttentionItem.score_breakdown`. */
export interface ScoreTerm {
  key: string
  value: number
}

/**
 * The score at which an item has earned half of the lift.
 *
 * Read off `calculateScore` rather than chosen. The severely-overdue line the
 * product already draws is `SEVERELY_OVERDUE_DAYS`, fourteen days, and the
 * overdue term is ten points a day — so 140 is where the attention system
 * itself says an item has become serious. That is the natural midpoint.
 *
 * ── Why half, and why the curve never flattens ────────────────────────────
 *
 * The obvious shape is `researchBaseFor`'s: rise to a severe value, then flat.
 * It was tried here and it is wrong for this input. Flattening at fourteen days
 * makes every item past two weeks late identical again — and those are exactly
 * the items whose order the reader most needs, so the tie-break falls back to a
 * SHA-256 digest precisely where it matters most. A desk carries overdue work
 * running from one day to three months.
 *
 * `m / (m + HALF_STRENGTH)` compresses without ever repeating itself. It is
 * bounded below one by construction, so the lift stays inside its span, and it
 * is strictly monotone, so no two magnitudes ever tie. What it gives up is a
 * hard ceiling, which is not wanted here: a project a year late SHOULD still
 * edge one three months late, just barely.
 *
 *   45   an ordinary loud item, raised today   0.24
 *   140  two weeks late                        0.50
 *   300  a month late                          0.68
 *   1000 three months late                     0.88
 */
const HALF_STRENGTH = 140

/**
 * How much of the base one attention item's own magnitude may move.
 *
 * Bounded so lateness orders a family without inverting the type table.
 * `project_overdue` sits at 0.60 and `awaiting_review` at 0.50 in tier 3; the
 * review tier above them starts at `crowding` 0.55 and runs to `recommendation`
 * 0.90. A tenth lets a maximally overdue project reach 0.70 — clear of every
 * other workflow card, level with `research_stale`, and never near a
 * recommendation.
 *
 * In total-score terms that is 0.40 × 0.10 = 0.04 of spread inside a family,
 * about a third of severity's entire span, and it is monotone in the score
 * rather than banded — so eighteen overdue items get eighteen distinct places
 * instead of one and a hash.
 */
const STRENGTH_LIFT = 0.10

/**
 * The severity term, removed before the rest is normalised.
 *
 * `rankFeed` applies severity itself, through `SEVERITY_URGENCY` and the
 * urgency weight. Leaving it in the number that feeds `base` would count the
 * same fact twice, once in each component, and would make a critical card's
 * advantage over an informational one depend on which of two unrelated
 * constants happened to be larger.
 *
 * The breakdown carries it under its own key, so it comes out cleanly rather
 * than by re-deriving the multiplier here.
 */
const SEVERITY_KEY = 'severity'

/**
 * The part of an attention score that is about the item rather than its
 * severity band.
 *
 * Falls back to the whole score when no breakdown is present. A missing
 * breakdown is a row that came from somewhere this code does not know about,
 * and counting severity twice is a smaller error than discarding the magnitude
 * altogether.
 */
export function attentionMagnitude(
  score: number | null | undefined,
  breakdown?: readonly ScoreTerm[] | null,
): number {
  if (score == null || !Number.isFinite(score)) return 0
  const severity = breakdown?.find(t => t.key === SEVERITY_KEY)?.value ?? 0
  return Math.max(0, score - severity)
}

/**
 * An attention item's base, or null where there is nothing to say.
 *
 * Null rather than the type's floor, so the caller can leave `base` undefined
 * and let `priorityFor` read the table as it always has. An item with no score
 * must rank exactly where it ranks today.
 */
export function attentionBase(
  type: SignalType,
  score: number | null | undefined,
  breakdown?: readonly ScoreTerm[] | null,
): number | null {
  const magnitude = attentionMagnitude(score, breakdown)
  if (magnitude <= 0) return null
  const span = magnitude / (magnitude + HALF_STRENGTH)
  return Math.min(baseFor(type) + span * STRENGTH_LIFT, 1)
}
