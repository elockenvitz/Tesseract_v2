/**
 * Shared hook for organization data used across org tabs.
 * Consolidates the core queries that multiple tabs need.
 * All queries are scoped to the current organization via useOrganization().
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import type {
  Organization,
  OrganizationMembership,
  Team,
  TeamMembership,
  Portfolio,
  PortfolioMembership,
} from '../types/organization'

export function useOrganizationData() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { currentOrgId } = useOrganization()

  // Fetch organization by explicit ID
  const { data: organization } = useQuery({
    queryKey: ['organization', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', currentOrgId!)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as Organization | null
    },
    enabled: !!currentOrgId,
  })

  // Fetch teams scoped to current org
  const { data: teams = [] } = useQuery({
    queryKey: ['teams', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return data as Team[]
    },
    enabled: !!currentOrgId,
  })

  // Fetch org members via denormalized view
  const { data: orgMembers = [], isLoading: isLoadingOrgMembers } = useQuery({
    queryKey: ['organization-members', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_members_v')
        .select('*')
        .eq('organization_id', currentOrgId!)
        .order('user_first_name', { ascending: true })

      if (error) throw error
      if (!data || data.length === 0) return []

      return data.map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        organization_id: row.organization_id,
        status: row.status,
        is_org_admin: row.is_org_admin,
        title: row.profile_title,
        user: {
          id: row.user_id,
          email: row.user_email || '',
          full_name: row.user_full_name || 'Unknown',
          coverage_admin: row.user_coverage_admin || false
        },
        profile: row.profile_user_type ? {
          user_type: row.profile_user_type,
          sector_focus: row.sector_focus || [],
          investment_style: row.investment_style || [],
          market_cap_focus: row.market_cap_focus || [],
          geography_focus: row.geography_focus || [],
          time_horizon: row.time_horizon || [],
          ops_departments: row.ops_departments || [],
          compliance_areas: row.compliance_areas || []
        } : null
      })) as OrganizationMembership[]
    },
    enabled: !!currentOrgId,
  })

  // Fetch team memberships (RLS scopes to current org via teams)
  const { data: teamMemberships = [] } = useQuery({
    queryKey: ['team-memberships', currentOrgId],
    queryFn: async () => {
      const { data: memberships, error: membershipsError } = await supabase
        .from('team_memberships')
        .select(`*, team:team_id (*)`)

      if (membershipsError) throw membershipsError
      if (!memberships || memberships.length === 0) return []

      const userIds = memberships.map(m => m.user_id).filter(Boolean)
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      if (usersError) throw usersError

      const userMap = new Map((users || []).map(u => [u.id, u]))

      return memberships.map((m: any) => {
        const u = userMap.get(m.user_id)
        return {
          ...m,
          user: {
            id: u?.id || m.user_id,
            email: u?.email || '',
            full_name: u?.first_name && u?.last_name
              ? `${u.first_name} ${u.last_name}`
              : u?.email?.split('@')[0] || 'Unknown'
          }
        }
      }) as TeamMembership[]
    },
    enabled: !!currentOrgId,
  })

  // Fetch portfolios (RLS scopes to current org via teams)
  const { data: portfolios = [] } = useQuery({
    queryKey: ['portfolios-org', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .order('name')

      if (error) throw error
      return data as Portfolio[]
    },
    enabled: !!currentOrgId,
  })

  // Fetch portfolio memberships (RLS scopes to current org via portfolios → teams)
  const { data: portfolioMemberships = [] } = useQuery({
    queryKey: ['portfolio-memberships', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_memberships')
        .select(`
          *,
          user:user_id (
            id,
            email,
            raw_user_meta_data
          ),
          portfolio:portfolio_id (*)
        `)

      if (error) throw error
      return data.map((m: any) => ({
        ...m,
        user: {
          id: m.user?.id,
          email: m.user?.email,
          full_name: m.user?.raw_user_meta_data?.full_name || m.user?.email?.split('@')[0],
          avatar_url: m.user?.raw_user_meta_data?.avatar_url
        }
      })) as PortfolioMembership[]
    },
    enabled: !!currentOrgId,
  })

  return {
    organization,
    teams,
    orgMembers,
    isLoadingOrgMembers,
    teamMemberships,
    portfolios,
    portfolioMemberships,
    user,
    queryClient,
    currentOrgId,
  }
}
