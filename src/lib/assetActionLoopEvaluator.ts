/**
 * assetActionLoopEvaluator — Pure evaluator for Action Loop cards.
 *
 * Returns structured ActionCard[] for exactly 4 MVP triggers:
 *   A. Opportunity: High EV, no active idea
 *   B. Workflow Gap: Idea created but not simulated
 *   C. Decision Stalled: Proposal pending too long
 *   D. Execution Not Confirmed: Approved but not logged
 *
 * No side effects, no DB calls. UI renders exactly what this returns.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CardSeverity = 'red' | 'orange'

export type CardType =
  | 'opportunity_no_idea'
  | 'idea_not_simulated'
  | 'proposal_stalled'
  | 'execution_not_confirmed'

export interface ActionCard {
  type: CardType
  severity: CardSeverity
  title: string
  description: string
  primaryAction: { label: string; action: string }
}

export interface UnsimulatedIdea {
  id: string
  action: string
  rationale: string
}

export interface StalledProposal {
  id: string
  action: string
  portfolio: string
  daysPending: number
}

export interface UnexecutedApproval {
  id: string
  action: string
  portfolio: string
}

export interface EvaluatorInput {
  /** Trigger A */
  expectedReturn: number | null
  hasEVData: boolean
  activeIdeaCount: number
  evThreshold?: number

  /** Trigger B */
  unsimulatedIdeas: UnsimulatedIdea[]

  /** Trigger C */
  stalledProposals: StalledProposal[]

  /** Trigger D */
  unexecutedApprovals: UnexecutedApproval[]
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Minimum absolute EV return to fire Trigger A */
const DEFAULT_EV_THRESHOLD = 0.15

/** Minimum days pending to fire Trigger C */
export const STALLED_DAYS_THRESHOLD = 3

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateActionLoop(input: EvaluatorInput): ActionCard[] {
  const cards: ActionCard[] = []
  const threshold = input.evThreshold ?? DEFAULT_EV_THRESHOLD

  // D: Execution Not Confirmed — RED (highest priority)
  if (input.unexecutedApprovals.length > 0) {
    const item = input.unexecutedApprovals[0]
    const actionLabel = capitalize(item.action)
    cards.push({
      type: 'execution_not_confirmed',
      severity: 'red',
      title: 'Execution Not Confirmed',
      description: `Approved ${actionLabel} in ${item.portfolio} has not been logged as executed.`,
      primaryAction: { label: 'Confirm Execution', action: 'confirm_execution' },
    })
  }

  // C: Proposal Stalled — RED
  const stalledAboveThreshold = input.stalledProposals.filter(
    p => p.daysPending >= STALLED_DAYS_THRESHOLD,
  )
  if (stalledAboveThreshold.length > 0) {
    const item = stalledAboveThreshold[0]
    cards.push({
      type: 'proposal_stalled',
      severity: 'red',
      title: 'Proposal Awaiting Decision',
      description: `Proposal pending for ${item.daysPending} day${item.daysPending !== 1 ? 's' : ''}.`,
      primaryAction: { label: 'Review Proposal', action: 'review_proposal' },
    })
  }

  // A: Opportunity — ORANGE
  if (
    input.hasEVData &&
    input.expectedReturn != null &&
    Math.abs(input.expectedReturn) >= threshold &&
    input.activeIdeaCount === 0
  ) {
    const evPct = Math.abs(input.expectedReturn * 100).toFixed(0)
    const direction = input.expectedReturn > 0 ? 'upside' : 'downside'
    cards.push({
      type: 'opportunity_no_idea',
      severity: 'orange',
      title: 'Opportunity: No Active Idea',
      description: `Model implies ${evPct}% ${direction} but no trade idea exists.`,
      primaryAction: { label: 'Create Idea', action: 'create_idea' },
    })
  }

  // B: Idea Not Simulated — ORANGE
  if (input.unsimulatedIdeas.length > 0) {
    cards.push({
      type: 'idea_not_simulated',
      severity: 'orange',
      title: 'Idea Not Simulated',
      description: 'Idea created but no portfolio impact tested.',
      primaryAction: { label: 'Simulate in Trade Lab', action: 'open_trade_lab' },
    })
  }

  return cards
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
