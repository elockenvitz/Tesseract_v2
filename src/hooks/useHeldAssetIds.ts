import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'

/**
 * For a set of asset_ids, returns the subset the organisation holds RIGHT NOW
 * in any of its portfolios. Divides a roster into "Held" and "Watchlist"
 * without a query per asset.
 *
 * WORKING BOOK semantics, deliberately. This used to read the snapshot
 * positions table across every snapshot ever taken, so "held" meant "held at
 * some point in recorded history" — a name exited months ago stayed on the
 * Held side of a theme roster forever, with nothing to indicate why.
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
      // The WORKING BOOK, not the snapshot history.
      //
      // This read `portfolio_holdings_positions` across every snapshot ever
      // taken, with no snapshot filter. A name held six months ago and since
      // exited still came back as held, permanently, because the row that
      // recorded it is history and history does not change. "Held" is a
      // question about the current book, and in the working book presence IS
      // the answer: an exited position has no row.
      //
      // The organisation is derived through the portfolio rather than filtered
      // on a denormalised column, because portfolio_holdings has none — the
      // org-scoped SELECT policy already restricts the rows, and the inner
      // join makes that explicit rather than implicit.
      // holdings-audit: safe — set membership, no date, no aggregation.
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('asset_id, shares, portfolios!inner(organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
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
