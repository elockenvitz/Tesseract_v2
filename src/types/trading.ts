/**
 * Trading Types
 *
 * Types for the Trade Queue and Simulation system
 */

// Enums matching database types
// Note: 'discussing' renamed to 'working_on', 'simulating' renamed to 'modeling' in new workflow
export type TradeQueueStatus = 'idea' | 'discussing' | 'simulating' | 'deciding' | 'working_on' | 'modeling' | 'approved' | 'rejected' | 'executed' | 'cancelled' | 'archived' | 'deleted'
export type TradeAction = 'buy' | 'sell' | 'trim' | 'add'
export type SimulationStatus = 'draft' | 'running' | 'completed' | 'archived'
export type TradeUrgency = 'low' | 'medium' | 'high' | 'urgent'
export type TradeVote = 'approve' | 'reject' | 'needs_discussion'
export type PairLegType = 'long' | 'short'

// Trade sizing modes
export type TradeSizingMode =
  | 'weight'          // Absolute weight %
  | 'shares'          // Absolute shares
  | 'delta_weight'    // +/- weight change
  | 'delta_shares'    // +/- shares change
  | 'delta_benchmark' // +/- vs benchmark (future)

export interface TradeSizing {
  mode: TradeSizingMode
  value: number | null
}

// New workflow types
// Stages: idea → working_on → modeling → deciding
export type TradeStage = 'idea' | 'working_on' | 'modeling' | 'deciding'
// Decision outcomes (set by PM/owner in deciding stage)
export type DecisionOutcome = 'accepted' | 'deferred' | 'rejected'
// Legacy outcome type for backwards compatibility
export type TradeOutcome = 'executed' | 'rejected' | 'deferred' | 'accepted'
export type VisibilityTier = 'active' | 'trash' | 'archive'

// Portfolio-scoped workflow track for a trade idea
export interface TradeIdeaPortfolio {
  id: string
  trade_queue_item_id: string
  portfolio_id: string
  stage: TradeStage
  decision_outcome: DecisionOutcome | null
  decision_reason: string | null
  decided_by: string | null
  decided_at: string | null
  deferred_until: string | null
  created_at: string
  updated_at: string
  // Joined data
  portfolio?: {
    id: string
    name: string
  }
}

// Aggregated portfolio track counts for UI display
export interface PortfolioTrackCounts {
  total: number           // Total portfolios linked to this idea
  active: number          // Portfolios with decision_outcome IS NULL
  committed: number       // Portfolios with decision_outcome = 'accepted'
  deferred: number        // Portfolios with decision_outcome = 'deferred'
  rejected: number        // Portfolios with decision_outcome = 'rejected'
}

// Input for updating a portfolio track decision
export interface UpdatePortfolioTrackInput {
  trade_queue_item_id: string
  portfolio_id: string
  decision_outcome: DecisionOutcome
  decision_reason?: string | null
  deferred_until?: string | null
}

// Input for changing a portfolio track stage
export interface UpdatePortfolioTrackStageInput {
  trade_queue_item_id: string
  portfolio_id: string
  stage: TradeStage
}

// UI action context for activity logging
export type UISource = 'drag_drop' | 'dropdown' | 'bulk_action' | 'api' | 'keyboard' | 'modal'

export interface ActionContext {
  actorId: string
  actorName: string
  actorEmail?: string
  actorRole: 'analyst' | 'pm' | 'admin' | 'system'
  requestId: string        // Idempotency key
  batchId?: string         // For bulk operations
  batchIndex?: number
  batchTotal?: number
  uiSource?: UISource
  note?: string
}

export interface MoveTarget {
  stage: TradeStage
  outcome?: TradeOutcome   // Required only when stage = 'deciding'
  deferredUntil?: string | null  // When a deferred idea should resurface
}

export interface StateSnapshot {
  stage: TradeStage
  outcome: TradeOutcome | null
  visibility_tier: VisibilityTier
  updated_at: string
}

// Pair Trade - groups related trades that should be executed together
export interface PairTrade {
  id: string
  portfolio_id: string
  name: string
  description: string
  rationale: string
  urgency: TradeUrgency
  status: TradeQueueStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PairTradeWithDetails extends PairTrade {
  portfolios: {
    id: string
    name: string
    portfolio_id: string | null
  }
  users?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  trade_queue_items?: TradeQueueItemWithDetails[]
}

// Trade Queue Item (Trade Idea)
export interface TradeQueueItem {
  id: string
  portfolio_id: string | null
  asset_id: string
  action: TradeAction
  proposed_shares: number | null
  proposed_weight: number | null
  target_price: number | null
  urgency: TradeUrgency
  priority: number
  rationale: string

  // Legacy status field (kept for backwards compatibility during migration)
  status: TradeQueueStatus

  // New workflow fields
  stage: TradeStage
  outcome: TradeOutcome | null
  outcome_at: string | null
  outcome_by: string | null
  outcome_note: string | null
  deferred_until: string | null  // When a deferred idea should resurface

  // Visibility/retention
  visibility_tier: VisibilityTier
  sharing_visibility: string | null
  deleted_at: string | null
  deleted_by: string | null
  archived_at: string | null
  previous_state: StateSnapshot | null

  // Ownership & timestamps
  created_by: string | null
  assigned_to: string | null  // Co-analyst/assignee who can also move stages
  collaborators: string[] | null  // Array of user IDs who are co-analysts
  created_at: string
  updated_at: string

  // Decision fields (PM/owner controlled)
  decision_outcome: DecisionOutcome | null
  decision_reason: string | null
  decided_by: string | null
  decided_at: string | null

  // Legacy approval fields (kept for backwards compat)
  approved_by: string | null
  approved_at: string | null
  executed_at: string | null

  // Pair trade linkage
  pair_trade_id: string | null
  pair_leg_type: PairLegType | null

  // Risk & Planning fields
  stop_loss: number | null
  take_profit: number | null
  conviction: 'low' | 'medium' | 'high' | null
  time_horizon: 'short' | 'medium' | 'long' | null

  // Context tags for entity-based categorization
  context_tags: Array<{
    entity_type: string
    entity_id: string
    display_name: string
  }> | null
}

// Trade Queue Item with related data
export interface TradeQueueItemWithDetails extends TradeQueueItem {
  assets: {
    id: string
    symbol: string
    company_name: string
    sector: string | null
  }
  portfolios: {
    id: string
    name: string
    portfolio_id: string | null
  }
  users?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  assigned_user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  } | null
  decided_by_user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  } | null
  trade_queue_comments?: TradeQueueComment[]
  trade_queue_votes?: TradeQueueVote[]
  vote_summary?: {
    approve: number
    reject: number
    needs_discussion: number
  }
  pair_trades?: PairTrade | null
}

// Trade Queue Comment
export interface TradeQueueComment {
  id: string
  trade_queue_item_id: string
  user_id: string
  content: string
  suggested_shares: number | null
  suggested_weight: number | null
  created_at: string
  updated_at: string
  is_edited: boolean
}

export interface TradeQueueCommentWithUser extends TradeQueueComment {
  users: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

// Trade Queue Vote
export interface TradeQueueVote {
  id: string
  trade_queue_item_id: string
  user_id: string
  vote: TradeVote
  comment: string | null
  created_at: string
}

export interface TradeQueueVoteWithUser extends TradeQueueVote {
  users: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

// Simulation visibility
export type SimulationVisibility = 'private' | 'team' | 'public'

// Simulation collaborator permission levels
export type SimulationPermission = 'view' | 'comment' | 'edit' | 'admin'

// Simulation collaborator
export interface SimulationCollaborator {
  id: string
  simulation_id: string
  user_id: string
  permission: SimulationPermission
  invited_by: string | null
  created_at: string
  updated_at: string
}

export interface SimulationCollaboratorWithUser extends SimulationCollaborator {
  users: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  invited_by_user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

// Simulation
export interface Simulation {
  id: string
  portfolio_id: string
  name: string
  description: string
  status: SimulationStatus
  baseline_holdings: BaselineHolding[]
  baseline_total_value: number
  result_metrics: SimulationMetrics
  created_by: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  is_collaborative: boolean
  visibility: SimulationVisibility
}

export interface SimulationWithDetails extends Simulation {
  portfolios: {
    id: string
    name: string
    portfolio_id: string | null
  }
  users?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  simulation_trades?: SimulationTradeWithDetails[]
  simulation_collaborators?: SimulationCollaboratorWithUser[]
}

// Baseline holding snapshot
export interface BaselineHolding {
  asset_id: string
  symbol: string
  company_name: string
  sector: string | null
  shares: number
  price: number
  value: number
  weight: number
}

// Simulation Trade
export interface SimulationTrade {
  id: string
  simulation_id: string
  trade_queue_item_id: string | null
  asset_id: string
  action: TradeAction
  shares: number | null
  weight: number | null
  price: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SimulationTradeWithDetails extends SimulationTrade {
  assets: {
    id: string
    symbol: string
    company_name: string
    sector: string | null
  }
  trade_queue_items?: TradeQueueItem | null
}

// Simulation Results/Metrics
export interface SimulationMetrics {
  // Portfolio Overview
  total_value_before: number
  total_value_after: number
  value_change: number
  value_change_pct: number

  // Position Changes
  positions_added: number
  positions_removed: number
  positions_adjusted: number

  // Sector Exposure
  sector_exposure_before: Record<string, number>
  sector_exposure_after: Record<string, number>
  sector_changes: Record<string, number>

  // Concentration Metrics
  top_5_concentration_before: number
  top_5_concentration_after: number
  top_10_concentration_before: number
  top_10_concentration_after: number
  herfindahl_index_before: number
  herfindahl_index_after: number

  // Risk Metrics (simplified - could be expanded)
  position_count_before: number
  position_count_after: number
  avg_position_size_before: number
  avg_position_size_after: number

  // Factor Tilts (simplified estimates)
  estimated_beta_before?: number
  estimated_beta_after?: number

  // Holdings breakdown
  holdings_after: SimulatedHolding[]
}

// Simulated holding after trades applied
export interface SimulatedHolding {
  asset_id: string
  symbol: string
  company_name: string
  sector: string | null
  shares: number
  price: number
  value: number
  weight: number
  change_from_baseline: number // Weight change
  is_new: boolean
  is_removed: boolean
  is_short: boolean // True if this is a short position (negative shares)
}

// Form types for creating/updating
export interface CreateTradeQueueItemInput {
  portfolio_id: string
  asset_id: string
  action: TradeAction
  proposed_shares?: number | null
  proposed_weight?: number | null
  target_price?: number | null
  urgency?: TradeUrgency
  rationale?: string
  pair_trade_id?: string | null
  pair_leg_type?: PairLegType | null
}

// Pair Trade Leg - for creating individual legs of a pair trade
export interface PairTradeLegInput {
  asset_id: string
  action: TradeAction
  proposed_shares?: number | null
  proposed_weight?: number | null
  target_price?: number | null
  pair_leg_type: PairLegType
}

// Create Pair Trade Input - for creating a complete pair trade with legs
export interface CreatePairTradeInput {
  portfolio_id: string
  name: string
  description?: string
  rationale?: string
  urgency?: TradeUrgency
  legs: PairTradeLegInput[]
}

export interface UpdateTradeQueueItemInput {
  action?: TradeAction
  proposed_shares?: number | null
  proposed_weight?: number | null
  target_price?: number | null
  urgency?: TradeUrgency
  status?: TradeQueueStatus
  priority?: number
  rationale?: string
  stop_loss?: number | null
  take_profit?: number | null
  conviction?: 'low' | 'medium' | 'high' | null
  time_horizon?: 'short' | 'medium' | 'long' | null
  context_tags?: Array<{
    entity_type: string
    entity_id: string
    display_name: string
  }> | null
  sharing_visibility?: 'private' | 'portfolio' | 'team' | 'public' | null
}

export interface CreateSimulationInput {
  portfolio_id: string
  name: string
  description?: string
  is_collaborative?: boolean
  visibility?: SimulationVisibility
}

export interface AddSimulationTradeInput {
  simulation_id: string
  trade_queue_item_id?: string | null
  asset_id: string
  action: TradeAction
  shares?: number | null
  weight?: number | null
  price?: number | null
}

// UI State types
export interface TradeQueueFilters {
  status?: TradeQueueStatus | 'all'
  urgency?: TradeUrgency | 'all'
  action?: TradeAction | 'all'
  portfolio_id?: string | 'all'
  created_by?: string | 'all'
  search?: string
}

export interface SimulationFilters {
  status?: SimulationStatus | 'all'
  portfolio_id?: string | 'all'
  search?: string
}

// Drag and drop types
export interface DragItem {
  id: string
  type: 'trade-queue-item' | 'simulation-trade'
  data: TradeQueueItemWithDetails | SimulationTradeWithDetails
}

// =============================================================================
// Trade Lab Proposal System Types
// =============================================================================

// Event types for trade_events table
export type TradeEventType =
  | 'created'           // Trade idea created
  | 'proposal_created'  // User created a proposal
  | 'proposal_updated'  // User updated their proposal
  | 'proposal_snapshot' // Proposal version saved
  | 'moved_to_deciding' // Trade moved to deciding stage
  | 'moved_to_simulating' // Trade moved to simulating
  | 'approved'          // Trade approved
  | 'rejected'          // Trade rejected
  | 'executed'          // Trade executed
  | 'sizing_changed'    // Sizing was changed
  | 'note_added'        // Note was added
  | 'status_changed'    // General status change

// Trade Lab Simulation Item - private sandbox membership
// Tracks which items are included in each user's private view
export interface TradeLabSimulationItem {
  id: string
  view_id: string
  trade_queue_item_id: string
  included: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

// Trade Proposal - one current editable proposal per user per trade idea per portfolio
export interface TradeProposal {
  id: string
  trade_queue_item_id: string
  user_id: string
  portfolio_id: string  // Required: Portfolio this proposal applies to
  lab_id: string | null
  weight: number | null
  shares: number | null
  sizing_mode: TradeSizingMode | null
  sizing_context: Record<string, unknown>
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TradeProposalWithUser extends TradeProposal {
  users: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  portfolio?: {
    id: string
    name: string
  }
}

// Trade Proposal Version - snapshots for version history
export interface TradeProposalVersion {
  id: string
  proposal_id: string
  portfolio_id: string | null  // Portfolio context at time of snapshot
  version_number: number
  weight: number | null
  shares: number | null
  sizing_mode: TradeSizingMode | null
  sizing_context: Record<string, unknown>
  notes: string | null
  trigger_event: 'moved_to_deciding' | 'manual_save' | 'before_update' | string | null
  created_at: string
  created_by: string | null
}

// Trade Event - event log for audit trail
export interface TradeEvent {
  id: string
  trade_queue_item_id: string
  event_type: TradeEventType
  actor_id: string | null
  metadata: Record<string, unknown>
  proposal_id: string | null
  proposal_version_id: string | null
  created_at: string
}

export interface TradeEventWithActor extends TradeEvent {
  users: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  } | null
}

// Input types for creating/updating proposals
export interface CreateTradeProposalInput {
  trade_queue_item_id: string
  portfolio_id: string  // Required: Portfolio this proposal applies to
  lab_id?: string | null
  weight?: number | null
  shares?: number | null
  sizing_mode?: TradeSizingMode | null
  sizing_context?: Record<string, unknown>
  notes?: string | null
}

export interface UpdateTradeProposalInput {
  weight?: number | null
  shares?: number | null
  sizing_mode?: TradeSizingMode | null
  sizing_context?: Record<string, unknown>
  notes?: string | null
}

// Input for creating events
export interface CreateTradeEventInput {
  trade_queue_item_id: string
  event_type: TradeEventType
  metadata?: Record<string, unknown>
  proposal_id?: string | null
  proposal_version_id?: string | null
}
