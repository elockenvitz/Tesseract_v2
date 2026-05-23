/**
 * useOrgMembers — shared hook for user-pickers (share dialogs, team
 * member modals, task assignment, DMs, etc.).
 *
 * Returns the active members of the caller's current org with the
 * fields a picker needs (id, email, first_name, last_name). Scopes
 * explicitly via `organization_memberships` rather than relying on
 * RLS — a platform admin can legitimately *read* all users (for ops
 * dashboards), but a picker should always show org members only,
 * regardless of the caller's permissions. Defense in depth.
 *
 * Use `useOrganizationOptional` so the hook can be safely called from
 * components rendered outside the OrganizationProvider tree (portal
 * modals, capture overlay). Without an org context, returns an empty
 * list — which is the correct behavior: we don't know which org's
 * members to surface.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganizationOptional } from '../contexts/OrganizationContext'

export interface OrgMember {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
}

interface UseOrgMembersOptions {
  /** Don't run the query when false. Default: true. */
  enabled?: boolean
  /** Filter out a specific user id from the result (e.g. the current
   *  user, in "share with someone else" pickers). */
  excludeUserId?: string | null | undefined
}

export function useOrgMembers({ enabled = true, excludeUserId }: UseOrgMembersOptions = {}) {
  const orgCtx = useOrganizationOptional()
  const currentOrgId = orgCtx?.currentOrgId ?? null

  return useQuery({
    queryKey: ['org-members', currentOrgId, excludeUserId ?? null],
    enabled: enabled && !!currentOrgId,
    queryFn: async (): Promise<OrgMember[]> => {
      if (!currentOrgId) return []
      const { data: memberships, error: memErr } = await supabase
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', currentOrgId)
        .eq('status', 'active')
      if (memErr) throw memErr
      let userIds = (memberships ?? [])
        .map((m: any) => m.user_id)
        .filter((id: string | null): id is string => !!id)
      if (excludeUserId) userIds = userIds.filter(id => id !== excludeUserId)
      if (userIds.length === 0) return []
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
        .order('first_name', { ascending: true })
      if (error) throw error
      return (data ?? []) as OrgMember[]
    },
  })
}
