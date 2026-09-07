/**
 * How loud a portfolio-lens finding is, for RANKING.
 *
 * ── Why this exists, and why it is not simply the card's severity ─────────
 *
 * For most lens families the card and the ranker agree, because both read the
 * same expression from the same row. Target-hit is the exception and it is a
 * real one:
 *
 *   buildTargetHitCard    b.overshootPct >= 0.1                → critical
 *   rankInputFor          |b.overshootPct * 100| >= 15         → critical
 *
 * Ten percent against fifteen. A position eleven percent past its target
 * therefore renders with a critical accent rail and ranks as `attention`, and
 * neither number is written down anywhere the other can see. That divergence is
 * reported rather than resolved here: picking one would move real cards, either
 * in the feed or on the rail, and this stage is a ranking correction with a
 * named scope.
 *
 * What this module does is give the RANKING answer one home, so the tile engine
 * can carry production's figure instead of guessing which of the two a card
 * meant. `MobileDashboard` and `lib/tile-engine/adopt/producers` both call it,
 * and a future decision to unify the two thresholds is then a change to one
 * function rather than a hunt.
 *
 * Pure. No React, no Supabase, no clock.
 */

import type { Severity } from './contract'
import { MATERIAL_DEVIATION_PCT } from './thresholds'

/**
 * A target reached, as the feed ranks it.
 *
 * `MATERIAL_DEVIATION_PCT` rather than a bare 15: the ranker's own comparison
 * was that constant's value all along, and naming it is what keeps the two
 * from drifting apart the next time the desk revisits what "material" means.
 */
export function targetHitRankSeverity(overshootPct: number): Severity {
  return Math.abs(overshootPct * 100) >= MATERIAL_DEVIATION_PCT ? 'critical' : 'attention'
}

/**
 * A target past its horizon.
 *
 * The card and the ranker agree here — both are `overdueMonths >= 6` — so this
 * is one expression with two callers rather than a reconciliation. Named
 * alongside its neighbour so the pair can be read together, which is how the
 * target-hit divergence became visible at all.
 */
export const STALE_TARGET_CRITICAL_MONTHS = 6

export function staleTargetSeverity(overdueMonths: number): Severity {
  return overdueMonths >= STALE_TARGET_CRITICAL_MONTHS ? 'critical' : 'attention'
}
