/**
 * Decision Timeline Types
 *
 * View model for the asset-level Decision Timeline.
 * This is a derived read model — no source-of-truth table.
 * Events are assembled from existing objects:
 *   - trade_queue_items (ideas)
 *   - trade_idea_portfolios (decisions)
 *   - trade_proposals (formal recommendations)
 *   - portfolio_trade_events (executions)
 *   - trade_event_rationales (post-trade rationale)
 *   - price_target_outcomes (forecast review)
 */

// ============================================================
// Event Types — meaningful milestones only
// ============================================================

export type TimelineEventType =
  | 'idea_created'          // Trade idea surfaced
  | 'idea_escalated'        // Idea moved to "deciding" stage
  | 'proposal_submitted'    // Formal sizing recommendation created
  | 'decision_accepted'     // PM accepted the idea for a portfolio
  | 'decision_rejected'     // PM rejected
  | 'decision_deferred'     // PM deferred
  | 'trade_executed'        // Position change recorded
  | 'outcome_evaluated'     // Price target hit/miss assessment

export type TimelinePhase =
  | 'exploratory'   // Ideas, early research
  | 'formal'        // Proposals, decisions
  | 'execution'     // Trades, rationale
  | 'review'        // Outcome assessment

export type TimelineDisposition =
  | 'positive'      // Buy/add/accepted/hit
  | 'negative'      // Sell/trim/rejected/missed
  | 'neutral'       // Informational
  | 'deferred'      // Deferred decisions

// ============================================================
// Timeline Event — the unified view model
// ============================================================

export interface DecisionTimelineEvent {
  /** Composite key: `${type}:${sourceId}` */
  id: string
  type: TimelineEventType
  phase: TimelinePhase
  timestamp: string

  // Display
  title: string
  subtitle: string | null

  // Actor
  actor: {
    name: string
    initials: string
  } | null

  // Portfolio context
  portfolio: {
    id: string
    name: string
  } | null

  // Quantitative details
  sizing: {
    action: string
    weightDelta: number | null
    sharesDelta: number | null
    weightBefore: number | null
    weightAfter: number | null
  } | null

  // Rationale folded into event (e.g. trade execution with rationale)
  rationale: string | null

  // Source object for navigation
  sourceRef: {
    type: 'trade_idea' | 'proposal' | 'trade_event' | 'outcome' | 'decision'
    id: string
  }

  // Visual hints
  disposition: TimelineDisposition
}

// ============================================================
// Phase filter for the timeline UI
// ============================================================

export type TimelineFilter = 'all' | TimelinePhase

// ============================================================
// Phase + type mappings (used by hook and UI)
// ============================================================

export const EVENT_PHASE: Record<TimelineEventType, TimelinePhase> = {
  idea_created: 'exploratory',
  idea_escalated: 'exploratory',
  proposal_submitted: 'formal',
  decision_accepted: 'formal',
  decision_rejected: 'formal',
  decision_deferred: 'formal',
  trade_executed: 'execution',
  outcome_evaluated: 'review',
}

export const EVENT_LABELS: Record<TimelineEventType, string> = {
  idea_created: 'Idea Created',
  idea_escalated: 'Escalated to Deciding',
  proposal_submitted: 'Proposal Submitted',
  decision_accepted: 'Accepted',
  decision_rejected: 'Rejected',
  decision_deferred: 'Deferred',
  trade_executed: 'Trade Executed',
  outcome_evaluated: 'Outcome Reviewed',
}
