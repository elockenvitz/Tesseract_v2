/**
 * One name, two target findings, one question — and therefore one tile.
 *
 * ── Why this is the composition that matters ──────────────────────────────
 *
 * Adoption B established the rule and found nothing to apply it to: an expired
 * target, a broken framework and an unwritten thesis are three questions, so
 * three situations, so three tiles. Correct, and no reduction.
 *
 * Target Hit is the first adopted family that shares a question with one
 * already adopted. `reader-question` files `target_hit`, `target_expired` and
 * `no_target` under `target` and says why in its own header — three card types,
 * two categories, one question, and a composer keyed on the category "sees the
 * third as variety and lets the run through, which is exactly what a reader
 * complained about."
 *
 * And the pair is real. `usePortfolioLenses` walks its assets once and pushes
 * into `breaches` and `stale` from inside the same loop, so a name whose price
 * passed its base case while its horizon lapsed produces both rows on the same
 * pass. Today `composeFeed` gives that name two tiles and spaces them apart
 * with the `subject-run` and `recent-subject` penalties. Spacing is not the
 * answer to repetition; it is repetition with a gap in it.
 *
 * ── What composing does and does not change ───────────────────────────────
 *
 * One situation, one tile, one primary action — and no rank inflation, because
 * `situationPriorityInput` reads the lead and ignores corroboration. The
 * absorbed finding becomes supporting context on the survivor rather than
 * disappearing, which is the difference between composition and suppression.
 *
 * Pure. No React, no clock.
 */

import { composeSituations, corroborationCount, type Situation } from '../situation'
import type { SemanticFinding } from '../finding'
import type { SignalCard } from '../../signals/contract'
import type { CoverageRelevance } from '../../signals/coverage-relevance'
import type { StaleTarget, TargetBreach } from '../../../hooks/mobile/usePortfolioLenses'
import { staleTargetFinding, targetHitFinding } from './producers'

/** A lens row with the card production built from it. */
export interface LensPart<R> {
  row: R
  card: SignalCard
}

export interface TargetPair {
  assetId: string
  hit?: LensPart<TargetBreach> | null
  expired?: LensPart<StaleTarget> | null
}

/** Which of the two lens entries the feed should keep. */
export type TargetLensKind = 'breach' | 'stale'

export interface TargetComposition {
  assetId: string
  situation: Situation
  /** The entry that survives and renders. */
  lead: TargetLensKind
  /** The entry the feed should not also show. Null when there was only one. */
  absorbed: TargetLensKind | null
  /** How the lead was chosen, for the report and for a bug that disputes it. */
  because: string
}

const KIND_OF: Record<string, TargetLensKind> = {
  target_reached: 'breach',
  target_expired: 'stale',
}

/**
 * Compose whatever target findings this name has.
 *
 * Returns null when neither row produced a finding, which is a real outcome —
 * a row can fail its adapter's fact check — and never an error.
 */
export function composeTargetPair(
  pair: TargetPair,
  coverage: CoverageRelevance,
): TargetComposition | null {
  const findings: SemanticFinding[] = []

  if (pair.hit) {
    const r = targetHitFinding({ source: pair.hit.row, card: pair.hit.card, coverage })
    if (r.ok) findings.push(r.finding)
  }
  if (pair.expired) {
    const r = staleTargetFinding({ source: pair.expired.row, card: pair.expired.card, coverage })
    if (r.ok) findings.push(r.finding)
  }
  if (!findings.length) return null

  /**
   * One call, and it is the ordinary composer.
   *
   * Nothing here knows that these two findings are special. They compose
   * because they share a subject and a question, which is the only rule there
   * is — a target composition that needed its own merging logic would be a
   * second composer, and the next family would need a third.
   */
  const [situation] = composeSituations(findings)
  const lead = KIND_OF[situation.lead.kind]
  const absorbed = situation.supporting.length
    ? KIND_OF[situation.supporting[0].kind] ?? null
    : null

  return {
    assetId: pair.assetId,
    situation,
    lead,
    absorbed,
    because: describeLead(situation),
  }
}

/**
 * Why this finding leads, in one line.
 *
 * `compareFindings` is total and deterministic and decides in this order:
 * severity, then kind precedence, then recency, then id. Saying which step
 * actually decided is what makes "why is the hit on top" answerable without
 * reading the sort.
 */
function describeLead(s: Situation): string {
  if (!s.supporting.length) return `${s.lead.kind}: the only target finding on this name`
  const other = s.supporting[0]
  if (s.lead.severity !== other.severity) {
    return `${s.lead.kind} leads: ${s.lead.severity} outranks ${other.severity}`
  }
  return `${s.lead.kind} leads: equal severity, and a target reached is an event where an expired horizon is a clock`
}

/**
 * Which lens entry each name should give up, across the whole feed.
 *
 * Shaped like `claimedSubjects`/`suppressCoveredInsights` on purpose: the feed
 * already has one accepted "compute a drop-set, then filter" rule, and a second
 * one that looked different would invite a third that behaved differently.
 *
 * Only names carrying BOTH rows are considered, so the common case costs
 * nothing and no card is built for an asset that has one finding.
 */
export function absorbedTargetLenses(
  pairs: TargetPair[],
  coverageOf: (assetId: string) => CoverageRelevance,
): Map<string, TargetLensKind> {
  const out = new Map<string, TargetLensKind>()
  for (const p of pairs) {
    if (!p.hit || !p.expired) continue
    const composed = composeTargetPair(p, coverageOf(p.assetId))
    if (composed?.absorbed) out.set(p.assetId, composed.absorbed)
  }
  return out
}

/** How many findings stand behind the tile. */
export const findingsBehind = (c: TargetComposition): number => corroborationCount(c.situation)
