import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'

export interface AssetPortfolioWeight {
  portfolioId: string
  name: string
  shares: number | null
  price: number | null
  marketValue: number | null
  /** Percent of the portfolio's market value, as of `asOf`. */
  weight: number | null
  /** The snapshot this position came from. Never null — weights are only ever
   *  as current as the book they were struck from. */
  asOf: string
}

/**
 * What this asset currently weighs in each portfolio that holds it.
 *
 * Read from `portfolio_holdings_positions`, the position snapshots that carry
 * a computed `weight_pct` against the portfolio's market value. That is the
 * book of record: computing weight from cost basis instead — as the desktop
 * asset page does — answers a different question, and a portfolio that has
 * moved a long way from cost gives a visibly different number.
 *
 * Rows are reduced to the newest snapshot per portfolio by `snapshot_date`,
 * not by row insert time. Those disagree on real data when a back-dated
 * snapshot is uploaded after a newer one, and ordering by insertion then shows
 * a superseded weight as current.
 *
 * `asOf` is returned rather than hidden because these are periodic snapshots,
 * not live marks. A weight presented as "current" with no date invites the
 * reader to trade against a number that may be weeks old.
 */
export function useAssetPortfolioWeights(assetId: string | undefined) {
  const { currentOrgId } = useOrganization()

  return useQuery({
    queryKey: ['asset-portfolio-weights', assetId, currentOrgId],
    enabled: !!assetId && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async (): Promise<AssetPortfolioWeight[]> => {
      const { data, error } = await supabase
        .from('portfolio_holdings_positions')
        .select(`
          portfolio_id, shares, price, market_value, weight_pct,
          portfolios ( name ),
          snapshot:portfolio_holdings_snapshots!inner ( snapshot_date )
        `)
        .eq('asset_id', assetId!)
        // Defensive despite RLS: the table's policy lets platform admins
        // bypass the org check for support workflows, which would otherwise
        // leak another org's holdings into ordinary research views.
        .eq('organization_id', currentOrgId!)
      if (error) throw error

      const newest = new Map<string, AssetPortfolioWeight>()
      for (const row of (data ?? []) as any[]) {
        const asOf = row.snapshot?.snapshot_date
        if (!asOf) continue

        const existing = newest.get(row.portfolio_id)
        if (existing && existing.asOf >= asOf) continue

        newest.set(row.portfolio_id, {
          portfolioId: row.portfolio_id,
          name: row.portfolios?.name ?? 'Unknown portfolio',
          shares: numOrNull(row.shares),
          price: numOrNull(row.price),
          marketValue: numOrNull(row.market_value),
          weight: numOrNull(row.weight_pct),
          asOf,
        })
      }

      return [...newest.values()].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1))
    },
  })
}

/**
 * Numeric columns arrive as strings over PostgREST. Missing stays missing:
 * coercing an absent weight to 0 would assert the position is negligible when
 * the truth is that it was never computed.
 */
function numOrNull(value: unknown): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}
