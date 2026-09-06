import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import { weightsByAsset, type HoldingRow } from '../lib/portfolio/holdings'

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
      // The WORKING BOOK. This read the snapshot positions table and deduped
      // to the newest row per portfolio by `created_at` — a hand-rolled
      // attempt at "current" that answered a slightly different question from
      // every other surface, and that ordered on insert time rather than on
      // the snapshot's own date, so a back-dated upload arriving late won.
      //
      // The working book needs neither: one row per (portfolio, asset), and
      // no row means the position is not held.
      // holdings-audit: safe — one row per position, no date, no aggregation.
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          id, portfolio_id, shares, price, cost, date,
          portfolios!inner ( name, organization_id )
        `)
        .eq('asset_id', assetId)
        .eq('portfolios.organization_id', currentOrgId)
      if (error) throw error

      const rows = data ?? []
      if (rows.length === 0) return []

      // Weight is DERIVED, from each book's own market value, because the
      // working book has no weight column and this product has one definition
      // of weight. The custodian's `weight_pct` on the snapshot table is a
      // different number computed by someone else against a different book,
      // and reading it here is what gave one position two weights.
      //
      // That needs each holding book's total, so the books are fetched whole.
      // One extra query, not one per portfolio.
      // holdings-audit: safe — buildBook reduces before it sums.
      const portfolioIds = [...new Set(rows.map((r: any) => r.portfolio_id))]
      const { data: bookRows, error: bookErr } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, cost, date')
        .in('portfolio_id', portfolioIds)
      if (bookErr) throw bookErr

      const weights = weightsByAsset((bookRows ?? []) as unknown as HoldingRow[])

      return rows.map((row: any) => {
        const shares = row.shares != null ? Number(row.shares) : null
        const price = row.price != null ? Number(row.price) : null
        return {
          id: row.id,
          portfolio_id: row.portfolio_id,
          portfolio_name: row.portfolios?.name ?? null,
          shares,
          price,
          market_value: shares != null && price != null ? shares * price : null,
          // `cost` is per-share average cost on this table, so the basis for
          // the line is cost x shares.
          cost_basis: row.cost != null && shares != null ? Number(row.cost) * shares : null,
          weight_pct: weights.get(assetId)?.get(row.portfolio_id) ?? null,
        }
      })
    },
    enabled: !!assetId && !!currentOrgId
  })
}
