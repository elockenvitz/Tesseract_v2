/**
 * A candidate, drawn the way the current feed draws things.
 *
 * The contract deliberately says nothing about tiles, and Today renders
 * `DecisionItem`. Rather than redesign the renderer to prove the contract, the
 * adapter sits between them: producers move to candidates one at a time, and
 * the surface does not change until it is worth changing.
 *
 * That is the point of doing it this way round. If adapting a producer had
 * required touching Today, the first migration would have been a UI change
 * with a data change hidden inside it.
 */
import type { DecisionItem, DecisionSeverity } from '../../engine/decisionEngine/types'
import type { FeedCandidate } from './candidate'

/** The engine has no 'info'; it is the quietest thing it can say. */
function toEngineSeverity(s: FeedCandidate['severity']): DecisionSeverity {
  return s === 'info' ? 'yellow' : s
}

/**
 * Render one candidate as the feed item the current surfaces expect.
 *
 * `title` and the chips are the CALLER's business, because they are
 * presentation and the contract does not carry them. Everything that is
 * genuinely about the claim -- the id, the severity, the reason, when it
 * started, what can be done -- comes from the candidate unchanged.
 */
export function candidateToDecisionItem(
  candidate: FeedCandidate,
  presentation: {
    title: string
    titleKey: string
    category: DecisionItem['category']
    surface?: DecisionItem['surface']
    chips?: DecisionItem['chips']
    ctaLabels?: Record<string, string>
    decisionTier?: DecisionItem['decisionTier']
  },
): DecisionItem {
  return {
    // Straight through: the candidate's id IS the dismissal key, and an
    // adapter that decorated it would break suppression silently.
    id: candidate.id,
    surface: presentation.surface ?? 'action',
    severity: toEngineSeverity(candidate.severity),
    category: presentation.category,
    title: presentation.title,
    titleKey: presentation.titleKey,
    description: candidate.reason,
    chips: (presentation.chips ?? []).filter(c => c.value),
    context: {
      assetTicker: (candidate.facts?.assetSymbol as string) || undefined,
      portfolioName: (candidate.facts?.portfolioName as string) || undefined,
    },
    ctas: (candidate.actions ?? []).map(a => ({
      label: presentation.ctaLabels?.[a.actionKey] ?? a.actionKey,
      actionKey: a.actionKey,
      kind: 'primary' as const,
      payload: a.payload,
    })),
    dismissible: false,
    decisionTier: presentation.decisionTier ?? 'capital',
    // Ranking is the feed's, not the producer's. Zero is what every other
    // evaluator passes; the post-process stage scores them.
    sortScore: 0,
    createdAt: candidate.occurredAt,
  } as DecisionItem
}
