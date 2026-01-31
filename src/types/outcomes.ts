/**
 * Outcomes Types
 *
 * Data contracts for the Outcomes tab - tracking what happened after decisions were made.
 * MVP: OutcomeDecision is real and populated from existing trade idea data.
 * Future: ExecutionObservation, DecisionOutcomeLink, AnalystScorecard, ProcessSlippageEvent
 *         will be populated from holdings diffs and scoring engines.
 */

// ============================================================
// A) OutcomeDecision (MVP: real now)
// Represents an approved trade idea / decision
// ============================================================

export type DecisionDirection = 'buy' | 'sell' | 'long' | 'short' | 'pair' | 'add' | 'trim' | 'unknown'

export type DecisionStage =
  | 'idea'
  | 'discussing'
  | 'simulating'
  | 'deciding'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'deleted'

export type DecisionUrgency = 'low' | 'medium' | 'high' | 'urgent'

export interface RationaleSnapshot {
  summary?: string
  thesis?: string
  catalysts?: string[]
  risks?: string[]
  horizon?: string | null
}

export interface ForecastSnapshot {
  price_targets?: {
    target_price?: number
    target_date?: string
    upside_pct?: number
  }[]
  estimates?: {
    metric?: string
    value?: number
    period?: string
  }[]
  rating?: string
  as_of?: string
}

export interface OutcomeDecision {
  decision_id: string
  created_at: string
  approved_at: string | null
  approved_by_user_id: string | null
  approved_by_user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  } | null
  portfolio_id: string | null
  portfolio_name?: string
  asset_id: string | null
  asset_symbol?: string
  asset_name?: string
  direction: DecisionDirection
  urgency: DecisionUrgency | null
  stage: DecisionStage
  rationale_snapshot?: RationaleSnapshot | null
  linked_forecast_snapshot?: ForecastSnapshot | null
  owner_user_ids?: string[]
  owner_users?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }[]
  source_url?: string
  // Computed fields for UI
  has_rationale: boolean
  days_since_approved?: number
  execution_status: 'pending' | 'executed' | 'partial' | 'missed' | 'unknown'
}

// ============================================================
// B) ExecutionObservation (Framework: placeholder now)
// Represents inferred "what actually happened" from holdings diffs
// ============================================================

export type InferredDirection =
  | 'buy'
  | 'sell'
  | 'increase'
  | 'decrease'
  | 'open'
  | 'close'
  | 'unknown'

export interface ExecutionObservation {
  exec_id: string
  as_of_date: string
  portfolio_id: string
  portfolio_name?: string
  asset_id: string
  asset_symbol?: string
  asset_name?: string
  delta_shares?: number | null
  delta_value?: number | null
  inferred_direction?: InferredDirection
  source: 'holdings_diff'
  linked_decision_id?: string | null
  match_confidence?: number | null // 0..1
  match_explanation?: string[] | null
  detected_at: string
  // Computed
  is_matched: boolean
  is_discretionary: boolean
}

// ============================================================
// C) DecisionOutcomeLink (Framework: placeholder now)
// Represents the matching between decisions and executions
// ============================================================

export interface DecisionOutcomeLink {
  link_id: string
  decision_id: string
  exec_id: string
  match_confidence: number
  explanation: string[]
  created_at: string
  // Denormalized for convenience
  decision?: OutcomeDecision
  execution?: ExecutionObservation
}

// ============================================================
// D) AnalystScorecard (Framework: placeholder now)
// Represents aggregated accuracy / calibration / contribution
// ============================================================

export interface AnalystScorecard {
  user_id: string
  user_name?: string
  user_email?: string
  period_start: string
  period_end: string
  // Directional accuracy
  total_decisions: number
  directional_correct: number
  directional_hit_rate?: number | null // 0..1
  // Calibration (predicted probability vs actual outcome)
  calibration_score?: number | null // 0..1, higher is better
  // Price target accuracy
  avg_target_error_pct?: number | null
  median_target_error_pct?: number | null
  // Process metrics
  decision_to_exec_lag_days_avg?: number | null
  discretionary_count: number
  discretionary_rate?: number | null // 0..1
  // Value attribution
  estimated_alpha_contribution?: number | null
  // Notes
  notes?: string | null
}

// ============================================================
// E) ProcessSlippageEvent (Framework: placeholder now)
// Represents where alpha was lost by stage
// ============================================================

export type SlippageStage =
  | 'idea'
  | 'decision'
  | 'execution'
  | 'timing'
  | 'sizing'
  | 'other'

export interface ProcessSlippageEvent {
  slippage_id: string
  decision_id?: string | null
  portfolio_id?: string | null
  portfolio_name?: string
  asset_id?: string | null
  asset_symbol?: string
  stage: SlippageStage
  description: string
  estimated_impact_bps?: number | null
  estimated_impact_dollars?: number | null
  detected_at: string
  // Context
  idea_date?: string | null
  decision_date?: string | null
  execution_date?: string | null
  price_at_idea?: number | null
  price_at_decision?: number | null
  price_at_execution?: number | null
}

// ============================================================
// Filter and Query Types
// ============================================================

export interface OutcomeFilters {
  dateRange: {
    start: string | null
    end: string | null
  }
  portfolioIds: string[]
  ownerUserIds: string[]
  assetSearch: string
  stages: DecisionStage[]
  directions: DecisionDirection[]
  urgencies: DecisionUrgency[]
  showApproved: boolean
  showRejected: boolean
  showArchived: boolean
  hasRationale: boolean | null // null = show all
  executionStatus: ('pending' | 'executed' | 'partial' | 'missed' | 'unknown')[]
}

export const DEFAULT_OUTCOME_FILTERS: OutcomeFilters = {
  dateRange: {
    start: null, // Will be set to 90 days ago
    end: null,   // Will be set to today
  },
  portfolioIds: [],
  ownerUserIds: [],
  assetSearch: '',
  stages: ['approved'],
  directions: [],
  urgencies: [],
  showApproved: true,
  showRejected: false,
  showArchived: false,
  hasRationale: null,
  executionStatus: [],
}

// ============================================================
// Hook Return Types
// ============================================================

export interface OutcomeHookResult<T> {
  data: T
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
  isImplemented: boolean
}

// ============================================================
// Summary Statistics
// ============================================================

export interface OutcomeSummaryStats {
  totalDecisions: number
  approvedCount: number
  rejectedCount: number
  archivedCount: number
  pendingExecutionCount: number
  executedCount: number
  missedCount: number
  discretionaryCount: number
  avgLagDays: number | null
  directionalHitRate: number | null
}

// ============================================================
// Future: Holdings Diff Types (Framework only)
// ============================================================

/**
 * TODO: Implement holdings snapshot ingestion
 *
 * HoldingsSnapshot represents a point-in-time portfolio state
 * uploaded from external systems (custodian, broker, etc.)
 */
export interface HoldingsSnapshot {
  snapshot_id: string
  portfolio_id: string
  as_of_date: string
  uploaded_at: string
  uploaded_by_user_id: string
  source: string // e.g., 'manual_upload', 'api_sync', 'custodian_feed'
  positions: HoldingsPosition[]
}

export interface HoldingsPosition {
  asset_id: string
  asset_symbol: string
  shares: number
  market_value: number
  cost_basis?: number | null
  weight_pct?: number | null
}

/**
 * TODO: Implement holdings diff computation
 *
 * HoldingsDiff represents the change between two snapshots
 */
export interface HoldingsDiff {
  diff_id: string
  portfolio_id: string
  from_snapshot_id: string
  to_snapshot_id: string
  from_date: string
  to_date: string
  computed_at: string
  changes: HoldingsChange[]
}

export interface HoldingsChange {
  asset_id: string
  asset_symbol: string
  shares_before: number
  shares_after: number
  delta_shares: number
  value_before: number
  value_after: number
  delta_value: number
  change_type: 'open' | 'close' | 'increase' | 'decrease' | 'unchanged'
}
