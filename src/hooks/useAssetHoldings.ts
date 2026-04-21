import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'

export interface AssetHolding {
  id: string
  portfolio_id: string
  portfolio_name: string | null
  shares: number | null
  price: number | null
  market_value: number | null
  cost_basis: number | null
  weight_pct: number | null
}

/**
 * Per-portfolio holdings for a given asset, scoped to the user's CURRENT
 * organization. The explicit `organization_id` filter is defensive: the
 * table's RLS policy lets platform admins bypass the org check
 * (`OR is_platform_admin()`), which is intentional for support workflows
 * but leaks cross-org client data into normal product views. We silo
 * strictly at the application layer so even platform admins don't
 * accidentally see another org's holdings while doing regular research.
 */
export function useAssetHoldings(assetId: string | null | undefined) {
  const { currentOrgId } = useOrganization()

  return useQuery<AssetHolding[]>({
    queryKey: ['asset-holdings', assetId, currentOrgId],
    queryFn: async () => {
      if (!assetId || !currentOrgId) return []
      const { data, error } = await supabase
        .from('portfolio_holdings_positions')
        .select(`
          id, portfolio_id, organization_id, shares, price, market_value, cost_basis, weight_pct, created_at,
          portfolios ( name )
        `)
        .eq('asset_id', assetId)
        .eq('organization_id', currentOrgId)
        .order('created_at', { ascending: false })
      if (error) throw error

      // Dedupe to the latest row per portfolio_id
      const byPortfolio = new Map<string, any>()
      for (const row of data ?? []) {
        if (!byPortfolio.has(row.portfolio_id)) byPortfolio.set(row.portfolio_id, row)
      }

      return Array.from(byPortfolio.values()).map((row: any) => ({
        id: row.id,
        portfolio_id: row.portfolio_id,
        portfolio_name: row.portfolios?.name ?? null,
        shares: row.shares,
        price: row.price,
        market_value: row.market_value,
        cost_basis: row.cost_basis,
        weight_pct: row.weight_pct
      }))
    },
    enabled: !!assetId && !!currentOrgId
  })
}
