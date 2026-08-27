/**
 * useCanInviteMembers — may the signed-in user bring someone into a workspace?
 *
 * Reads `can_invite_members()`, not `is_platform_admin()`, even though the two
 * currently return the same thing. `can_invite_members()` is the entitlement
 * seam: when Pro / Team / Enterprise tiers land, invitation authority becomes a
 * property of the plan rather than of platform staff, and every surface that
 * asks this question follows without being rewritten.
 *
 * This is presentation only. The authority is enforced in create_org_invite(),
 * revoke_org_invite() and the table grants; hiding a button is a courtesy, not
 * a control.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useCanInviteMembers(): { canInvite: boolean; isLoading: boolean } {
  const { user } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['can-invite-members', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_invite_members')
      if (error) return false
      return !!data
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  })

  return { canInvite: !!data, isLoading }
}
