/**
 * Target Date Fund (TDF) Types
 *
 * Types for TDF management with holdings, comparisons, and trade memorialization
 */

// ============================================================================
// ENUM TYPES
// ============================================================================

export type TDFTradeStatus = 'proposed' | 'approved' | 'executed' | 'cancelled'

export type TDFTradeAction = 'buy' | 'sell' | 'rebalance'

export type TDFSnapshotType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'manual'

export type TDFNoteType = 'positioning' | 'rationale' | 'meeting' | 'general'

// ============================================================================
// CORE INTERFACES
// ============================================================================

/**
 * Target Date Fund - the TDF series (2015-2070)
 */
export interface TargetDateFund {
  id: string
  name: string
  target_year: number
  description: string | null
  fund_code: string | null
  benchmark: string | null
  inception_date: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * TDF Underlying Fund - what TDFs can hold
 */
export interface TDFUnderlyingFund {
  id: string
  name: string
  ticker: string | null
  asset_class: string | null
  sub_asset_class: string | null
  expense_ratio: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * TDF Holdings Snapshot - point-in-time capture
 */
export interface TDFHoldingsSnapshot {
  id: string
  tdf_id: string
  snapshot_date: string
  snapshot_type: TDFSnapshotType
  total_aum: number | null
  notes: string | null
  created_by: string | null
  created_at: string
}

/**
 * TDF Holding - individual holding within a snapshot
 */
export interface TDFHolding {
  id: string
  snapshot_id: string
  underlying_fund_id: string
  weight: number
  shares: number | null
  market_value: number | null
  created_at: string
}

/**
 * TDF Glide Path Target - expected allocations by years to retirement
 */
export interface TDFGlidePathTarget {
  id: string
  tdf_id: string
  years_to_retirement: number
  equity_weight: number
  fixed_income_weight: number
  alternatives_weight: number
  cash_weight: number
  effective_date: string
  created_at: string
  updated_at: string
}

/**
 * TDF Note - positioning rationale, meeting notes, etc.
 */
export interface TDFNote {
  id: string
  tdf_id: string
  title: string
  content: string
  note_type: TDFNoteType
  is_pinned: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * TDF Comment - discussion threads
 */
export interface TDFComment {
  id: string
  tdf_id: string
  user_id: string
  content: string
  reply_to: string | null
  created_at: string
  updated_at: string
}

/**
 * TDF Trade Proposal - proposed trades for TDFs
 */
export interface TDFTradeProposal {
  id: string
  tdf_id: string
  title: string
  description: string | null
  rationale: string
  status: TDFTradeStatus
  proposed_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

/**
 * TDF Trade Proposal Item - individual trade within a proposal
 */
export interface TDFTradeProposalItem {
  id: string
  proposal_id: string
  underlying_fund_id: string
  action: TDFTradeAction
  current_weight: number | null
  target_weight: number | null
  weight_change: number | null
  estimated_shares: number | null
  estimated_value: number | null
  created_at: string
}

/**
 * TDF Executed Trade - memorialization (historical trade log)
 */
export interface TDFExecutedTrade {
  id: string
  tdf_id: string
  proposal_id: string | null
  underlying_fund_id: string
  trade_date: string
  action: TDFTradeAction
  shares: number
  price: number
  total_value: number
  weight_before: number | null
  weight_after: number | null
  rationale: string | null
  execution_notes: string | null
  executed_by: string | null
  created_at: string
}

// ============================================================================
// EXTENDED INTERFACES (with related data)
// ============================================================================

/**
 * User info for joins
 */
export interface UserInfo {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
}

/**
 * TDF Holding with underlying fund info
 */
export interface TDFHoldingWithFund extends TDFHolding {
  tdf_underlying_funds: TDFUnderlyingFund
}

/**
 * TDF Holdings Snapshot with holdings
 */
export interface TDFHoldingsSnapshotWithHoldings extends TDFHoldingsSnapshot {
  tdf_holdings: TDFHoldingWithFund[]
}

/**
 * TDF Note with user info
 */
export interface TDFNoteWithUser extends TDFNote {
  users?: UserInfo
}

/**
 * TDF Comment with user info
 */
export interface TDFCommentWithUser extends TDFComment {
  users: UserInfo
}

/**
 * TDF Trade Proposal Item with fund info
 */
export interface TDFTradeProposalItemWithFund extends TDFTradeProposalItem {
  tdf_underlying_funds: TDFUnderlyingFund
}

/**
 * TDF Trade Proposal with items and user info
 */
export interface TDFTradeProposalWithDetails extends TDFTradeProposal {
  tdf_trade_proposal_items?: TDFTradeProposalItemWithFund[]
  proposed_by_user?: UserInfo
  approved_by_user?: UserInfo
}

/**
 * TDF Executed Trade with fund and user info
 */
export interface TDFExecutedTradeWithDetails extends TDFExecutedTrade {
  tdf_underlying_funds: TDFUnderlyingFund
  users?: UserInfo
  tdf_trade_proposals?: TDFTradeProposal | null
}

/**
 * Target Date Fund with all related data
 */
export interface TargetDateFundWithDetails extends TargetDateFund {
  tdf_glide_path_targets?: TDFGlidePathTarget[]
  latest_snapshot?: TDFHoldingsSnapshotWithHoldings | null
  tdf_notes?: TDFNoteWithUser[]
  tdf_comments?: TDFCommentWithUser[]
  tdf_trade_proposals?: TDFTradeProposalWithDetails[]
}

// ============================================================================
// FORM/INPUT TYPES
// ============================================================================

export interface CreateTargetDateFundInput {
  name: string
  target_year: number
  description?: string
  fund_code?: string
  benchmark?: string
  inception_date?: string
}

export interface UpdateTargetDateFundInput {
  name?: string
  description?: string | null
  fund_code?: string | null
  benchmark?: string | null
  inception_date?: string | null
  is_active?: boolean
}

export interface CreateTDFUnderlyingFundInput {
  name: string
  ticker?: string
  asset_class?: string
  sub_asset_class?: string
  expense_ratio?: number
}

export interface UpdateTDFUnderlyingFundInput {
  name?: string
  ticker?: string | null
  asset_class?: string | null
  sub_asset_class?: string | null
  expense_ratio?: number | null
  is_active?: boolean
}

export interface CreateTDFHoldingsSnapshotInput {
  tdf_id: string
  snapshot_date: string
  snapshot_type?: TDFSnapshotType
  total_aum?: number
  notes?: string
}

export interface CreateTDFHoldingInput {
  snapshot_id: string
  underlying_fund_id: string
  weight: number
  shares?: number
  market_value?: number
}

export interface UpdateTDFHoldingInput {
  weight?: number
  shares?: number | null
  market_value?: number | null
}

export interface CreateTDFGlidePathTargetInput {
  tdf_id: string
  years_to_retirement: number
  equity_weight: number
  fixed_income_weight: number
  alternatives_weight?: number
  cash_weight?: number
  effective_date?: string
}

export interface UpdateTDFGlidePathTargetInput {
  equity_weight?: number
  fixed_income_weight?: number
  alternatives_weight?: number
  cash_weight?: number
}

export interface CreateTDFNoteInput {
  tdf_id: string
  title: string
  content: string
  note_type?: TDFNoteType
  is_pinned?: boolean
}

export interface UpdateTDFNoteInput {
  title?: string
  content?: string
  note_type?: TDFNoteType
  is_pinned?: boolean
}

export interface CreateTDFCommentInput {
  tdf_id: string
  content: string
  reply_to?: string | null
}

export interface UpdateTDFCommentInput {
  content?: string
}

export interface CreateTDFTradeProposalInput {
  tdf_id: string
  title: string
  description?: string
  rationale: string
}

export interface UpdateTDFTradeProposalInput {
  title?: string
  description?: string | null
  rationale?: string
  status?: TDFTradeStatus
}

export interface CreateTDFTradeProposalItemInput {
  proposal_id: string
  underlying_fund_id: string
  action: TDFTradeAction
  current_weight?: number
  target_weight?: number
  weight_change?: number
  estimated_shares?: number
  estimated_value?: number
}

export interface CreateTDFExecutedTradeInput {
  tdf_id: string
  proposal_id?: string | null
  underlying_fund_id: string
  trade_date: string
  action: TDFTradeAction
  shares: number
  price: number
  total_value: number
  weight_before?: number
  weight_after?: number
  rationale?: string
  execution_notes?: string
}

// ============================================================================
// UI HELPER TYPES
// ============================================================================

/**
 * Trade status configuration
 */
export const TDF_TRADE_STATUS_CONFIG: Record<TDFTradeStatus, { label: string; color: string; bgColor: string }> = {
  proposed: { label: 'Proposed', color: 'text-yellow-700', bgColor: 'bg-yellow-100 dark:bg-yellow-900/30' },
  approved: { label: 'Approved', color: 'text-blue-700', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  executed: { label: 'Executed', color: 'text-green-700', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  cancelled: { label: 'Cancelled', color: 'text-gray-700', bgColor: 'bg-gray-100 dark:bg-gray-800' },
}

/**
 * Trade action configuration
 */
export const TDF_TRADE_ACTION_CONFIG: Record<TDFTradeAction, { label: string; color: string; icon: string }> = {
  buy: { label: 'Buy', color: 'text-green-600', icon: 'plus' },
  sell: { label: 'Sell', color: 'text-red-600', icon: 'minus' },
  rebalance: { label: 'Rebalance', color: 'text-blue-600', icon: 'refresh-cw' },
}

/**
 * Note type configuration
 */
export const TDF_NOTE_TYPE_CONFIG: Record<TDFNoteType, { label: string; color: string; icon: string }> = {
  positioning: { label: 'Positioning', color: 'text-purple-600', icon: 'target' },
  rationale: { label: 'Rationale', color: 'text-blue-600', icon: 'file-text' },
  meeting: { label: 'Meeting Notes', color: 'text-green-600', icon: 'users' },
  general: { label: 'General', color: 'text-gray-600', icon: 'file' },
}

/**
 * Snapshot type configuration
 */
export const TDF_SNAPSHOT_TYPE_CONFIG: Record<TDFSnapshotType, { label: string }> = {
  daily: { label: 'Daily' },
  weekly: { label: 'Weekly' },
  monthly: { label: 'Monthly' },
  quarterly: { label: 'Quarterly' },
  annual: { label: 'Annual' },
  manual: { label: 'Manual' },
}

// ============================================================================
// COMPARISON TYPES
// ============================================================================

/**
 * Holdings comparison between two snapshots
 */
export interface HoldingsComparison {
  underlying_fund: TDFUnderlyingFund
  current_weight: number | null
  previous_weight: number | null
  weight_change: number | null
  is_new: boolean
  is_removed: boolean
}

/**
 * Snapshot comparison period options
 */
export type ComparisonPeriod = 'week' | 'month' | 'quarter' | 'year' | 'custom'

/**
 * Aggregated asset class weights
 */
export interface AssetClassWeights {
  equity: number
  fixed_income: number
  alternatives: number
  cash: number
}

/**
 * TDF summary for list views
 */
export interface TDFSummary {
  tdf: TargetDateFund
  latest_snapshot_date: string | null
  total_aum: number | null
  equity_weight: number | null
  fixed_income_weight: number | null
  glide_path_target: TDFGlidePathTarget | null
  drift_from_target: number | null // How far from glide path (can be positive or negative)
  pending_proposals_count: number
}

// ============================================================================
// FILTER TYPES
// ============================================================================

export interface TDFFilters {
  is_active?: boolean
  target_year_min?: number
  target_year_max?: number
  search?: string
}

export interface TDFTradeProposalFilters {
  tdf_id?: string | 'all'
  status?: TDFTradeStatus | 'all'
}

export interface TDFExecutedTradeFilters {
  tdf_id?: string | 'all'
  action?: TDFTradeAction | 'all'
  date_from?: string
  date_to?: string
}
