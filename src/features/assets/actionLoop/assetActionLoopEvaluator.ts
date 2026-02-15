/**
 * assetActionLoopEvaluator — Pure evaluator for the "Needs Attention" engine.
 *
 * Returns structured ActionItem[] for 6 MVP triggers across 3 categories:
 *
 *   Process (workflow stuck):
 *     P1: Proposal Stalled — deciding stage with no decision for N days
 *     P2: Idea Not Simulated — idea exists but never run through Trade Lab
 *     P3: Execution Not Confirmed — approved but not logged as executed
 *
 *   Alpha (ignored signals):
 *     A1: Opportunity — High EV, no active idea
 *
 *   Risk (drift / staleness):
 *     R1: Thesis Stale — thesis not updated for 90d (orange) or 180d (red)
 *     R2: Rating Changed, No Follow-up — rating changed but no idea created after
 *
 * Conflict prevention (strictly enforced):
 *   - A1 (no idea) CANNOT fire if activeIdeaCount > 0
 *   - A1 suppressed if any process item fires (workflow already in motion)
 *   - P2 (idea not simulated) CANNOT fire if unsimulatedIdeas is empty
 *   - P3 (execution not confirmed) CANNOT fire if unexecutedApprovals is empty
 *
 * Priority ordering (deterministic):
 *   Red+Process → Red+Risk → Orange+Process → Orange+Risk → Orange+Alpha → Gray
 *   Within same group: age descending, then id ascending (tiebreak).
 *
 * Metadata: all context (portfolio, age, amounts) goes into structured chips.
 * Descriptions are short declarative statements with no embedded data.
 *
 * No side effects, no DB calls. UI renders exactly what this returns.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionSeverity = 'red' | 'orange' | 'gray'

export type ActionCategory = 'process' | 'alpha' | 'risk'

export type ActionItemType =
  | 'proposal_stalled'         // P1
  | 'idea_not_simulated'       // P2
  | 'execution_not_confirmed'  // P3
  | 'opportunity_no_idea'      // A1
  | 'thesis_stale'             // R1
  | 'rating_no_followup'       // R2

export interface MetaChip {
  label: string
  variant: 'default' | 'warning' | 'danger'
}

export interface ActionItemAction {
  label: string
  actionKey: string
}

export interface ActionItem {
  id: string
  type: ActionItemType
  severity: ActionSeverity
  category: ActionCategory
  title: string
  description: string
  meta: MetaChip[]
  primaryAction: ActionItemAction
  secondaryAction?: ActionItemAction
  dismissible: boolean
  ageDays: number
}

// ---------------------------------------------------------------------------
// Workflow Summary (pure computation, asset-scoped)
// ---------------------------------------------------------------------------

export type WorkflowStepStatus = 'done' | 'pending' | 'blocked' | 'none'

export interface WorkflowSummary {
  research: WorkflowStepStatus
  idea: WorkflowStepStatus
  proposal: WorkflowStepStatus
  decision: WorkflowStepStatus
  execution: WorkflowStepStatus
}

export interface WorkflowSummaryInput {
  thesisDaysStale: number | null
  activeIdeaCount: number
  simulatedIdeaCount: number
  stalledProposalCount: number
  unexecutedApprovalCount: number
  completedExecutionCount: number
}

export function computeWorkflowSummary(input: WorkflowSummaryInput): WorkflowSummary {
  return {
    research: input.thesisDaysStale === null
      ? 'none'
      : input.thesisDaysStale >= 90
        ? 'pending'
        : 'done',
    idea: input.activeIdeaCount === 0 ? 'none' : 'done',
    proposal: input.activeIdeaCount === 0
      ? 'none'
      : input.simulatedIdeaCount > 0
        ? 'done'
        : 'pending',
    decision: input.stalledProposalCount > 0
      ? 'blocked'
      : (input.unexecutedApprovalCount > 0 || input.completedExecutionCount > 0)
        ? 'done'
        : 'none',
    execution: input.unexecutedApprovalCount > 0
      ? 'blocked'
      : input.completedExecutionCount > 0
        ? 'done'
        : 'none',
  }
}

// ---------------------------------------------------------------------------
// Evaluator Input
// ---------------------------------------------------------------------------

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

export interface RatingChange {
  ratingId: string
  oldValue: string
  newValue: string
  changedAt: string   // ISO date
  changedBy: string
  daysSince: number
}

export interface EvaluatorInput {
  /** A1: Opportunity */
  expectedReturn: number | null
  hasEVData: boolean
  activeIdeaCount: number
  evThreshold?: number

  /** P2: Idea Not Simulated */
  unsimulatedIdeas: UnsimulatedIdea[]

  /** P1: Proposal Stalled */
  stalledProposals: StalledProposal[]

  /** P3: Execution Not Confirmed */
  unexecutedApprovals: UnexecutedApproval[]

  /** R1: Thesis Stale */
  thesisDaysStale: number | null  // null = no thesis exists

  /** R2: Rating Changed, No Follow-up */
  ratingChangesWithoutFollowup: RatingChange[]
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Minimum absolute EV return to fire A1 */
const DEFAULT_EV_THRESHOLD = 0.15

/** Minimum days pending to fire P1 */
export const STALLED_DAYS_THRESHOLD = 3

/** Thesis staleness thresholds for R1 */
const THESIS_STALE_ORANGE_DAYS = 90
const THESIS_STALE_RED_DAYS = 180

/** Rating change lookback window for R2 */
const RATING_FOLLOWUP_WINDOW_DAYS = 14

// ---------------------------------------------------------------------------
// Deterministic priority ordering
// ---------------------------------------------------------------------------

const GROUP_RANK: Record<string, number> = {
  'red:process': 0,
  'red:risk': 1,
  'red:alpha': 2,
  'orange:process': 3,
  'orange:risk': 4,
  'orange:alpha': 5,
  'gray:process': 6,
  'gray:risk': 7,
  'gray:alpha': 8,
}

function getGroupRank(severity: ActionSeverity, category: ActionCategory): number {
  return GROUP_RANK[`${severity}:${category}`] ?? 99
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateActionLoop(input: EvaluatorInput): ActionItem[] {
  const items: ActionItem[] = []
  const threshold = input.evThreshold ?? DEFAULT_EV_THRESHOLD

  // Track which triggers fire for contradiction prevention
  let hasProcessItem = false

  // ---- P3: Execution Not Confirmed — RED ----
  if (input.unexecutedApprovals.length > 0) {
    const item = input.unexecutedApprovals[0]
    items.push({
      id: `p3-${item.id}`,
      type: 'execution_not_confirmed',
      severity: 'red',
      category: 'process',
      title: 'Execution Not Confirmed',
      description: 'Approved trade has not been logged as executed.',
      meta: [
        { label: `Portfolio: ${item.portfolio}`, variant: 'default' },
        { label: `Action: ${capitalize(item.action)}`, variant: 'danger' },
      ],
      primaryAction: { label: 'Confirm', actionKey: 'OPEN_CONFIRM_EXECUTION' },
      dismissible: false,
      ageDays: 0,
    })
    hasProcessItem = true
  }

  // ---- P1: Proposal Stalled — RED ----
  const stalledAboveThreshold = input.stalledProposals.filter(
    p => p.daysPending >= STALLED_DAYS_THRESHOLD,
  )
  if (stalledAboveThreshold.length > 0) {
    const item = stalledAboveThreshold[0]
    items.push({
      id: `p1-${item.id}`,
      type: 'proposal_stalled',
      severity: 'red',
      category: 'process',
      title: 'Proposal Awaiting Decision',
      description: 'Proposal pending longer than expected.',
      meta: [
        { label: `Portfolio: ${item.portfolio}`, variant: 'default' },
        { label: `Age: ${item.daysPending}d`, variant: 'danger' },
      ],
      primaryAction: { label: 'Review', actionKey: 'OPEN_PROPOSAL_REVIEW' },
      dismissible: false,
      ageDays: item.daysPending,
    })
    hasProcessItem = true
  }

  // ---- P2: Idea Not Simulated — ORANGE ----
  // Conflict: cannot fire if unsimulatedIdeas is empty (trivially handled by length check)
  if (input.unsimulatedIdeas.length > 0) {
    const count = input.unsimulatedIdeas.length
    items.push({
      id: `p2-unsimulated`,
      type: 'idea_not_simulated',
      severity: 'orange',
      category: 'process',
      title: 'Idea Not Simulated',
      description: 'Trade idea created without portfolio impact test.',
      meta: [
        { label: `Count: ${count} idea${count !== 1 ? 's' : ''}`, variant: 'warning' },
      ],
      primaryAction: { label: 'Simulate', actionKey: 'OPEN_TRADE_LAB_SIMULATION' },
      dismissible: true,
      ageDays: 0,
    })
    hasProcessItem = true
  }

  // ---- R1: Thesis Stale — ORANGE or RED ----
  if (input.thesisDaysStale != null && input.thesisDaysStale >= THESIS_STALE_ORANGE_DAYS) {
    const severity: ActionSeverity =
      input.thesisDaysStale >= THESIS_STALE_RED_DAYS ? 'red' : 'orange'
    items.push({
      id: `r1-thesis-stale`,
      type: 'thesis_stale',
      severity,
      category: 'risk',
      title: 'Thesis May Be Stale',
      description: 'Research thesis has not been updated recently.',
      meta: [
        { label: `Age: ${input.thesisDaysStale}d`, variant: severity === 'red' ? 'danger' : 'warning' },
      ],
      primaryAction: { label: 'Update Thesis', actionKey: 'OPEN_UPDATE_THESIS' },
      dismissible: severity !== 'red',
      ageDays: input.thesisDaysStale,
    })
  }

  // ---- R2: Rating Changed, No Follow-up — ORANGE ----
  if (input.ratingChangesWithoutFollowup.length > 0) {
    const change = input.ratingChangesWithoutFollowup[0]
    if (change.daysSince <= RATING_FOLLOWUP_WINDOW_DAYS) {
      items.push({
        id: `r2-${change.ratingId}`,
        type: 'rating_no_followup',
        severity: 'orange',
        category: 'risk',
        title: 'Rating Changed, No Follow-up',
        description: 'Rating changed without a corresponding trade idea.',
        meta: [
          { label: `From: ${change.oldValue}`, variant: 'default' },
          { label: `To: ${change.newValue}`, variant: 'warning' },
          { label: `Changed: ${change.daysSince}d ago`, variant: 'default' },
        ],
        primaryAction: { label: 'Create Idea', actionKey: 'OPEN_CREATE_IDEA' },
        dismissible: true,
        ageDays: change.daysSince,
      })
    }
  }

  // ---- A1: Opportunity — ORANGE ----
  // Conflict: suppress if activeIdeaCount > 0 OR any process item fires
  if (
    !hasProcessItem &&
    input.hasEVData &&
    input.expectedReturn != null &&
    Math.abs(input.expectedReturn) >= threshold &&
    input.activeIdeaCount === 0
  ) {
    const evPct = Math.abs(input.expectedReturn * 100).toFixed(0)
    const direction = input.expectedReturn > 0 ? 'upside' : 'downside'
    items.push({
      id: `a1-opportunity`,
      type: 'opportunity_no_idea',
      severity: 'orange',
      category: 'alpha',
      title: 'Opportunity: No Active Idea',
      description: 'Model implies significant expected value with no trade idea.',
      meta: [
        { label: `EV: ${evPct}% ${direction}`, variant: 'warning' },
      ],
      primaryAction: { label: 'Create Idea', actionKey: 'OPEN_CREATE_IDEA' },
      dismissible: true,
      ageDays: 0,
    })
  }

  // Deterministic sort: group rank ASC → age DESC → id ASC
  items.sort((a, b) => {
    const rankA = getGroupRank(a.severity, a.category)
    const rankB = getGroupRank(b.severity, b.category)
    if (rankA !== rankB) return rankA - rankB
    if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays
    return a.id.localeCompare(b.id)
  })

  return items
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
