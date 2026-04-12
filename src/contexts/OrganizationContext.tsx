/**
 * OrganizationContext — Multi-org context provider.
 *
 * Provides the currently selected organization and a list of all
 * organizations the user is an active member of. Switching org
 * calls set_current_org() RPC and invalidates all org-scoped queries.
 */

import React, { createContext, useContext, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

interface OrgSummary {
  id: string
  name: string
  slug: string
  logo_url: string | null
}

interface OrganizationContextType {
  /** Currently selected org ID (null if user has no active memberships) */
  currentOrgId: string | null
  /** Full record of the current org */
  currentOrg: OrgSummary | null
  /** All orgs the user is an active member of */
  userOrgs: OrgSummary[]
  /** Whether the org list is still loading */
  isLoading: boolean
  /** Whether the current org is archived (read-only) */
  isOrgArchived: boolean
  /** Switch the active organization */
  switchOrg: (orgId: string) => Promise<void>
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined)

/** Keys that should be invalidated when the user switches org */
const ORG_SCOPED_QUERY_PREFIXES = [
  'organization',
  'organization-members',
  'organization-members-paged',
  'organization-contacts',
  'organization-invites',
  'organization-audit-log',
  'org-admin-status',
  'org-chart-nodes',
  'org-chart-node-links',
  'org-chart-node-members',
  'teams',
  'team-memberships',
  'portfolios-org',
  'portfolio-memberships',
  'portfolio-team-all',
  'access-requests',
  'coverage-settings',
  'research-fields',
  'research-sections',
  'rating-scales',
  'user-role-definitions',
  'asset-page-templates',
  'removal-requests',
  // Phase 2 hub tables
  'all-themes',
  'calendar-events',
  'calendar-deliverables',
  'allocation-periods',
  'asset-classes',
  'official-allocation-views',
  'target-date-funds',
  'tdf-glide-path-targets',
  'tdf-latest-snapshots',
  'tdf-pending-proposals',
  'workflows',
  'projects',
  'project-collections',
  'project-tags',
  'all-projects-for-link',
  'topics',
  'captures',
  'case-templates',
  'templates',
  'custom-notebooks',
  'coverage-roles',
  'conversations',
  'context-tag-search',
  'organization-domains',
  'org-archived-status',
  // Holdings & analyst data (org-scoped after RLS hardening)
  'portfolio-holdings',
  'holdings-snapshots',
  'holdings-positions',
  'analyst-ratings',
  'analyst-estimates',
  'bug-reports',
]

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Read current_organization_id from the user profile (set by useAuth)
  const currentOrgId: string | null = (user as any)?.current_organization_id ?? null

  // Fetch all orgs the user is an active member of
  const { data: userOrgs = [], isLoading } = useQuery({
    queryKey: ['user-organizations', user?.id],
    queryFn: async () => {
      // Get the user's active memberships first, then fetch those orgs
      const { data: memberships, error: memErr } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user!.id)
        .eq('status', 'active')
      if (memErr) throw memErr
      const orgIds = (memberships || []).map(m => m.organization_id)
      if (orgIds.length === 0) return []

      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, logo_url')
        .in('id', orgIds)
        .order('name')
      if (error) throw error
      const orgs = (data || []) as OrgSummary[]

      // Resolve private storage paths to signed URLs for logos
      for (const org of orgs) {
        if (org.logo_url && !org.logo_url.startsWith('http')) {
          const { data: signed } = await supabase.storage
            .from('template-branding')
            .createSignedUrl(org.logo_url, 3600)
          if (signed?.signedUrl) {
            org.logo_url = signed.signedUrl
          }
        }
      }

      return orgs
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000, // 10 min — org list rarely changes
  })

  const currentOrg = userOrgs.find((o) => o.id === currentOrgId) ?? null

  // Check if current org is archived
  const { data: isOrgArchived = false } = useQuery({
    queryKey: ['org-archived-status', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_governance')
        .select('archived_at')
        .eq('organization_id', currentOrgId!)
        .maybeSingle()
      if (error) return false
      return data?.archived_at != null
    },
    enabled: !!currentOrgId,
    staleTime: 5 * 60 * 1000,
  })

  const switchOrg = useCallback(
    async (orgId: string) => {
      if (orgId === currentOrgId) return

      // Call RPC which validates membership server-side
      const { error } = await supabase.rpc('set_current_org', { p_org_id: orgId })
      if (error) throw error

      // Update the cached user profile so currentOrgId updates immediately
      queryClient.setQueryData(['user-organizations', user?.id], (old: OrgSummary[] | undefined) => old)

      // Remove all org-scoped queries — cache cleared entirely so no stale
      // cross-org data flashes. Components refetch on re-mount.
      for (const prefix of ORG_SCOPED_QUERY_PREFIXES) {
        queryClient.removeQueries({ queryKey: [prefix] })
      }

      // Force re-fetch user profile to pick up new current_organization_id
      // The useAuth hook stores user in state from the users table
      // We need to refresh it — simplest approach: refetch from DB
      const { data: updatedUser } = await supabase
        .from('users')
        .select('*')
        .eq('id', user!.id)
        .single()

      if (updatedUser) {
        // Update the auth user cache in localStorage
        const cachedRaw = localStorage.getItem('auth-user-cache')
        if (cachedRaw) {
          try {
            const cached = JSON.parse(cachedRaw)
            localStorage.setItem(
              'auth-user-cache',
              JSON.stringify({ ...cached, ...updatedUser })
            )
          } catch {
            // ignore
          }
        }
        // Force a page-level state refresh by dispatching a storage event
        // This is the lightest-weight approach without modifying useAuth internals
        // Clear stale tab state and URL params before reload
        sessionStorage.removeItem('tesseract_tab_states')
        history.replaceState(null, '', window.location.pathname)

        window.dispatchEvent(new Event('org-switched'))
      }
    },
    [currentOrgId, user, queryClient]
  )

  return (
    <OrganizationContext.Provider
      value={{ currentOrgId, currentOrg, userOrgs, isLoading, isOrgArchived, switchOrg }}
    >
      {children}
    </OrganizationContext.Provider>
  )
}

export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider')
  }
  return context
}
