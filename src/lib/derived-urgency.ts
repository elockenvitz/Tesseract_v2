/**
 * System-derived urgency based on stage + staleness.
 *
 * Replaces manual urgency selection with automatic signals
 * that surface ideas needing attention.
 */

export type DerivedUrgency = 'needs_attention' | 'stale' | 'needs_decision' | 'delayed' | 'critical'

const EARLY_STAGES = new Set(['idea', 'aware', 'investigate', 'deep_research', 'thesis_forming'])

const SEVERITY_ORDER: Record<DerivedUrgency, number> = {
  needs_attention: 1,
  stale: 2,
  needs_decision: 3,
  delayed: 4,
  critical: 5,
}

export function getDerivedUrgency(stage: string, updatedAt: string): DerivedUrgency | null {
  const diffDays = (Date.now() - new Date(updatedAt).getTime()) / 86400000

  if (EARLY_STAGES.has(stage)) {
    if (diffDays >= 28) return 'stale'
    if (diffDays >= 14) return 'needs_attention'
    return null
  }

  // Late stages: ready_for_decision, deciding
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
