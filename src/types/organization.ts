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

export interface Portfolio {
  id: string
  name: string
  team_id: string | null
  description: string | null
  portfolio_type: string
  is_active: boolean
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
