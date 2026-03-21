/**
 * Decision Outcomes Types
 *
 * Data contracts for the Decision Outcomes page.
 * Tracks the full lifecycle: Decision → Execution → Result / Impact.
 *
 * Decisions come from trade_queue_items at terminal stages.
 * Executions come from portfolio_trade_events.
 * Decision-time prices from decision_price_snapshots.
 * Results derived from snapshot/execution/current prices.
 *
 * METRIC HONESTY:
 * - decision_price: from decision_price_snapshots (DB-cached at approval time)
 * - execution_price: derived from trade event market_value / quantity (proxy)
 * - current_price: from assets table (DB-cached, may lag real-time)
 * - move_since_decision_pct: directionalized, from snapshot (proxy)
 * - move_since_execution_pct: directionalized, from proxy exec price (proxy)
 * - delay_cost_pct: directionalized, snapshot vs proxy exec price (proxy)
 *
 * SIZE-AWARE IMPACT:
 * - trade_notional: absolute change in position value from the trade event.
 *   Primary: |market_value_after - market_value_before|. Fallback: |quantity_delta * execution_price|.
 *   This is the best available measure of how large the trade was in dollar terms.
 * - weight_impact: weight_delta from trade event (portfolio weight change in %).
 *   Direct from DB where available. Null if not populated.
 * - impact_proxy: trade_notional * directionalized_move_pct / 100.
 *   Approximates the dollar-equivalent directional P&L of the decision.
 *   This is a PROXY, not exact P&L. It ignores fees, partial fills, and timing.
 * - weighted_delay_cost: trade_notional * delay_cost_pct / 100.
 *   Approximates dollar cost of execution delay.
 *
 * These are directional proxies, NOT exact P&L attribution.
 * Exact portfolio-level alpha requires position sizing + benchmark data.
 */

// ============================================================
// Direction / Stage / Result
// ============================================================

export type DecisionDirection = 'buy' | 'sell' | 'long' | 'short' | 'pair' | 'add' | 'trim' | 'unknown'

export type DecisionStage = 'approved' | 'rejected' | 'cancelled'

/**
 * Whether the market move since execution validated the decision direction.
 * - positive: price moved in the direction the decision intended
 * - negative: price moved against the decision direction
 * - neutral:  negligible move or insufficient data
 */
export type ResultDirection = 'positive' | 'negative' | 'neutral'

// ============================================================
// Execution Match Status
// ============================================================

/**
 * How a decision relates to actual portfolio actions:
 *
 * - executed:       Matched to a trade event via explicit link or confident fuzzy match
 * - pending:        Approved but no matching execution found yet (within reasonable window)
 * - possible_match: Fuzzy match found but low confidence — needs review
 * - unmatched:      Approved and past the expected execution window with no match
 * - not_applicable: Decision was rejected or cancelled — execution not expected
 */
export type ExecutionMatchStatus =
  | 'executed'
  | 'pending'
  | 'possible_match'
  | 'unmatched'
  | 'not_applicable'

// ============================================================
// Matched Execution (from portfolio_trade_events)
// ============================================================

export interface MatchedExecution {
  event_id: string
  event_date: string
  action_type: string
  source_type: string
  quantity_delta: number | null
  weight_delta: number | null
  asset_symbol?: string
  portfolio_name?: string
  /** How the match was found */
  match_method: 'explicit_link' | 'fuzzy_match'
  /** Rationale status on the trade event, if any */
  rationale_status?: string | null
  /** Has structured rationale been captured? */
  has_rationale: boolean
  /** First line of execution rationale (reason_for_action) if captured */
  execution_rationale_summary: string | null
  /** Days between decision approval and execution */
  lag_days: number | null
  /** Position value before execution (from trade event) */
  market_value_before: number | null
  /** Position value after execution (from trade event) */
  market_value_after: number | null
  /** Shares before execution */
  quantity_before: number | null
  /** Shares after execution */
  quantity_after: number | null
  /** Derived: approximate price per share at execution time */
  execution_price: number | null
  /** Portfolio weight before (from trade event, may be null) */
  weight_before: number | null
  /** Portfolio weight after (from trade event, may be null) */
  weight_after: number | null
}

// ============================================================
// Size basis — how the trade notional was determined
// ============================================================

export type SizeBasis = 'market_value_delta' | 'qty_times_price' | 'weight_only' | null

// ============================================================
// Accountability Row — the primary data object for the page
// ============================================================

export interface AccountabilityRow {
  /** trade_queue_item ID */
  decision_id: string
  created_at: string
  approved_at: string | null

  /** Decision info */
  direction: DecisionDirection
  stage: DecisionStage
  rationale_text: string | null

  /** Asset */
  asset_id: string | null
  asset_symbol: string | null
  asset_name: string | null

  /** Portfolio */
  portfolio_id: string | null
  portfolio_name: string | null

  /** People */
  owner_name: string | null
  approver_name: string | null

  /** Execution matching */
  execution_status: ExecutionMatchStatus
  matched_executions: MatchedExecution[]
  /** First execution's lag in days (for summary metrics) */
  execution_lag_days: number | null

  /** Age of the decision in days */
  days_since_decision: number | null

  // ── Price snapshot fields ─────────────────────────────────

  decision_price: number | null
  decision_price_at: string | null
  has_decision_price: boolean

  // ── Result / Impact fields ──────────────────────────────────

  current_price: number | null
  execution_price: number | null
  move_since_decision_pct: number | null
  move_since_execution_pct: number | null
  result_direction: ResultDirection | null
  delay_cost_pct: number | null

  // ── Size-aware impact fields (PROXY) ──────────────────────

  /**
   * Absolute dollar value of the trade. Primary: |mv_after - mv_before|.
   * Fallback: |qty_delta * execution_price|. Null if no sizing data.
   * This is the strongest available measure of trade magnitude.
   */
  trade_notional: number | null

  /**
   * How the trade_notional was determined.
   * 'market_value_delta' = from trade event market values (best quality)
   * 'qty_times_price' = derived from quantity_delta * execution_price (proxy)
   * 'weight_only' = only weight_delta available, no dollar sizing
   * null = no sizing data available
   */
  size_basis: SizeBasis

  /**
   * Portfolio weight change from the trade event (weight_delta).
   * Direct from DB. Null if not populated.
   */
  weight_impact: number | null

  /**
   * Dollar-equivalent directional impact proxy.
   * = trade_notional × (move_since_decision_pct or move_since_execution_pct) / 100
   * Positive = favorable impact. Negative = unfavorable.
   * PROXY — not exact P&L. Ignores fees, partial fills, benchmark.
   */
  impact_proxy: number | null

  /**
   * Dollar-equivalent delay cost proxy.
   * = trade_notional × delay_cost_pct / 100
   * Positive = delay cost money. Negative = delay saved money.
   * PROXY — not exact slippage.
   */
  weighted_delay_cost: number | null
}

// ============================================================
// Unmatched Execution — trade events with no linked decision
// ============================================================

export interface UnmatchedExecution {
  event_id: string
  event_date: string
  action_type: string
  source_type: string
  quantity_delta: number | null
  weight_delta: number | null
  asset_id: string
  asset_symbol: string | null
  asset_name: string | null
  portfolio_id: string
  portfolio_name: string | null
  status: string
  has_rationale: boolean
}

// ============================================================
// Summary Statistics
// ============================================================

export interface AccountabilitySummary {
  // ── Operational counts ──
  totalDecisions: number
  approvedCount: number
  rejectedCount: number
  cancelledCount: number
  executedCount: number
  pendingCount: number
  possibleMatchCount: number
  unmatchedCount: number
  avgLagDays: number | null
  unmatchedExecutionCount: number

  // ── Directional metrics (unweighted proxies) ──
  avgMoveSinceDecision: number | null
  avgMoveSinceExecution: number | null
  avgDelayCost: number | null
  positiveResultCount: number
  negativeResultCount: number
  executionRate: number | null
  snapshotCoverage: number

  // ── Size-aware impact metrics (weighted proxies) ──
  /** Sum of impact_proxy across all rows with data. Dollar-equivalent net impact. */
  netImpactProxy: number | null
  /** Sum of |weighted_delay_cost| — total dollar delay cost */
  totalWeightedDelayCost: number | null
  /** How many rows have trade_notional data */
  sizedDecisionCount: number
  /** Top positive impact row symbol (for quick reference) */
  topPositiveSymbol: string | null
  /** Top negative impact row symbol */
  topNegativeSymbol: string | null
  /** Executed decisions with no rationale at all */
  needsReviewCount: number
  /** Executed decisions with draft rationale (in progress) */
  reviewInProgressCount: number
  /** Executed decisions with complete or reviewed rationale */
  reviewCapturedCount: number
}

// ============================================================
// Filters
// ============================================================

export type ReviewFilter = 'all' | 'needs_review' | 'in_progress' | 'captured' | 'reviewed'

export interface AccountabilityFilters {
  dateRange: { start: string | null; end: string | null }
  portfolioIds: string[]
  ownerUserIds: string[]
  assetSearch: string
  showApproved: boolean
  showRejected: boolean
  showCancelled: boolean
  executionStatus: ExecutionMatchStatus[]
  resultFilter: 'all' | 'positive' | 'negative'
  directionFilter: DecisionDirection[]
  reviewFilter: ReviewFilter
}

export const DEFAULT_ACCOUNTABILITY_FILTERS: AccountabilityFilters = {
  dateRange: { start: null, end: null },
  portfolioIds: [],
  ownerUserIds: [],
  assetSearch: '',
  showApproved: true,
  showRejected: false,
  showCancelled: false,
  executionStatus: [],
  resultFilter: 'all',
  directionFilter: [],
  reviewFilter: 'all',
}
