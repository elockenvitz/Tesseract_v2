/**
 * Decision Timeline Types
 *
 * View model for the asset-level Decision Timeline.
 * This is a derived read model — no source-of-truth table, no parallel event
 * graph. Every event is read from the record that already owns the fact:
 *
 *   trade_queue_items      the idea was raised
 *   decision_requests      a recommendation was submitted, and how the PM ruled
 *   accepted_trades        the decision was COMMITTED (the only committed trade)
 *   portfolio_trade_events the portfolio actually moved, with proof of how
 *   trade_event_rationales why, after the fact
 *   decision_reviews       the decision was reviewed
 *   price_target_outcomes  the forecast was scored (org-scoped since PR #252)
 *   memory_events          the thesis verb
 *
 * `trade_idea_portfolios.decision_outcome` is deliberately NOT read. It is
 * 95% blank in production (37 rows, 2 outcomes, zero reasons) and
 * `decision_requests` is what the PM's ruling is actually written to —
 * `useDesktopDecisions` already reads it that way.
 *
 * ── The four states this surface must keep apart ────────────────────────
 *
 * The whole point of the timeline is that these are not the same thing, and
 * a surface that blurs them is worse than no surface:
 *
 *   RECOMMENDED  a decision_request exists. Somebody asked.
 *   DECIDED      that request has a terminal status and a reviewed_at. The PM
 *                ruled. This is NOT execution and must never imply it.
 *   EXECUTED     an accepted_trade exists AND a portfolio_trade_event proves
 *                the book moved. Acceptance alone is a commitment, not a fill.
 *   REVIEWED     a decision_review or a scored price target exists.
 *
 * "Decided but not executed" is a real and common state — 4 accepted_trades
 * in production sit at `execution_status <> 'complete'` — so it gets its own
 * event rather than being rendered as if the trade happened.
 */

// ============================================================
// Event Types — meaningful milestones only
// ============================================================

export type TimelineEventType =
  | 'idea_created'          // Trade idea surfaced
  | 'idea_escalated'        // Idea moved to "deciding" stage
  | 'proposal_submitted'    // Formal sizing recommendation created
  | 'decision_accepted'     // PM accepted the request for a portfolio
  | 'decision_rejected'     // PM rejected
  | 'decision_deferred'     // PM deferred
  | 'decision_withdrawn'    // The requester withdrew it; nobody ruled
  | 'trade_committed'       // accepted_trades row — committed, not yet proven
  | 'execution_pending'     // committed and still NOT executed
  | 'trade_executed'        // portfolio_trade_events — the book moved
  | 'outcome_evaluated'     // Price target hit/miss assessment
  | 'review_recorded'       // decision_reviews — the decision was reviewed
  | 'thesis_changed'        // memory_events on the asset

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

/**
 * How well the claim "this executed" is actually supported.
 *
 * Read from `portfolio_trade_events`, never inferred from timestamps. The
 * writer stamps all three fields in `accepted-trade-service.ts` and
 * `EXECUTION_ORIGIN` (`:1448`) is the vocabulary:
 *
 *   verified      `detected_by_system = true` and `source_type = 'holdings_diff'`
 *                 — the app applied the trade and watched the position change.
 *   attested      `metadata.origin = 'trader_attested'` — a human states it
 *                 filled away from the app. Evidence, but not observation.
 *   assumed       `metadata.origin = 'pm_assumed_execution'` — PILOT POLICY:
 *                 the PM approved so we assumed a fill. Nobody observed one.
 *   backfilled    `metadata.origin = 'paper_execute_backfill'` — written by a
 *                 migration, not by a live execution. 33 rows in production.
 *   unattributed  the row predates provenance stamping (7 rows). We do not
 *                 know, and saying so is the honest rendering.
 *
 * Rendering `assumed` as though it were `verified` is the specific failure
 * this field exists to prevent: it would let the page assert a fill that no
 * system and no person ever saw.
 */
export type ExecutionProof =
  | 'verified'
  | 'attested'
  | 'assumed'
  | 'backfilled'
  | 'unattributed'

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
    type:
      | 'trade_idea'
      | 'proposal'
      | 'decision_request'
      | 'accepted_trade'
      | 'trade_event'
      | 'outcome'
      | 'decision'
      | 'review'
      | 'memory_event'
    id: string
  }

  /**
   * How well an execution claim is supported. Non-null ONLY on
   * `trade_executed`. Acceptance events leave it null on purpose: an
   * `accepted_trade` is a commitment, and attaching a proof grade to it
   * would imply the book moved.
   */
  executionProof: ExecutionProof | null

  /**
   * Where this row came from, carried so the UI can cite it and so a reader
   * can get back to the record of origin. Provenance is enforced on this
   * codebase: a figure a user sees must be traceable.
   */
  provenance: {
    /** The table the fact was read from. */
    table: string
    /** That row's id. */
    rowId: string
    /** Ids needed to navigate, when the source row is not the destination. */
    ideaId?: string | null
    portfolioId?: string | null
    batchId?: string | null
    acceptedTradeId?: string | null
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
  thesis_changed: 'exploratory',
  proposal_submitted: 'formal',
  decision_accepted: 'formal',
  decision_rejected: 'formal',
  decision_deferred: 'formal',
  decision_withdrawn: 'formal',
  // Commitment and execution are both the execution phase, but they stay
  // separate EVENTS so "committed, never filled" is visible rather than
  // collapsed into the trade that did not happen.
  trade_committed: 'execution',
  execution_pending: 'execution',
  trade_executed: 'execution',
  outcome_evaluated: 'review',
  review_recorded: 'review',
}

export const EVENT_LABELS: Record<TimelineEventType, string> = {
  idea_created: 'Idea Created',
  idea_escalated: 'Escalated to Deciding',
  thesis_changed: 'Thesis Changed',
  proposal_submitted: 'Recommendation Submitted',
  decision_accepted: 'Accepted',
  decision_rejected: 'Rejected',
  decision_deferred: 'Deferred',
  decision_withdrawn: 'Withdrawn',
  trade_committed: 'Trade Committed',
  execution_pending: 'Awaiting Execution',
  trade_executed: 'Trade Executed',
  outcome_evaluated: 'Outcome Reviewed',
  review_recorded: 'Decision Reviewed',
}

/** How each proof grade is named to a reader, and whether it asserts a fill. */
export const EXECUTION_PROOF_LABELS: Record<ExecutionProof, string> = {
  verified: 'Verified',
  attested: 'Attested',
  assumed: 'Assumed',
  backfilled: 'Backfilled',
  unattributed: 'Unattributed',
}

/**
 * Proof grades where a fill was actually OBSERVED. Only `verified` qualifies.
 * `attested` is a person's word, `assumed` is a policy, `backfilled` is a
 * migration and `unattributed` is an absence of record — none of them is an
 * observation, and a UI that treats them as one is making a claim the data
 * does not support.
 */
export const OBSERVED_PROOFS: readonly ExecutionProof[] = ['verified']

/** The `decision_requests.status` values that mean a PM actually ruled. */
export const TERMINAL_DECISION_STATUSES: readonly string[] = [
  'accepted',
  'accepted_with_modification',
  'rejected',
  'deferred',
]
