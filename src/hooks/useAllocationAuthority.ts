/**
 * Who the current user is on the allocation team.
 *
 * Two authorities, and the product keeps them apart on purpose:
 *
 *   investment authority — an active allocation-team ADMIN publishes the
 *   official house view and opens the periods it belongs to.
 *
 *   administrative authority — an ORG_ADMIN appoints and manages the
 *   allocation team. Appointing the investment authority is not being it, so
 *   an org admin sees the matrix read-only unless they are independently on
 *   the team as an admin.
 *
 * This is UX only. RLS is authoritative: the policies added in
 * `20260924100200_allocation_authority.sql` reject the write regardless of
 * what this returns. The point of reading it in the client is to avoid
 * offering an affordance that the database will refuse — not to protect
 * anything.
 *
 * Deliberately NOT derived from `isPM`, `INVESTMENT`, or
 * `canManageOrgStructure`. Those are different authorities and conflating
 * them is what put a firm-wide investment control behind a generic
 * membership check in the first place.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

/*
 * Shapes declared locally.
 *
 * `allocation_team_members` reached production without a migration, so it is
 * absent from the generated `database.ts` and PostgREST's typed client infers
 * `never` for it. The drift-capture migration puts the table under source
 * control; regenerating types afterwards is what will retire these. Until
 * then a narrow local type is honest about the two fields actually read,
 * rather than `any` over the whole row.
 */
interface TeamMembershipRow { role: string | null; is_active: boolean | null }
interface OrgMembershipRow { is_org_admin: boolean | null }

export interface AllocationAuthority {
  /** May read the matrix. Every org member can. */
  canRead: boolean
  /** Active allocation-team member: may write cell notes and attachments. */
  isTeamMember: boolean
  /** Active allocation-team admin: may publish official views and periods. */
  isTeamAdmin: boolean
  /** Org admin: may appoint and manage the allocation team. */
  canAdministerTeam: boolean
  isLoading: boolean
}

export function useAllocationAuthority(organizationId: string | null): AllocationAuthority {
  const { user } = useAuth()

  const { data: membership, isLoading: teamLoading } = useQuery({
    queryKey: ['allocation-team-authority', organizationId, user?.id],
    queryFn: async () => {
      if (!organizationId || !user?.id) return null
      const { data, error } = await supabase
        .from('allocation_team_members')
        .select('role, is_active')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()
      if (error) throw error
      return (data as TeamMembershipRow | null) ?? null
    },
    enabled: !!organizationId && !!user?.id,
  })

  const { data: orgMembership, isLoading: orgLoading } = useQuery({
    queryKey: ['allocation-org-admin', organizationId, user?.id],
    queryFn: async () => {
      if (!organizationId || !user?.id) return null
      const { data, error } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
      if (error) throw error
      return (data as OrgMembershipRow | null) ?? null
    },
    enabled: !!organizationId && !!user?.id,
  })

  return {
    canRead: true,
    isTeamMember: !!membership,
    isTeamAdmin: membership?.role === 'admin',
    canAdministerTeam: !!orgMembership?.is_org_admin,
    isLoading: teamLoading || orgLoading,
  }
}
