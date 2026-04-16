/**
 * Shared types for the Organization system.
 * Used by OrganizationPage, org tab components, and org hooks.
 */

export interface Organization {
  id: string
  name: string
  slug: string
  description: string | null
  logo_url: string | null
  settings: any
  onboarding_policy: OnboardingPolicy
}

export interface Team {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  color: string
  icon: string
  is_active: boolean
  member_count?: number
  portfolio_count?: number
}

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  coverage_admin?: boolean
}

export interface UserProfileData {
  user_type: string | null
  sector_focus: string[]
  investment_style: string[]
  market_cap_focus: string[]
  geography_focus: string[]
  time_horizon: string[]
  ops_departments: string[]
  compliance_areas: string[]
}

export interface OrganizationMembership {
  id: string
  organization_id: string
  user_id: string
  is_org_admin: boolean
  title: string | null
  status: string
  suspended_at?: string | null
  suspended_by?: string | null
  suspension_reason?: string | null
  user?: UserProfile
  profile?: UserProfileData | null
}

export interface TeamMembership {
  id: string
  team_id: string
  user_id: string
  is_team_admin: boolean
  title: string | null
  user?: UserProfile
  team?: Team
}

export type PortfolioStatus = 'active' | 'archived' | 'discarded'

/**
 * Controls how accepted_trades flow into portfolio_holdings and how
 * execution status is tracked. See accepted-trade-service
 * (finalizeTradeForHoldingsSource) for behavior per value.
 *
 * - 'paper'      — hypothetical portfolio; trades auto-apply to holdings and
 *                  auto-complete execution. No trader workflow.
 * - 'manual_eod' — no live feed; PM uploads holdings periodically (usually
 *                  end-of-day). Trades auto-apply so intraday pro-forma is
 *                  honest; reconciliation diffs against the next EOD upload.
 * - 'live_feed'  — external holdings/fills feed is the source of truth. Trades
 *                  do NOT auto-apply; execution_status waits for fills.
 */
export type HoldingsSource = 'live_feed' | 'manual_eod' | 'paper'

export interface Portfolio {
  id: string
  name: string
  team_id: string | null
  organization_id: string | null
  description: string | null
  benchmark: string | null
  portfolio_type: string
  holdings_source: HoldingsSource
  is_active: boolean
  status: PortfolioStatus
  archived_at: string | null
  archived_by: string | null
  discarded_at: string | null
  discarded_by: string | null
  lifecycle_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface PortfolioTeamLink {
  id: string
  organization_id: string
  portfolio_id: string
  team_node_id: string
  is_lead: boolean
  created_at: string
  created_by: string | null
  /** Joined from org_chart_nodes */
  team_node?: OrgChartNode
}

export interface PortfolioMembership {
  id: string
  portfolio_id: string
  user_id: string
  is_portfolio_manager: boolean
  title: string | null
  access_permissions: any
  user?: UserProfile
  portfolio?: Portfolio
}

export interface PortfolioTeamMember {
  id: string
  portfolio_id: string
  user_id: string
  role: string
  focus: string | null
  created_at: string
  /** When non-null, this row was created because the user was added to the team node with this id. */
  source_team_node_id?: string | null
  user?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
}

export interface AccessRequest {
  id: string
  organization_id: string
  requester_id: string
  request_type: string
  target_team_id: string | null
  target_portfolio_id: string | null
  requested_title: string | null
  reason: string | null
  status: string
  created_at: string
  requester?: UserProfile
  target_team?: Team
  target_portfolio?: Portfolio
}

export interface OrganizationContact {
  id: string
  organization_id: string
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  department: string | null
  company: string | null
  notes: string | null
  contact_type: 'external' | 'consultant' | 'vendor' | 'client' | 'other'
  receives_reports: boolean
  is_active: boolean
  created_at: string
}

export interface RemovalRequest {
  id: string
  organization_id: string
  target_user_id: string
  requested_by: string
  reason: string | null
  status: string
  created_at: string
  target_user?: UserProfile
  requester?: UserProfile
}

export type OrgNodeType = 'division' | 'department' | 'team' | 'portfolio' | 'custom'

export interface OrgChartNode {
  id: string
  organization_id: string
  parent_id: string | null
  node_type: OrgNodeType
  custom_type_label?: string
  name: string
  description?: string
  color: string
  icon: string
  sort_order: number
  settings: any
  is_active: boolean
  is_non_investment?: boolean
  coverage_admin_override?: boolean
  created_at: string
  children?: OrgChartNode[]
  isLinkedInstance?: boolean
}

export interface OrgChartNodeMember {
  id: string
  node_id: string
  user_id: string
  role: string
  focus: string | null
  is_coverage_admin?: boolean
  coverage_admin_blocked?: boolean
  created_at: string
  user?: UserProfile
}

export interface OrganizationInvite {
  id: string
  organization_id: string
  email: string
  invited_by: string
  invited_is_org_admin: boolean
  status: 'pending' | 'sent' | 'accepted' | 'expired' | 'cancelled'
  token: string
  created_at: string
  expires_at: string | null
  accepted_at: string | null
  accepted_by: string | null
}

export interface OrgAuditLogEntry {
  id: string
  organization_id: string
  actor_id: string | null
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, any>
  created_at: string
}

// ─── Structured Activity Event Types ─────────────────────────────────

export type OrgActivityEntityType =
  | 'org' | 'org_member' | 'team_node' | 'team_membership'
  | 'portfolio' | 'portfolio_membership' | 'access_request' | 'invite' | 'settings'
  | 'organization_membership'

export type OrgActivityActionType =
  | 'created' | 'updated' | 'deleted' | 'archived' | 'restored'
  | 'added' | 'removed' | 'role_granted' | 'role_revoked' | 'role_changed'
  | 'linked' | 'unlinked' | 'approved' | 'rejected' | 'discarded'
  | 'temporary_access_granted' | 'temporary_access_revoked'
  | 'deactivated' | 'reactivated'

export type OrgActivitySourceType = 'direct' | 'via_team' | 'system'

export interface OrgActivityEvent {
  id: string
  organization_id: string
  actor_id: string | null
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, any>
  created_at: string
  entity_type: OrgActivityEntityType | null
  action_type: OrgActivityActionType | null
  target_user_id: string | null
  source_type: OrgActivitySourceType
  source_id: string | null
  metadata: Record<string, any>
  /** The human who triggered this event chain (even for cascade/system events). */
  initiator_user_id: string | null
}

export interface LogOrgActivityParams {
  organizationId: string
  action: string
  targetType: string
  targetId?: string
  details?: Record<string, any>
  entityType?: OrgActivityEntityType
  actionType?: OrgActivityActionType
  targetUserId?: string
  sourceType?: OrgActivitySourceType
  sourceId?: string
  metadata?: Record<string, any>
  /** Pass the current user's ID to record who triggered this event. Defaults to auth.uid() server-side. */
  initiatorUserId?: string
  /** Set to null for cascade events so actor_id is NULL (shows "System"). Only used by logOrgActivityBatch. */
  actorOverride?: string | null
}

export type OnboardingPolicy = 'open' | 'approval_required' | 'invite_only'

export type RouteAction = 'switch' | 'auto_join' | 'request_created' | 'blocked'

export interface RouteOrgResult {
  org_id: string | null
  org_name: string | null
  action: RouteAction
  reason: string
}

export interface SsoCheckResult {
  has_sso: boolean
  org_id?: string
  org_name?: string
  sso_only?: boolean
  discovery_url?: string
  client_id?: string
  provider_type?: string
  onboarding_policy?: OnboardingPolicy
  reason?: string
}

export type OrgTabType = 'teams' | 'people' | 'portfolios' | 'requests' | 'access' | 'activity' | 'settings'

// ─── Activity Formatter Types ────────────────────────────────────────

export type ActivityTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface FormattedActivityRow {
  title: string
  subtitle: string
  iconKey: string
  tone: ActivityTone
  chips?: string[]
}

export interface ActivityDiffItem {
  label: string
  left: string
  right: string
}

export interface ActivityContextItem {
  label: string
  value: string
  href?: string
}

export interface ActivityAuditItem {
  label: string
  value: string
}

export interface FormattedActivityDetails {
  diff?: ActivityDiffItem[]
  context?: ActivityContextItem[]
  audit: ActivityAuditItem[]
}

export type PersonFilterMode = 'target' | 'initiator'
