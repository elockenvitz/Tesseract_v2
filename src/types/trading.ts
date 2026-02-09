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
  pair_id: string | null  // Groups multiple legs into a single pair trade
  pair_trade_id: string | null  // Legacy: links to pair_trades table
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

// Proposal type - distinguishes analyst proposals from PM-initiated decisions
export type ProposalType = 'analyst' | 'pm_initiated'

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
  proposal_type: ProposalType  // 'analyst' or 'pm_initiated'
  analyst_input_requested: boolean  // For PM-initiated proposals, whether analyst input is requested
  analyst_input_requested_at: string | null  // When analyst input was requested
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
  proposal_type?: ProposalType  // 'analyst' (default) or 'pm_initiated'
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

// =============================================================================
// Trade Lab v3 Types - Intent Variants & Sizing
// =============================================================================

// Re-export sizing types from parser
export type {
  SizingSpec,
  SizingFramework,
  ParseResult as SizingParseResult,
  SizingContext,
} from '../lib/trade-lab/sizing-parser'

// Portfolio roles for permission matrix
export type PortfolioRole = 'pm' | 'analyst' | 'trader' | 'viewer'

// Permission actions
export type PermissionAction =
  | 'create_variant'
  | 'edit_variant'
  | 'delete_variant'
  | 'resolve_queue_item'
  | 'create_trade_sheet'
  | 'approve_trade_sheet'
  | 'view_lab'

// Permission matrix type
export type PermissionMatrix = Record<PortfolioRole, PermissionAction[]>

// Default permission matrix
export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  pm: [
    'create_variant',
    'edit_variant',
    'delete_variant',
    'resolve_queue_item',
    'create_trade_sheet',
    'approve_trade_sheet',
    'view_lab',
  ],
  analyst: [
    'create_variant',
    'edit_variant',
    'delete_variant',
    'view_lab',
  ],
  trader: [
    'view_lab',
  ],
  viewer: [
    'view_lab',
  ],
}

// Rounding policy for lot sizes (v3 spec)
// 'allow_zero' - allow result to be 0 when computed shares < lot_size
// 'round_to_one_lot' - round up to at least one lot when shares would be 0
export type MinLotBehavior = 'allow_zero' | 'round_to_one_lot' | 'round' | 'zero' | 'warn'

// Rounding configuration (per portfolio or asset override)
// v3 spec: weight->shares conversion rounds toward zero (floor for +, ceil for -)
export interface RoundingConfig {
  lot_size: number              // Minimum lot size (e.g., 100 for round lots)
  min_lot_behavior: MinLotBehavior  // What to do when computed shares < lot_size
  zero_threshold?: number       // v3: Below this share count, treat as zero
  round_direction?: 'nearest' | 'up' | 'down' | 'toward_zero'  // How to round to lot boundaries (default: toward_zero for v3)
}

// Default rounding config (v3 spec: rounds toward zero)
export const DEFAULT_ROUNDING_CONFIG: RoundingConfig = {
  lot_size: 1,
  min_lot_behavior: 'allow_zero',
  zero_threshold: 0,
  round_direction: 'toward_zero',
}

// Active weight source (where benchmark weight comes from)
export type ActiveWeightSource = 'portfolio_benchmark' | 'custom' | 'index'

// Active weight configuration per asset
export interface ActiveWeightConfig {
  source: ActiveWeightSource
  benchmark_weight: number | null  // Current benchmark weight for this asset
  custom_benchmark_id?: string     // If source is 'custom', the benchmark ID
}

// Computed values from normalization
export interface ComputedValues {
  direction: 'buy' | 'sell'       // Normalized trade direction
  target_shares: number           // Final share count after trade
  target_weight: number           // Final weight % after trade
  delta_shares: number            // Change in shares (signed)
  delta_weight: number            // Change in weight % (signed)
  shares_change: number           // Alias for delta_shares (v3 spec: used for conflict detection)
  delta_active_weight?: number    // Change in active weight (if benchmark available)
  target_active_weight?: number   // Final active weight (if benchmark available)
  notional_value: number          // Dollar value of the trade
  price_used: number              // Price used for computation
  price_timestamp: string         // When price was fetched
}

// =============================================================================
// SIZING VALIDATION ERROR (v3 spec)
// =============================================================================

/**
 * Direction conflict error details.
 *
 * Per v3 spec: Conflict is detected when shares_change sign contradicts action.
 * - BUY/ADD + negative shares_change = CONFLICT
 * - SELL/TRIM + positive shares_change = CONFLICT
 * - shares_change === 0 is ALWAYS allowed (no conflict)
 *
 * The error includes a suggested_direction for one-click fix in the UI.
 */
export interface SizingValidationError {
  code: 'direction_conflict'
  message: string                 // Human-readable error (e.g., "BUY action conflicts with -50 share decrease")
  action: TradeAction             // The action that was attempted
  shares_change: number           // The computed shares_change that caused the conflict
  suggested_direction: TradeAction  // One-click fix: the action that would resolve conflict
  trigger: 'user_edit' | 'load_revalidation' | 'price_update'  // What caused the conflict to be detected
}

/**
 * Conflict trigger types for activity events.
 */
export type ConflictTrigger = 'user_edit' | 'load_revalidation' | 'price_update'

// Normalized sizing result (transient, computed on demand)
export interface NormalizedSizingResult {
  is_valid: boolean
  computed?: ComputedValues
  direction_conflict: SizingValidationError | null  // null = no conflict, object = conflict details
  below_lot_warning: boolean      // True if computed shares < lot_size
  rounded_shares?: number         // Shares after lot rounding (if applicable)
  error?: string                  // Error message if invalid
}

// Intent Variant - ephemeral scenario delta in Trade Lab
export interface IntentVariant {
  id: string
  lab_id: string
  view_id: string | null          // null = lab-wide, string = view-scoped
  trade_queue_item_id: string | null  // Source trade idea (if any)
  asset_id: string

  // User input
  action: TradeAction             // buy | sell | trim | add
  sizing_input: string            // Raw user input (e.g., "2.5", "+0.5", "@t0.5", "#500")
  sizing_spec: import('../lib/trade-lab/sizing-parser').SizingSpec | null  // Parsed sizing

  // Computed state (persisted for display, recomputed on price changes)
  computed: ComputedValues | null
  direction_conflict: SizingValidationError | null  // Persisted: null = no conflict, object = conflict details
  below_lot_warning: boolean      // Persisted: shares below lot size

  // Portfolio context
  portfolio_id: string
  current_position: {
    shares: number
    weight: number
    cost_basis: number | null
    active_weight: number | null
  } | null

  // Benchmark context (for active weight sizing)
  active_weight_config: ActiveWeightConfig | null

  // Metadata
  notes: string | null
  sort_order: number
  touched_in_lab_at: string | null  // v3: Last time this variant was modified in lab
  created_at: string
  updated_at: string
  created_by: string | null
}

// Intent Variant with related data
export interface IntentVariantWithDetails extends IntentVariant {
  asset: {
    id: string
    symbol: string
    company_name: string
    sector: string | null
  }
  trade_queue_item?: {
    id: string
    rationale: string
    urgency: TradeUrgency
    stage: TradeStage
  } | null
}

// Create/Update inputs for Intent Variants
export interface CreateIntentVariantInput {
  lab_id: string
  view_id?: string | null
  trade_queue_item_id?: string | null
  asset_id: string
  action: TradeAction
  sizing_input: string
  notes?: string | null
  sort_order?: number
}

export interface UpdateIntentVariantInput {
  action?: TradeAction
  sizing_input?: string
  notes?: string | null
  sort_order?: number
}

// Batch update for revalidation
export interface VariantBatchUpdate {
  id: string
  computed: ComputedValues | null
  direction_conflict: SizingValidationError | null
  below_lot_warning: boolean
  sizing_spec: import('../lib/trade-lab/sizing-parser').SizingSpec | null
}

// Trade Sheet - immutable snapshot of intent for execution
export interface TradeSheet {
  id: string
  lab_id: string
  portfolio_id: string
  name: string
  description: string | null

  // Snapshot of variants at creation time
  variants_snapshot: IntentVariant[]

  // Computed totals
  total_notional: number
  total_trades: number
  net_weight_change: number

  // Workflow state
  status: 'draft' | 'pending_approval' | 'approved' | 'sent_to_desk' | 'executed' | 'cancelled'
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  executed_at: string | null

  // Audit
  created_at: string
  created_by: string | null

  // Validation state at creation
  had_conflicts: boolean          // Should always be false (blocked if true)
  had_below_lot_warnings: boolean // Allowed, but recorded for audit
}

// Decision Queue Item Resolution
export type QueueResolution = 'accept' | 'reject' | 'defer'

export interface ResolveQueueItemInput {
  trade_queue_item_id: string
  portfolio_id: string
  resolution: QueueResolution
  reason?: string
  deferred_until?: string | null  // For 'defer' resolution
}

// Price data for batch fetching
export interface AssetPrice {
  asset_id: string
  price: number
  timestamp: string
  source: 'realtime' | 'delayed' | 'close'
}

// Batch price fetch result
export interface PriceBatchResult {
  prices: Map<string, AssetPrice>
  errors: Map<string, string>
  fetched_at: string
}
