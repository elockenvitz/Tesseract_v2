/**
 * How loud a portfolio-lens finding is.
 *
 * ── The discrepancy this file was created to hold, and now resolves ───────
 *
 * Target-hit had two thresholds:
 *
 *   buildTargetHitCard    b.overshootPct >= 0.1                → critical
 *   rankInputFor          |b.overshootPct * 100| >= 15         → critical
 *
 * Ten percent against fifteen, so a position eleven percent past its target
 * rendered with a critical accent rail and ranked as `attention`.
 *
 * ── Why 15 is canonical, from the product's own record ────────────────────
 *
 * `MATERIAL_DEVIATION_PCT` exists for exactly this, and its own comment says
 * so: "Matches the rule `scenarioGap.ts` already used to promote a card to
 * `critical`, lifted here so the ranking model and the card severity cannot
 * disagree about what 'materially through' means."
 *
 * That constant was introduced to end this class of disagreement, and
 * target-hit is the one family that was never migrated onto it. Three data
 * points and two of them are fifteen: the scenario card promotes at 15%, the
 * target-hit ranker promotes at `MATERIAL_DEVIATION_PCT`, and the target-hit
 * CARD promotes at an unnamed `0.1` that arrived with the original seven-kinds
 * migration carrying no rationale of its own.
 *
 * So this is not a threshold picked for convenience. It is the named constant
 * the product already keeps for "a price materially through a stated number",
 * applied to the one card that had drifted off it.
 *
 * ── Severity is a classification; magnitude is not ────────────────────────
 *
 * The scorer still receives the continuous overshoot as `deviationPct`, so how
 * far past the target a position is keeps ordering cards within the tier.
 * Only the CLASSIFICATION — is this material — is shared. The two were never
 * the same concept and this file does not make them one.
 *
 * Pure. No React, no Supabase, no clock.
 */

import type { Severity } from './contract'
import { MATERIAL_DEVIATION_PCT } from './thresholds'

/**
 * A target reached: the one derivation, for the card and for the ranker.
 *
 * Named without `Rank` because it is no longer a ranking-only answer. The
 * builder calls it too, which is the whole point.
 */
export function targetHitSeverity(overshootPct: number): Severity {
  return Math.abs(overshootPct * 100) >= MATERIAL_DEVIATION_PCT ? 'critical' : 'attention'
}

/**
 * A target past its horizon.
 *
 * The card and the ranker have always agreed here — both `overdueMonths >= 6` —
 * so this is one expression with two callers rather than a reconciliation.
 * Named alongside its neighbour so the pair reads together, which is how the
 * target-hit divergence became visible at all.
 */
export const STALE_TARGET_CRITICAL_MONTHS = 6

export function staleTargetSeverity(overdueMonths: number): Severity {
  return overdueMonths >= STALE_TARGET_CRITICAL_MONTHS ? 'critical' : 'attention'
}
