/**
 * Desktop Ideas — scan order.
 *
 * ── Why not `rankIdeaCandidates` from the reconciled branch ───────────────
 *
 * It was read and deliberately not reused. Its `RankableIdea` contract is
 * `{ id, type, created_at, author, asset, reactionCounts }` — a FEED ranker,
 * answering "which post should lead a stream" from recency, coverage and
 * reactions. Ideas-as-investment-objects need decision readiness, materiality,
 * framework integrity and unresolved decisions, and none of those inputs exist
 * in that contract. Promoting it would mean inventing a `type` and faking
 * `reactionCounts` for every trade idea, and the tier would then be decided by
 * a translation nobody could read.
 *
 * `rankMixedCandidates` is rejected outright per the brief — it belongs to the
 * Cockpit presentation.
 *
 * What IS carried over is the discipline already proven twice in this codebase
 * (mobile `feed-priority`, then `lib/today/tiers`): TIER IS A HARD PARTITION
 * and score only orders within it. So an old, unchanged idea cannot lead
 * merely by being old, and a fresh trivial one cannot lead merely by being new.
 */

import type { IdeaEnrichment, IdeaRow } from './model'

/**
 * 0 someone is blocked on a decision
 * 1 ready to decide, and nobody has
 * 2 a view exists and is being formed
 * 3 still gathering
 */
export type IdeaTier = 0 | 1 | 2 | 3

export const IDEA_TIER_LABEL: Record<IdeaTier, string> = {
  0: 'being decided',
  1: 'ready to decide',
  2: 'thesis forming',
  3: 'researching',
}

const TIER_BY_MATURITY: Record<string, { tier: IdeaTier; base: number }> = {
  deciding: { tier: 0, base: 1.0 },
  decision_ready: { tier: 1, base: 0.9 },
  thesis_forming: { tier: 2, base: 0.6 },
  researching: { tier: 3, base: 0.4 },
}

const CONVICTION_WEIGHT: Record<string, number> = { high: 0.2, medium: 0.1, low: 0.02 }
const URGENCY_WEIGHT: Record<string, number> = { urgent: 0.25, high: 0.15, medium: 0.05, low: 0 }

/** Bands borrowed from mobile's materiality discipline, on the same shape. */
function materiality(weightPct: number | null | undefined): number {
  if (weightPct == null || !Number.isFinite(weightPct)) return 0.3
  if (weightPct <= 0) return 0.15
  if (weightPct < 1) return 0.25
  if (weightPct < 3) return 0.45
  if (weightPct < 5) return 0.6
  if (weightPct < 10) return 0.8
  return 1
}

/**
 * Recent meaningful change, as a bounded modifier.
 *
 * Bounded on purpose: it can break a tie between comparable ideas and can
 * never reorder tiers. `updated_at` is the only change signal available
 * without a history table, so this measures "touched recently", not "changed
 * meaningfully" — a limitation the evolution treatment states rather than
 * papering over.
 */
const CHANGE_MAX = 0.15
const CHANGE_DAYS = 21

function changeBoost(updatedAt: string | null, createdAt: string, now: number): number {
  const t = Date.parse(updatedAt ?? createdAt)
  if (!Number.isFinite(t)) return 0
  const days = (now - t) / 86_400_000
  if (days <= 0) return CHANGE_MAX
  if (days >= CHANGE_DAYS) return 0
  return CHANGE_MAX * (1 - days / CHANGE_DAYS)
}

export interface IdeaScore {
  tier: IdeaTier
  score: number
}

export function scoreIdea(
  idea: IdeaRow,
  e: IdeaEnrichment | undefined,
  now: number = Date.now(),
): IdeaScore {
  const { tier, base } = TIER_BY_MATURITY[idea.maturity] ?? { tier: 3 as IdeaTier, base: 0.3 }

  let score = base
  score += CONVICTION_WEIGHT[idea.conviction ?? ''] ?? 0
  score += URGENCY_WEIGHT[idea.urgency ?? ''] ?? 0
  score += materiality(e?.weightPct ?? idea.proposedWeight) * 0.25
  score += changeBoost(idea.updatedAt, idea.createdAt, now)

  // A framework the price has left is a real integrity gap, and it is worth
  // more than freshness — but it still cannot cross a tier.
  if (e?.ladder && e.spot != null) {
    const bull = Math.max(...e.ladder.cases.map(c => c.price))
    if (e.spot > bull) score += 0.3
  }

  return { tier, score }
}

/** Tier ascending, score descending, id for stability across renders. */
export function compareIdeas(
  a: { rank: IdeaScore; id: string },
  b: { rank: IdeaScore; id: string },
): number {
  if (a.rank.tier !== b.rank.tier) return a.rank.tier - b.rank.tier
  if (b.rank.score !== a.rank.score) return b.rank.score - a.rank.score
  return a.id.localeCompare(b.id)
}
