import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface AssetPortfolioWeight {
  portfolioId: string
  name: string
  shares: number
  /** Position cost basis, i.e. shares × cost. */
  costBasis: number
  /** Percent of the portfolio's total cost basis, or null when unknowable. */
  weight: number | null
}

/**
 * What this asset weighs in each portfolio that holds it.
 *
 * Weight is position cost basis over portfolio cost basis, matching how the
 * desktop asset page computes it — the same numerator and denominator, so the
 * two surfaces cannot quietly disagree about a position's size.
 *
 * Cost basis rather than market value is a deliberate inherited choice: it
 * needs no live quote, so the number is available immediately and does not
 * change under the reader while a price streams in. It is not the same as
 * market weight, and a portfolio that has moved a long way from cost will show
 * a figure that differs from a market-value weight elsewhere.
 */
export function useAssetPortfolioWeights(assetId: string | undefined) {
  return useQuery({
    queryKey: ['asset-portfolio-weights', assetId],
    enabled: !!assetId,
    staleTime: 60_000,
    queryFn: async (): Promise<AssetPortfolioWeight[]> => {
      const { data: holdings, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, cost, portfolios(id, name)')
        .eq('asset_id', assetId!)
      if (error) throw error
      if (!holdings?.length) return []

      const portfolioIds = [...new Set(holdings.map((h: any) => h.portfolio_id))]

      // One request for every holding in the relevant portfolios, rather than
      // a query per portfolio: the desktop page loops, which costs a round
      // trip per portfolio the asset appears in.
      const { data: siblings, error: siblingError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, cost')
        .in('portfolio_id', portfolioIds)
      if (siblingError) throw siblingError

      const totals = new Map<string, number>()
      for (const row of (siblings ?? []) as any[]) {
        const value = num(row.shares) * num(row.cost)
        totals.set(row.portfolio_id, (totals.get(row.portfolio_id) ?? 0) + value)
      }

      const byPortfolio = new Map<string, AssetPortfolioWeight>()
      for (const h of holdings as any[]) {
        const shares = num(h.shares)
        const costBasis = shares * num(h.cost)
        const total = totals.get(h.portfolio_id) ?? 0
        // A zero-cost portfolio makes the ratio meaningless, not zero. Showing
        // 0.00% would assert the position is negligible when the truth is that
        // it cannot be computed.
        const weight = total > 0 ? (costBasis / total) * 100 : null

        // An asset can hold several lots in one portfolio; the position is
        // their sum, not the last one seen.
        const existing = byPortfolio.get(h.portfolio_id)
        if (existing) {
          existing.shares += shares
          existing.costBasis += costBasis
          existing.weight = total > 0 ? (existing.costBasis / total) * 100 : null
        } else {
          byPortfolio.set(h.portfolio_id, {
            portfolioId: h.portfolio_id,
            name: h.portfolios?.name ?? 'Unknown portfolio',
            shares,
            costBasis,
            weight,
          })
        }
      }

      return [...byPortfolio.values()].sort(
        (a, b) => (b.weight ?? -1) - (a.weight ?? -1)
      )
    },
  })
}

/** Numeric columns arrive as strings over PostgREST. */
function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}
