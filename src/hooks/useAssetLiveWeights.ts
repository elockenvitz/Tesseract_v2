import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import { financialDataService } from '../lib/financial-data/browser-client'

export interface LivePortfolioWeight {
  portfolioId: string
  name: string
  shares: number
  /** Price used for this asset, or null when none could be fetched. */
  price: number | null
  marketValue: number | null
  /** Percent of the portfolio's repriced market value, or null if unknowable. */
  weight: number | null
  /** Date the position (share count) was struck. Shares are still snapshot data. */
  positionsAsOf: string
  /** Holdings in this portfolio with no usable price. */
  unpricedCount: number
  /** Holdings in this portfolio in total, so the gap can be judged. */
  holdingsCount: number
}

/** Concurrent quote requests. Enough to be quick, few enough not to be rude. */
const CONCURRENCY = 8

/**
 * Portfolio weights repriced at the latest available close.
 *
 * The stored `weight_pct` is struck at the snapshot date — month-end in
 * practice — so it can be weeks old. This keeps the snapshot's share counts,
 * which only change when the book changes, and reprices every holding in the
 * portfolio to get a current denominator.
 *
 * Every holding must be priced, not just the asset being viewed: weight is a
 * ratio, and repricing only the numerator against a stale denominator is worse
 * than leaving both stale.
 *
 * Unpriced holdings are counted rather than skipped. `getQuote` never fails —
 * it returns an all-zero placeholder — so a dropped request would silently
 * shrink the denominator and overstate every weight in that portfolio. A
 * portfolio with gaps reports how many, and the caller decides whether to
 * trust it.
 */
export function useAssetLiveWeights(assetId: string | undefined) {
  const { currentOrgId } = useOrganization()

  return useQuery({
    queryKey: ['asset-live-weights', assetId, currentOrgId],
    enabled: !!assetId && !!currentOrgId,
    // Quotes move, but not fast enough to justify refetching a whole book on
    // every remount of a tab.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LivePortfolioWeight[]> => {
      const portfolioIds = await portfoliosHolding(assetId!, currentOrgId!)
      if (!portfolioIds.length) return []

      const positions = await latestPositions(portfolioIds, currentOrgId!)
      if (!positions.length) return []

      const symbols = [...new Set(positions.map(p => p.symbol).filter(Boolean))]
      const prices = await fetchPrices(symbols)

      return computeWeights(positions, prices, assetId!)
    },
  })
}

/**
 * Reduce priced positions to one weight per portfolio.
 *
 * Exported and pure because the failure mode is dangerous and silent: an
 * unpriced holding left out of the denominator makes every weight in that
 * portfolio too large, and the number still looks perfectly reasonable.
 */
export function computeWeights(
  positions: PositionRow[],
  prices: Map<string, number>,
  assetId: string
): LivePortfolioWeight[] {
  const byPortfolio = new Map<string, LivePortfolioWeight>()
  const totals = new Map<string, number>()

  for (const position of positions) {
    const entry = byPortfolio.get(position.portfolioId) ?? {
      portfolioId: position.portfolioId,
      name: position.portfolioName,
      shares: 0,
      price: null,
      marketValue: null,
      weight: null,
      positionsAsOf: position.asOf,
      unpricedCount: 0,
      holdingsCount: 0,
    }
    entry.holdingsCount += 1

    const price = prices.get(position.symbol) ?? null
    if (price == null) {
      entry.unpricedCount += 1
    } else {
      totals.set(
        position.portfolioId,
        (totals.get(position.portfolioId) ?? 0) + position.shares * price
      )
    }

    if (position.assetId === assetId) {
      // One asset can hold several lots in a portfolio; the position is their
      // sum, not the last row seen.
      entry.shares += position.shares
      if (price != null) {
        entry.price = price
        entry.marketValue = (entry.marketValue ?? 0) + position.shares * price
      }
    }

    byPortfolio.set(position.portfolioId, entry)
  }

  for (const entry of byPortfolio.values()) {
    const total = totals.get(entry.portfolioId) ?? 0
    entry.weight =
      entry.marketValue != null && total > 0 ? (entry.marketValue / total) * 100 : null
  }

  return [...byPortfolio.values()]
    .filter(e => e.shares > 0)
    .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1))
}

async function portfoliosHolding(assetId: string, orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('portfolio_holdings_positions')
    .select('portfolio_id')
    .eq('asset_id', assetId)
    .eq('organization_id', orgId)
  if (error) throw error
  return [...new Set((data ?? []).map((r: any) => r.portfolio_id))]
}

export interface PositionRow {
  portfolioId: string
  portfolioName: string
  assetId: string
  symbol: string
  shares: number
  asOf: string
}

/** Every holding of the given portfolios, from each portfolio's newest snapshot. */
async function latestPositions(portfolioIds: string[], orgId: string): Promise<PositionRow[]> {
  const { data, error } = await supabase
    .from('portfolio_holdings_positions')
    .select(`
      portfolio_id, asset_id, symbol, shares,
      portfolios ( name ),
      snapshot:portfolio_holdings_snapshots!inner ( snapshot_date )
    `)
    .in('portfolio_id', portfolioIds)
    .eq('organization_id', orgId)
  if (error) throw error

  // Newest snapshot per portfolio, by snapshot_date rather than insert order:
  // a back-dated upload arriving after a newer one would otherwise win.
  const newestDate = new Map<string, string>()
  for (const row of (data ?? []) as any[]) {
    const date = row.snapshot?.snapshot_date
    if (!date) continue
    const current = newestDate.get(row.portfolio_id)
    if (!current || date > current) newestDate.set(row.portfolio_id, date)
  }

  return ((data ?? []) as any[])
    .filter(row => row.snapshot?.snapshot_date === newestDate.get(row.portfolio_id))
    .map(row => ({
      portfolioId: row.portfolio_id,
      portfolioName: row.portfolios?.name ?? 'Unknown portfolio',
      assetId: row.asset_id,
      symbol: String(row.symbol ?? '').toUpperCase(),
      shares: toNumber(row.shares),
      asOf: row.snapshot.snapshot_date,
    }))
    .filter(row => row.symbol && row.shares !== 0)
}

/** Latest usable price per symbol. Absent means genuinely unknown. */
async function fetchPrices(symbols: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  const queue = [...symbols]

  const worker = async () => {
    while (queue.length) {
      const symbol = queue.shift()
      if (!symbol) return
      try {
        const quote = await financialDataService.getQuote(symbol)
        // A placeholder quote is all zeros. Treating that as a real price of
        // zero would drop the holding out of the denominator without saying so.
        const price = pickPrice(quote)
        if (price != null) prices.set(symbol, price)
      } catch {
        // Leave it absent; the caller counts the gap.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker))
  return prices
}

/**
 * The most recent price available: the live mark, else the previous close.
 * Before the open, `price` is often the previous close anyway; after a failed
 * intraday fetch, yesterday's close is still the honest answer.
 */
export function pickPrice(quote: { price?: number; previousClose?: number } | null): number | null {
  if (!quote) return null
  if (typeof quote.price === 'number' && quote.price > 0) return quote.price
  if (typeof quote.previousClose === 'number' && quote.previousClose > 0) return quote.previousClose
  return null
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}
