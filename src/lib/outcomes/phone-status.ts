import type { DecisionIntelligence } from '../decision-intelligence'

/**
 * The status a phone card shows for a decision.
 *
 * Two verdict labels named the engine's category rather than what the reader
 * is being asked for:
 *
 *   needs_review  "Needs Context"  executed, and no matched trade has any
 *                                  rationale recorded (getReviewState)
 *   evaluate      "Monitoring"     rationale recorded, but no one has reviewed
 *                                  the outcome yet — and the row's action is
 *                                  "Review outcome", so it is not passive
 *
 * On a phone they read as what is missing. The verdict itself, its ordering,
 * urgency and every count are unchanged, and desktop keeps `verdictLabel`.
 */
export function phoneStatusLabel(intel: Pick<DecisionIntelligence, 'verdict' | 'verdictLabel'>): string {
  if (intel.verdict === 'needs_review') return 'Needs rationale'
  if (intel.verdict === 'evaluate') return 'Outcome not reviewed'
  return intel.verdictLabel
}

/** "1 Needs rationale · 1 Working", from each trade's phone status. */
export function phoneStatusMixText(items: ReadonlyArray<{ intel: DecisionIntelligence }>): string {
  const counts = new Map<string, number>()
  for (const { intel } of items) {
    const label = phoneStatusLabel(intel)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ')
}
