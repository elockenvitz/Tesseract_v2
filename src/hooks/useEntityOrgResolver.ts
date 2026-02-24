/**
 * useEntityOrgResolver — Deep-link safety hook.
 *
 * When a query returns 0 rows for an entity ID, call resolve_entity_org()
 * to check if the entity belongs to a different org the user has access to.
 * If so, returns the org details so the UI can show a switch banner.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'

interface OrgResolverResult {
  /** The org the entity belongs to (different from current) */
  targetOrg: { id: string; name: string; slug: string } | null
  /** Whether the resolver is still loading */
  isResolving: boolean
}

export function useEntityOrgResolver(
  entityType: string | null,
  entityId: string | null,
  /** Set to true when the primary query returned 0 rows / not found */
  shouldResolve: boolean
): OrgResolverResult {
  const { currentOrgId, userOrgs } = useOrganization()

  const { data: resolvedOrgId, isLoading } = useQuery({
    queryKey: ['resolve-entity-org', entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('resolve_entity_org', {
        p_entity_type: entityType!,
        p_entity_id: entityId!,
      })
      if (error) return null
      return data as string | null
    },
    enabled: shouldResolve && !!entityType && !!entityId,
    staleTime: 5 * 60 * 1000,
  })

  // Find org details if resolved to a different org
  let targetOrg: OrgResolverResult['targetOrg'] = null
  if (resolvedOrgId && resolvedOrgId !== currentOrgId) {
    const org = userOrgs.find((o) => o.id === resolvedOrgId)
    if (org) {
      targetOrg = { id: org.id, name: org.name, slug: org.slug }
    }
  }

  return { targetOrg, isResolving: isLoading && shouldResolve }
}
