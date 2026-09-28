/**
 * System-derived urgency based on stage + staleness.
 *
 * Replaces manual urgency selection with automatic signals
 * that surface ideas needing attention.
 */

export type DerivedUrgency = 'needs_attention' | 'stale' | 'needs_decision' | 'delayed' | 'critical'

import { FINAL_STAGE, toIdeaStage } from './ideas/stage-model'

const SEVERITY_ORDER: Record<DerivedUrgency, number> = {
  needs_attention: 1,
  stale: 2,
  needs_decision: 3,
  delayed: 4,
  critical: 5,
}

/**
 * Two clocks, and which one an idea is on depends only on whether it is
 * waiting on somebody else.
 *
 * Before the end of the pipeline the idea is the analyst's own work, and
 * going quiet for a fortnight is unremarkable. At `ready_to_recommend` it is
 * being advocated, so silence means a decision is not being made and the
 * thresholds tighten to days.
 *
 * ── Why this reads the stage through `toIdeaStage` ────────────────────────
 *
 * This was a hardcoded set of five LEGACY labels, and the branch was
 * inverted by omission: `exploring`, `researching` and `developing` were not
 * in it, so every canonical idea fell through to the late-stage clock and
 * started reporting "Needs decision" after two days and "Critical" after
 * seven — on ideas nobody had been asked to decide.
 *
 * Expressed as a comparison against `FINAL_STAGE` rather than a list, so a
 * change to the pipeline cannot silently re-open the same gap. The signature
 * still takes `string` because callers pass a raw DB value, which during the
 * expand/contract window may be either vocabulary.
 */
export function getDerivedUrgency(stage: string, updatedAt: string): DerivedUrgency | null {
  const diffDays = (Date.now() - new Date(updatedAt).getTime()) / 86400000
  const awaitingDecision = toIdeaStage(stage) === FINAL_STAGE

  if (!awaitingDecision) {
    if (diffDays >= 28) return 'stale'
    if (diffDays >= 14) return 'needs_attention'
    return null
  }

  if (diffDays >= 7) return 'critical'
  if (diffDays >= 5) return 'delayed'
  if (diffDays >= 2) return 'needs_decision'
  return null
}

export function getUrgencySeverity(u: DerivedUrgency | null): number {
  return u ? SEVERITY_ORDER[u] : 0
}

export const DERIVED_URGENCY_CONFIG: Record<DerivedUrgency, { label: string; icon: string; color: string }> = {
  needs_attention: { label: 'Needs attention', icon: '⚠', color: 'text-yellow-600 dark:text-yellow-400' },
  stale:           { label: 'Stale',           icon: '⏳', color: 'text-orange-500 dark:text-orange-400' },
  needs_decision:  { label: 'Needs decision',  icon: '⚠', color: 'text-yellow-600 dark:text-yellow-400' },
  delayed:         { label: 'Delayed',         icon: '⏳', color: 'text-orange-500 dark:text-orange-400' },
  critical:        { label: 'Critical',        icon: '🔥', color: 'text-red-500 dark:text-red-400' },
}
