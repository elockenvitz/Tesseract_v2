/**
 * Asset Allocation Types
 *
 * Types for the Asset Allocation Framework - team collaboration on tactical views
 */

// ============================================================================
// ENUM TYPES
// ============================================================================

export type AllocationView =
  | 'strong_underweight'
  | 'underweight'
  | 'market_weight'
  | 'overweight'
  | 'strong_overweight'

export type AllocationViewStatus = 'draft' | 'active' | 'archived'

export type AllocationVoteType = 'agree' | 'disagree' | 'abstain'

// ============================================================================
// CORE INTERFACES
// ============================================================================

/**
 * Asset Class - configurable asset class definitions
 */
export interface AssetClass {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  color: string
  icon: string
  sort_order: number
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Allocation Period - time period for allocation views (Q4 2024, etc.)
 */
export interface AllocationPeriod {
  id: string
  name: string
  start_date: string
  end_date: string
  status: AllocationViewStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Individual Allocation View - each team member's personal view
 */
export interface IndividualAllocationView {
  id: string
  period_id: string
  asset_class_id: string
  user_id: string
  view: AllocationView
  conviction_level: number | null
  rationale: string | null
  created_at: string
  updated_at: string
}

/**
 * Allocation Vote - vote on proposed allocations
 */
export interface AllocationVote {
  id: string
  period_id: string
  asset_class_id: string
  user_id: string
  proposed_view: AllocationView
  vote: AllocationVoteType
  comment: string | null
  created_at: string
  updated_at: string
}

/**
 * Official Allocation View - admin-set official team view
 */
export interface OfficialAllocationView {
  id: string
  period_id: string
  asset_class_id: string
  view: AllocationView
  rationale: string | null
  set_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Allocation Comment - discussion threads
 */
export interface AllocationComment {
  id: string
  period_id: string
  asset_class_id: string | null
  user_id: string
  content: string
  reply_to: string | null
  is_pinned: boolean
  created_at: string
  updated_at: string
}

/**
 * Allocation History - audit trail of official view changes
 */
export interface AllocationHistory {
  id: string
  period_id: string
  asset_class_id: string
  previous_view: AllocationView | null
  new_view: AllocationView
  changed_by: string | null
  change_reason: string | null
  changed_at: string
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
 * Individual view with user and asset class info
 */
export interface IndividualAllocationViewWithDetails extends IndividualAllocationView {
  users: UserInfo
  asset_classes: AssetClass
}

/**
 * Allocation vote with user info
 */
export interface AllocationVoteWithUser extends AllocationVote {
  users: UserInfo
}

/**
 * Official view with asset class info
 */
export interface OfficialAllocationViewWithAssetClass extends OfficialAllocationView {
  asset_classes: AssetClass
}

/**
 * Allocation comment with user info
 */
export interface AllocationCommentWithUser extends AllocationComment {
  users: UserInfo
}

/**
 * Allocation history with user and asset class info
 */
export interface AllocationHistoryWithDetails extends AllocationHistory {
  users?: UserInfo
  asset_classes: AssetClass
}

/**
 * Allocation period with all related data
 */
export interface AllocationPeriodWithDetails extends AllocationPeriod {
  official_allocation_views?: OfficialAllocationViewWithAssetClass[]
  individual_allocation_views?: IndividualAllocationViewWithDetails[]
  allocation_votes?: AllocationVoteWithUser[]
  allocation_comments?: AllocationCommentWithUser[]
}

// ============================================================================
// FORM/INPUT TYPES
// ============================================================================

export interface CreateAssetClassInput {
  name: string
  description?: string
  parent_id?: string | null
  color?: string
  icon?: string
  sort_order?: number
}

export interface UpdateAssetClassInput {
  name?: string
  description?: string | null
  parent_id?: string | null
  color?: string
  icon?: string
  sort_order?: number
  is_active?: boolean
}

export interface CreateAllocationPeriodInput {
  name: string
  start_date: string
  end_date: string
  status?: AllocationViewStatus
}

export interface UpdateAllocationPeriodInput {
  name?: string
  start_date?: string
  end_date?: string
  status?: AllocationViewStatus
}

export interface CreateIndividualViewInput {
  period_id: string
  asset_class_id: string
  view: AllocationView
  conviction_level?: number
  rationale?: string
}

export interface UpdateIndividualViewInput {
  view?: AllocationView
  conviction_level?: number | null
  rationale?: string | null
}

export interface CreateAllocationVoteInput {
  period_id: string
  asset_class_id: string
  proposed_view: AllocationView
  vote: AllocationVoteType
  comment?: string
}

export interface UpdateAllocationVoteInput {
  proposed_view?: AllocationView
  vote?: AllocationVoteType
  comment?: string | null
}

export interface CreateOfficialViewInput {
  period_id: string
  asset_class_id: string
  view: AllocationView
  rationale?: string
}

export interface UpdateOfficialViewInput {
  view?: AllocationView
  rationale?: string | null
}

export interface CreateAllocationCommentInput {
  period_id: string
  asset_class_id?: string | null
  content: string
  reply_to?: string | null
}

export interface UpdateAllocationCommentInput {
  content?: string
  is_pinned?: boolean
}

// ============================================================================
// UI HELPER TYPES
// ============================================================================

/**
 * View configuration for display
 */
export interface AllocationViewConfig {
  label: string
  shortLabel: string
  color: string
  bgColor: string
  textColor: string
  value: number // -2 to +2 for sorting/positioning
}

/**
 * Map of allocation views to their display config
 */
export const ALLOCATION_VIEW_CONFIG: Record<AllocationView, AllocationViewConfig> = {
  strong_underweight: {
    label: 'Strong Underweight',
    shortLabel: 'S-UW',
    color: '#dc2626',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-300',
    value: -2,
  },
  underweight: {
    label: 'Underweight',
    shortLabel: 'UW',
    color: '#f97316',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-300',
    value: -1,
  },
  market_weight: {
    label: 'Market Weight',
    shortLabel: 'MW',
    color: '#6b7280',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    textColor: 'text-gray-700 dark:text-gray-300',
    value: 0,
  },
  overweight: {
    label: 'Overweight',
    shortLabel: 'OW',
    color: '#22c55e',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-300',
    value: 1,
  },
  strong_overweight: {
    label: 'Strong Overweight',
    shortLabel: 'S-OW',
    color: '#16a34a',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    value: 2,
  },
}

/**
 * Vote type configuration
 */
export const ALLOCATION_VOTE_CONFIG: Record<AllocationVoteType, { label: string; color: string; icon: string }> = {
  agree: { label: 'Agree', color: 'text-green-600', icon: 'check' },
  disagree: { label: 'Disagree', color: 'text-red-600', icon: 'x' },
  abstain: { label: 'Abstain', color: 'text-gray-500', icon: 'minus' },
}

/**
 * Period status configuration
 */
export const ALLOCATION_PERIOD_STATUS_CONFIG: Record<AllocationViewStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  active: { label: 'Active', color: 'bg-green-100 text-green-700' },
  archived: { label: 'Archived', color: 'bg-blue-100 text-blue-700' },
}

// ============================================================================
// FILTER TYPES
// ============================================================================

export interface AllocationFilters {
  period_id?: string | 'all'
  status?: AllocationViewStatus | 'all'
  asset_class_id?: string | 'all'
}

/**
 * Vote summary for an asset class
 */
export interface VoteSummary {
  agree: number
  disagree: number
  abstain: number
  total: number
}

/**
 * Aggregated view data for an asset class in a period
 */
export interface AssetClassAllocationSummary {
  asset_class: AssetClass
  official_view: OfficialAllocationView | null
  individual_views: IndividualAllocationViewWithDetails[]
  votes: AllocationVoteWithUser[]
  vote_summary: VoteSummary
  comments_count: number
}
