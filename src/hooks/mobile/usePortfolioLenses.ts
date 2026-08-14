import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'

/**
 * Two views of the book that no existing screen answers.
 *
 * Everything else in the product reports a portfolio one portfolio at a time,
 * and reports what a position *is*. These ask questions instead — is the size
 * consistent with the view, and is a name a bigger bet than any single
 * portfolio shows — which is what makes them worth a full screen in a feed
 * rather than a row in a table.
 *
 * Both are computed from holdings the org already has. Nothing here needs a
 * new provider or a new column.
 */

export interface ConvictionGap {
  assetId: string
  symbol: string
  companyName: string | null
  /** Position size as a share of the portfolio it sits in. */
  weightPct: number
  /** Upside to the base price target, as a fraction of current price. */
  upsidePct: number
  portfolioId: string
  portfolioName: string
  /**
   * `underweight` — the view is strong and the position is not.
   * `overweight`  — the position is large and the view no longer supports it.
   */
  direction: 'underweight' | 'overweight'
  /** How far apart the two are, for ranking. */
  tension: number
}

export interface CrowdedName {
  assetId: string
  symbol: string
  companyName: string | null
  /** How many portfolios in the org hold it. */
  portfolioCount: number
  /** Total value across those portfolios. */
  totalValue: number
  /** The heaviest single weight it takes in any one of them. */
  maxWeightPct: number
  portfolioNames: string[]
}

interface HoldingRow {
  portfolio_id: string
  asset_id: string
  shares: number | null
  price: number | null
  assets: { symbol: string | null; company_name: string | null } | null
  portfolios: { name: string | null } | null
}

/**
 * Conviction is taken from the base price target rather than a rating.
 *
 * A rating is a label someone picked from a list; the base target is a number
 * they had to defend, and the gap between it and the current price is the
 * upside actually being claimed. Using it means "conviction" here is derived
 * from the team's own published numbers rather than from a sentiment field
 * that may never have been revisited.
 */
const STRONG_UPSIDE = 0.25
const WEAK_UPSIDE = 0.05
/** Below this a position is too small to be worth flagging either way. */
const MIN_WEIGHT_PCT = 0.5

export function usePortfolioLenses(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery({
    queryKey: ['portfolio-lenses', currentOrgId],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ conviction: ConvictionGap[]; crowded: CrowdedName[] }> => {
      const { data: holdingsRaw } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, assets(symbol, company_name), portfolios!inner(name, organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
        .limit(5000)

      const holdings = (holdingsRaw ?? []) as unknown as HoldingRow[]
      if (!holdings.length) return { conviction: [], crowded: [] }

      const value = (h: HoldingRow) => (Number(h.shares) || 0) * (Number(h.price) || 0)

      // Portfolio totals first: a weight is meaningless without its denominator.
      const totals = new Map<string, number>()
      for (const h of holdings) {
        totals.set(h.portfolio_id, (totals.get(h.portfolio_id) ?? 0) + value(h))
      }

      // ── Crowding ──────────────────────────────────────────────────────────
      const byAsset = new Map<string, { rows: HoldingRow[]; portfolios: Set<string> }>()
      for (const h of holdings) {
        if (!h.asset_id) continue
        const e = byAsset.get(h.asset_id) ?? { rows: [], portfolios: new Set<string>() }
        e.rows.push(h)
        e.portfolios.add(h.portfolio_id)
        byAsset.set(h.asset_id, e)
      }

      const crowded: CrowdedName[] = []
      for (const [assetId, e] of byAsset) {
        if (e.portfolios.size < 2) continue
        const totalValue = e.rows.reduce((n, h) => n + value(h), 0)
        const maxWeightPct = Math.max(
          ...e.rows.map(h => {
            const t = totals.get(h.portfolio_id) ?? 0
            return t > 0 ? (value(h) / t) * 100 : 0
          })
        )
        crowded.push({
          assetId,
          symbol: e.rows[0].assets?.symbol ?? '—',
          companyName: e.rows[0].assets?.company_name ?? null,
          portfolioCount: e.portfolios.size,
          totalValue,
          maxWeightPct,
          portfolioNames: Array.from(
            new Set(e.rows.map(h => h.portfolios?.name).filter(Boolean) as string[])
          ),
        })
      }
      crowded.sort((a, b) => b.portfolioCount - a.portfolioCount || b.totalValue - a.totalValue)

      // ── Conviction vs weight ──────────────────────────────────────────────
      const assetIds = Array.from(byAsset.keys())
      const { data: targets } = await supabase
        .from('price_targets')
        .select('asset_id, price, type, created_at')
        .eq('organization_id', currentOrgId!)
        .eq('type', 'base')
        .in('asset_id', assetIds.slice(0, 500))
        .order('created_at', { ascending: false })

      // Most recent base target per asset — an older one is a superseded view.
      const baseTarget = new Map<string, number>()
      for (const t of (targets ?? []) as any[]) {
        if (!t.asset_id || baseTarget.has(t.asset_id)) continue
        const p = Number(t.price)
        if (Number.isFinite(p) && p > 0) baseTarget.set(t.asset_id, p)
      }

      const conviction: ConvictionGap[] = []
      for (const h of holdings) {
        const target = baseTarget.get(h.asset_id)
        const price = Number(h.price) || 0
        const total = totals.get(h.portfolio_id) ?? 0
        if (!target || price <= 0 || total <= 0) continue

        const weightPct = (value(h) / total) * 100
        if (weightPct < MIN_WEIGHT_PCT) continue
        const upsidePct = (target - price) / price

        // The two interesting corners. A big position with big upside is
        // simply a good position, and a small one with none is correctly
        // ignored — neither is worth a screen.
        const isUnder = upsidePct >= STRONG_UPSIDE && weightPct < 2
        const isOver = upsidePct <= WEAK_UPSIDE && weightPct >= 4
        if (!isUnder && !isOver) continue

        conviction.push({
          assetId: h.asset_id,
          symbol: h.assets?.symbol ?? '—',
          companyName: h.assets?.company_name ?? null,
          weightPct,
          upsidePct,
          portfolioId: h.portfolio_id,
          portfolioName: h.portfolios?.name ?? 'Portfolio',
          direction: isUnder ? 'underweight' : 'overweight',
          // Underweights rank on upside forgone, overweights on size at risk.
          tension: isUnder ? upsidePct * 100 : weightPct,
        })
      }
      conviction.sort((a, b) => b.tension - a.tension)

      return { conviction: conviction.slice(0, 12), crowded: crowded.slice(0, 12) }
    },
  })
}
