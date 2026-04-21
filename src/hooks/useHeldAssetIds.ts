import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'

/**
 * For a set of asset_ids, returns the subset that currently has any nonzero
 * holding in any portfolio in the user's current organization. Useful for
 * dividing a roster into "Held" vs "Watchlist" without issuing a query per
 * asset.
 */
export function useHeldAssetIds(assetIds: string[] | null | undefined) {
  const { currentOrgId } = useOrganization()

  const stableIds = useMemo(
    () => (assetIds ? [...new Set(assetIds.filter(Boolean))].sort() : []),
    [assetIds]
  )

  const query = useQuery<Set<string>>({
    queryKey: ['held-asset-ids', currentOrgId, stableIds],
    enabled: !!currentOrgId && stableIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings_positions')
        .select('asset_id, shares')
        .eq('organization_id', currentOrgId!)
        .in('asset_id', stableIds)
      if (error) throw error
      const held = new Set<string>()
      for (const row of data ?? []) {
        const shares = Number(row.shares)
        if (Number.isFinite(shares) && shares !== 0) held.add(row.asset_id as string)
      }
      return held
    }
  })

  return {
    heldIds: query.data ?? new Set<string>(),
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
