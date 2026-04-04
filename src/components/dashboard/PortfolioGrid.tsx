/**
 * PortfolioGrid — Overview tiles for all user portfolios.
 *
 * Shown in Portfolio mode when no single portfolio is selected.
 * Each tile shows real data from portfolio_holdings:
 *   - Portfolio name
 *   - Total value
 *   - Return % (inception-to-date from cost basis)
 *   - Holdings count
 *   - Attention signals (at-risk / stale counts)
 *
 * Clicking a tile selects that portfolio and enters the command center.
 */

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { useQueries } from '@tanstack/react-query'
import { AlertTriangle, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { CockpitViewModel } from '../../types/cockpit'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PortfolioGridProps {
  portfolios: { id: string; name: string }[]
  viewModel: CockpitViewModel
  onSelectPortfolio: (id: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioGrid({
  portfolios,
  viewModel,
  onSelectPortfolio,
}: PortfolioGridProps) {
  // Batch-fetch holdings for all portfolios
  const holdingsQueries = useQueries({
    queries: portfolios.map(p => ({
      queryKey: ['portfolio-holdings-summary', p.id],
      staleTime: 120_000,
      queryFn: async () => {
        const { data, error } = await supabase
          .from('portfolio_holdings')
          .select('asset_id, shares, price, cost, assets(id, symbol, updated_at)')
          .eq('portfolio_id', p.id)
        if (error) throw error
        return { portfolioId: p.id, holdings: data || [] }
      },
    })),
  })

  // Compute stats per portfolio
  const tileData = useMemo(() => {
    // Index dashboard items by portfolio for attention counts
    const allItems = [
      ...viewModel.decide.stacks.flatMap(s => s.itemsAll),
      ...viewModel.advance.stacks.flatMap(s => s.itemsAll),
    ]
    const itemsByPortfolio = new Map<string, typeof allItems>()
    for (const item of allItems) {
      if (item.portfolio?.id) {
        if (!itemsByPortfolio.has(item.portfolio.id)) itemsByPortfolio.set(item.portfolio.id, [])
        itemsByPortfolio.get(item.portfolio.id)!.push(item)
      }
    }

    return portfolios.map((p, idx) => {
      const query = holdingsQueries[idx]
      const holdings = query.data?.holdings ?? []
      const isLoading = query.isLoading

      let totalValue = 0
      let totalCost = 0
      let nonCashValue = 0
      let atRiskCount = 0
      let staleCount = 0
      const now = Date.now()

      for (const h of holdings) {
        const shares = parseFloat(h.shares as any) || 0
        const price = parseFloat(h.price as any) || 0
        const cost = parseFloat(h.cost as any) || 0
        const symbol = ((h.assets as any)?.symbol || '').toLowerCase()
        const isCash = symbol.includes('cash') || symbol.includes('usd') || symbol.includes('money_market')
        const mv = isCash ? shares * (price || cost || 1) : shares * price
        const cb = shares * cost
        totalValue += mv
        if (!isCash && price > 0) { totalCost += cb; nonCashValue += mv }

        // Classify — cash always 0%
        const returnPct = isCash ? 0 : (cb > 0 && price > 0 ? ((mv - cb) / cb) * 100 : 0)
        const asset = h.assets as any
        const thesisAge = asset?.updated_at
          ? Math.floor((now - new Date(asset.updated_at).getTime()) / 86400000)
          : null

        if (returnPct < -20 || (returnPct < -10 && thesisAge != null && thesisAge > 90)) {
          atRiskCount++
        } else if (thesisAge != null && thesisAge > 90) {
          staleCount++
        }
      }

      // Return on non-cash holdings with valid prices only
      const rawReturn = totalCost > 0 && nonCashValue > 0 ? ((nonCashValue - totalCost) / totalCost) * 100 : 0
      // Clamp: if return is exactly -100% it means no valid price data
      const returnPct = rawReturn <= -99.9 ? 0 : rawReturn
      const decisionCount = (itemsByPortfolio.get(p.id) ?? [])
        .filter(i => viewModel.decide.stacks.some(s => s.itemsAll.includes(i)))
        .length

      return {
        id: p.id,
        name: p.name,
        holdingsCount: holdings.length,
        totalValue,
        returnPct,
        atRiskCount,
        staleCount,
        decisionCount,
        isLoading,
      }
    })
  }, [portfolios, holdingsQueries, viewModel])

  if (portfolios.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-4 py-5 text-center">
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          No portfolios found. Create a portfolio to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Portfolios
        </span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
          {portfolios.length}
        </span>
      </div>

      {/* Grid */}
      <div className={clsx(
        'grid gap-2',
        portfolios.length >= 3 ? 'grid-cols-3' : portfolios.length === 2 ? 'grid-cols-2' : 'grid-cols-1',
      )}>
        {tileData.map(tile => (
          <PortfolioTile
            key={tile.id}
            tile={tile}
            onSelect={() => onSelectPortfolio(tile.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PortfolioTile
// ---------------------------------------------------------------------------

function PortfolioTile({
  tile,
  onSelect,
}: {
  tile: {
    id: string
    name: string
    holdingsCount: number
    totalValue: number
    returnPct: number
    atRiskCount: number
    staleCount: number
    decisionCount: number
    isLoading: boolean
  }
  onSelect: () => void
}) {
  if (tile.isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 h-[88px] animate-pulse" />
    )
  }

  const hasHoldings = tile.holdingsCount > 0
  const hasAttention = tile.atRiskCount > 0 || tile.staleCount > 0

  return (
    <button
      onClick={onSelect}
      className={clsx(
        'text-left rounded-lg border bg-white dark:bg-gray-800/60 overflow-hidden transition-all',
        'hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm',
        hasAttention
          ? 'border-gray-200 dark:border-gray-700'
          : 'border-gray-200 dark:border-gray-700',
      )}
    >
      <div className="px-3.5 py-3">
        {/* Row 1: Name + decisions badge */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50 truncate">
            {tile.name}
          </span>
          {tile.decisionCount > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 tabular-nums shrink-0">
              {tile.decisionCount}
            </span>
          )}
        </div>

        {/* Row 2: Value + Return */}
        {hasHoldings ? (
          <div className="flex items-baseline gap-3 mb-1.5">
            <span className="text-[12px] font-medium text-gray-600 dark:text-gray-300 tabular-nums">
              {tile.totalValue >= 1_000_000
                ? `$${(tile.totalValue / 1_000_000).toFixed(1)}M`
                : `$${(tile.totalValue / 1000).toFixed(0)}k`}
            </span>
            <span className={clsx(
              'text-[13px] font-bold tabular-nums',
              tile.returnPct >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400',
            )}>
              {tile.returnPct >= 0 ? '+' : ''}{tile.returnPct.toFixed(1)}%
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
              {tile.holdingsCount} positions
            </span>
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">
            No positions
          </div>
        )}

        {/* Row 3: Attention signals */}
        {hasAttention && (
          <div className="flex items-center gap-2.5">
            {tile.atRiskCount > 0 && (
              <div className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-red-500" />
                <span className="text-[10px] font-bold text-red-600 dark:text-red-400">
                  {tile.atRiskCount} at risk
                </span>
              </div>
            )}
            {tile.staleCount > 0 && (
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  {tile.staleCount} stale
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
